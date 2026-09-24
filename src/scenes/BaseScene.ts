import Phaser from 'phaser';
import { PALETTE } from '../assets/palette';
import { CHARACTER_COLUMNS, CHARACTER_ROWS, characterFrame } from '../assets/characterSheet';
import { BASE_MAP_KEY } from '../config';
import { BASE_ZONE_ID, gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { getView } from '../display/view';
import { onWorldZoomChange, stepWorldZoom, worldZoomFor } from '../display/worldZoom';
import { keyboardDirection } from '../input/joystick';
import { moveInput } from '../input/moveInput';
import { autosave } from '../save';
import { CollisionWorld } from '../systems/movement/CollisionWorld';
import type { Facing } from '../systems/movement/movement';
import { content } from '../world/content';
import { BASE_TILESET_NAME } from '../world/tileset';
import { TILE_LAYERS, type TileLayerName } from '../world/zoneMap';
import { SceneKey } from './keys';

const PLAYER_TEXTURE = 'player';
const TILESET_TEXTURE = 'tileset_base';
const WALK_FRAME_RATE = 8;
/** Intervalo mínimo entre passos de zoom com a roda do rato. */
const WHEEL_COOLDOWN_MS = 150;

/**
 * Profundidades: as camadas de chão ficam por baixo de tudo, `decor_high` por cima de tudo, e
 * entre elas os objetos com Y-sort (profundidade = y dos pés, sempre ≥ 0).
 */
const LAYER_DEPTH: Readonly<Record<TileLayerName, number>> = {
  ground: -3,
  decor_low: -2,
  collision: -1,
  decor_high: 1_000_000,
};

const walkAnimationKey = (facing: Facing): string => `${PLAYER_TEXTURE}_walk_${facing}`;

type MoveKeys = Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key[]>;

/** A base do jogador: mapa Tiled, recursos (decorativos até à Fase 3) e o jogador a andar. */
export class BaseScene extends Phaser.Scene {
  private player: Phaser.GameObjects.Sprite | null = null;
  private keys: MoveKeys | null = null;

  constructor() {
    super(SceneKey.Base);
  }

  create(): void {
    const zone = content.zoneMap(BASE_ZONE_ID);
    this.createMap();

    // Recursos e obstáculos: pés no ponto do mapa (arredondado: posições inteiras), Y-sort.
    const objects = [
      ...zone.resources.map((p) => ({ p, def: content.resources[p.id] })),
      ...zone.props.map((p) => ({ p, def: content.props[p.id] })),
    ];
    for (const { p, def } of objects) {
      if (!def) continue; // impossível: o mapa foi validado contra resources.json/props.json
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      this.add.image(x, y, def.sprite).setOrigin(0.5, 1).setDepth(y);
    }

    this.createPlayerAnimations();
    const { x, y, facing } = gameState.data.player;
    // Origem nos pés (meio da base do sprite): é o ponto usado no Y-sort e nas colisões.
    this.player = this.add
      .sprite(x, y, PLAYER_TEXTURE, characterFrame(facing, CHARACTER_COLUMNS.idle))
      .setOrigin(0.5, 1)
      .setDepth(y);

    const camera = this.cameras.main;
    // Fora do mapa (ecrãs maiores do que ele, ou zoom afastado) vê-se "noite".
    camera.setBackgroundColor(PALETTE.ink);
    camera.startFollow(this.player, true);
    const applyZoom = (): void => {
      this.applyCameraZoom(zone.width * zone.tileSize, zone.height * zone.tileSize);
    };
    applyZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, applyZoom);
    const offZoom = onWorldZoomChange(applyZoom);
    this.listenForZoomInput();

    this.keys = this.createMoveKeys();
    simulation.setWorld(CollisionWorld.fromZone(zone, content.resources, content.props));
    simulation.setRespawnPoint(zone.playerSpawn);
    simulation.reset();
    autosave.start();
    this.scene.launch(SceneKey.UI, {});

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, applyZoom);
      offZoom();
      this.scene.stop(SceneKey.UI);
      autosave.stop();
      void autosave.flush();
      simulation.setWorld(null);
      simulation.setRespawnPoint(null);
      moveInput.reset();
      this.player = null;
      this.keys = null;
    });
  }

  override update(): void {
    moveInput.keyboard = this.readKeyboard();
    simulation.setMoveIntent(moveInput.direction);
    // rawDelta = tempo real entre frames; o delta "suavizado" do Phaser fica limitado a
    // 16,7 ms com a janela sem foco, o que atrasaria o relógio do jogo.
    simulation.update(this.game.loop.rawDelta);
    this.renderPlayer();
  }

  /**
   * Zoom inteiro escolhido pelo jogador (ver display/worldZoom.ts). Com zoom o Phaser não
   * arredonda: o jogador e tudo o resto ficam em posições inteiras (ver renderPlayer) e a vista
   * tem tamanho par, por isso cada píxel de jogo cai em píxeis inteiros do dispositivo.
   * Se se vê mais do que o mapa, os limites alargam-se para o mapa ficar centrado.
   */
  private applyCameraZoom(mapWidth: number, mapHeight: number): void {
    const view = getView();
    const zoom = worldZoomFor(view.zoom);
    const visibleWidth = (view.width * view.zoom) / zoom;
    const visibleHeight = (view.height * view.zoom) / zoom;
    const bx = Math.min(0, (mapWidth - visibleWidth) / 2);
    const by = Math.min(0, (mapHeight - visibleHeight) / 2);
    const camera = this.cameras.main;
    camera.setZoom(zoom);
    camera.setBounds(bx, by, Math.max(mapWidth, visibleWidth), Math.max(mapHeight, visibleHeight));
  }

  /** Roda do rato e teclas +/− (a pinça com 2 dedos está na UIScene, que recebe os toques). */
  private listenForZoomInput(): void {
    let lastWheel = 0;
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
        // Um "clique" da roda gera vários eventos (sobretudo em touchpads): um passo por 150 ms.
        if (dy === 0 || this.time.now - lastWheel < WHEEL_COOLDOWN_MS) return;
        lastWheel = this.time.now;
        stepWorldZoom(dy < 0 ? 1 : -1, getView().zoom);
      },
    );
    const zoomIn = (): void => {
      stepWorldZoom(1, getView().zoom);
    };
    const zoomOut = (): void => {
      stepWorldZoom(-1, getView().zoom);
    };
    for (const key of ['PLUS', 'NUMPAD_ADD']) this.input.keyboard?.on(`keydown-${key}`, zoomIn);
    for (const key of ['MINUS', 'NUMPAD_SUBTRACT']) this.input.keyboard?.on(`keydown-${key}`, zoomOut);
  }

  private createMap(): void {
    const map = this.make.tilemap({ key: BASE_MAP_KEY });
    const tileset = map.addTilesetImage(BASE_TILESET_NAME, TILESET_TEXTURE);
    if (!tileset) throw new Error(`O mapa da base não tem o tileset "${BASE_TILESET_NAME}".`);
    for (const name of TILE_LAYERS) {
      map.createLayer(name, tileset, 0, 0).setDepth(LAYER_DEPTH[name]);
    }
  }

  /** As animações são globais (do jogo), por isso só se criam na primeira vez. */
  private createPlayerAnimations(): void {
    for (const facing of CHARACTER_ROWS) {
      const key = walkAnimationKey(facing);
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(PLAYER_TEXTURE, {
          frames: CHARACTER_COLUMNS.walk.map((column) => characterFrame(facing, column)),
        }),
        frameRate: WALK_FRAME_RATE,
        repeat: -1,
      });
    }
  }

  /**
   * `addKey(k, false)`: sem captura global (a captura faria preventDefault às teclas mesmo
   * fora do jogo, ex.: em campos de texto do DOM).
   */
  private createMoveKeys(): MoveKeys | null {
    const keyboard = this.input.keyboard;
    if (!keyboard) return null;
    const { KeyCodes } = Phaser.Input.Keyboard;
    const add = (...codes: number[]) => codes.map((code) => keyboard.addKey(code, false));
    return {
      up: add(KeyCodes.W, KeyCodes.UP),
      down: add(KeyCodes.S, KeyCodes.DOWN),
      left: add(KeyCodes.A, KeyCodes.LEFT),
      right: add(KeyCodes.D, KeyCodes.RIGHT),
    };
  }

  private readKeyboard(): { x: number; y: number } {
    const keys = this.keys;
    if (!keys) return { x: 0, y: 0 };
    const down = (list: Phaser.Input.Keyboard.Key[]) => list.some((key) => key.isDown);
    return keyboardDirection({
      up: down(keys.up),
      down: down(keys.down),
      left: down(keys.left),
      right: down(keys.right),
    });
  }

  /** Posição interpolada entre os dois últimos ticks (a lógica corre a 20 ticks/s, o ecrã a 60). */
  private renderPlayer(): void {
    const player = this.player;
    if (!player) return;
    const state = gameState.data.player;
    const previous = simulation.previousPlayerPosition;
    const alpha = simulation.alpha;
    // Arredondado a píxeis de jogo: com zoom na câmara, o Phaser desenharia a meio píxel.
    const x = Math.round(previous.x + (state.x - previous.x) * alpha);
    const y = Math.round(previous.y + (state.y - previous.y) * alpha);
    player.setPosition(x, y).setDepth(y);

    if (simulation.playerMoved) {
      player.play(walkAnimationKey(state.facing), true);
    } else {
      player.stop();
      player.setFrame(characterFrame(state.facing, CHARACTER_COLUMNS.idle));
    }
  }
}

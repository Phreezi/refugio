import Phaser from 'phaser';
import { PALETTE } from '../assets/palette';
import { PLAYER_FOOTPRINT } from '../config';
import { eventBus } from '../core/EventBus';
import { itemName, t } from '../i18n';
import { Label } from '../ui/text';
import { gameSpeed } from '../ui/gameSpeed';
import { uiState } from '../ui/uiState';
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
/** Seta por cima do alvo da ação contextual (textura gerada por código). */
const MARKER_TEXTURE = 'target_marker';
/** Duração da animação de golpe (2 frames). */
const ATTACK_MS = 240;
const FLOAT_TEXT_MS = 900;
const FLOAT_TEXT_RISE = 14;
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
const sneakAnimationKey = (facing: Facing): string => `${PLAYER_TEXTURE}_sneak_${facing}`;
const SNEAK_FRAME_RATE = 4;

type MoveKeys = Record<'up' | 'down' | 'left' | 'right' | 'action' | 'sneak', Phaser.Input.Keyboard.Key[]>;

/** A base do jogador: mapa Tiled, recursos, obstáculos, baú e o jogador (andar e recolher). */
export class BaseScene extends Phaser.Scene {
  private player: Phaser.GameObjects.Sprite | null = null;
  private keys: MoveKeys | null = null;
  /** Sprites dos recursos, pelo id do objeto no Tiled (para golpes, esconder e reaparecer). */
  private resourceSprites = new Map<number, Phaser.GameObjects.Image>();
  private marker: Phaser.GameObjects.Image | null = null;
  private attackUntil = 0;

  constructor() {
    super(SceneKey.Base);
  }

  create(): void {
    const zone = content.zoneMap(BASE_ZONE_ID);
    this.createMap();

    // Recursos, obstáculos e baús: pés no ponto do mapa (arredondado: posições inteiras), Y-sort.
    const place = (p: { x: number; y: number }, sprite: string): Phaser.GameObjects.Image => {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      return this.add.image(x, y, sprite).setOrigin(0.5, 1).setDepth(y);
    };
    this.resourceSprites = new Map();
    for (const p of zone.resources) {
      const def = content.resources[p.id];
      if (def) this.resourceSprites.set(p.objectId, place(p, def.sprite));
    }
    for (const p of zone.props) {
      const def = content.props[p.id];
      if (def) place(p, def.sprite);
    }
    const chestSprite = content.props.chest?.sprite;
    if (chestSprite) for (const p of zone.chests) place(p, chestSprite);

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
    const offZoomInput = this.listenForZoomInput();

    this.keys = this.createMoveKeys();
    simulation.setZone({
      zoneId: BASE_ZONE_ID,
      map: zone,
      collision: CollisionWorld.fromZone(zone, content.resources, content.props),
      items: content.items,
      resources: content.resources,
      props: content.props,
    });
    simulation.setRespawnPoint(zone.playerSpawn);
    simulation.reset();
    for (const [objectId, sprite] of this.resourceSprites) {
      sprite.setVisible(!simulation.interaction.isDepleted(objectId));
    }
    this.marker = this.add.image(0, 0, this.markerTexture()).setOrigin(0.5, 1).setVisible(false);
    const offFeedback = this.listenForFeedback();
    autosave.start();
    this.scene.launch(SceneKey.UI, {});

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, applyZoom);
      offZoom();
      offZoomInput();
      this.scene.stop(SceneKey.UI);
      autosave.stop();
      void autosave.flush();
      offFeedback();
      simulation.setZone(null);
      simulation.setRespawnPoint(null);
      this.resourceSprites.clear();
      this.marker = null;
      moveInput.reset();
      this.player = null;
      this.keys = null;
    });
  }

  override update(): void {
    moveInput.keyboard = this.readKeyboard();
    moveInput.keyboardSneak = this.keys?.sneak.some((key) => key.isDown) ?? false;
    // Com a mochila/baú aberto o jogador fica parado.
    const blocked = uiState.modalOpen;
    simulation.setMoveIntent(blocked ? { x: 0, y: 0 } : moveInput.direction, moveInput.sneak);
    const actionKey = this.keys?.action.some((key) => key.isDown) ?? false;
    simulation.setActionHeld(!blocked && (actionKey || uiState.actionHeld));
    // rawDelta = tempo real entre frames; o delta "suavizado" do Phaser fica limitado a
    // 16,7 ms com a janela sem foco, o que atrasaria o relógio do jogo.
    // Velocidade do jogo (x1/x2/x3): mais tempo de jogo por frame (no máx. 5 ticks por frame).
    const speed = gameSpeed();
    simulation.update(this.game.loop.rawDelta * speed);
    if (this.player) this.player.anims.timeScale = speed;
    this.renderPlayer();
    this.renderMarker();
  }

  /** Seta por cima do alvo atual da ação contextual (para se saber o que o Espaço faz). */
  private renderMarker(): void {
    const marker = this.marker;
    if (!marker) return;
    const target = uiState.modalOpen ? null : simulation.interaction.currentTarget(PLAYER_FOOTPRINT);
    if (!target) {
      marker.setVisible(false);
      return;
    }
    const placement = target.data.placement;
    const sprite = this.resourceSprites.get(placement.objectId);
    const top = sprite ? sprite.y - sprite.height : Math.round(placement.y) - 16;
    const bob = Math.floor(this.time.now / 300) % 2;
    marker
      .setPosition(Math.round(placement.x), top - 1 - bob)
      .setDepth(LAYER_DEPTH.decor_high + 1)
      .setVisible(true);
  }

  private markerTexture(): string {
    if (this.textures.exists(MARKER_TEXTURE)) return MARKER_TEXTURE;
    // Triângulo de 7×4 px a apontar para baixo, com contorno escuro.
    const canvas = this.textures.createCanvas(MARKER_TEXTURE, 7, 4);
    const ctx = canvas?.getContext();
    if (!canvas || !ctx) return '__DEFAULT';
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(0, 0, 7, 1);
    ctx.fillRect(1, 1, 5, 1);
    ctx.fillRect(2, 2, 3, 1);
    ctx.fillRect(3, 3, 1, 1);
    ctx.fillStyle = PALETTE.cream;
    ctx.fillRect(1, 0, 5, 1);
    ctx.fillRect(2, 1, 3, 1);
    ctx.fillRect(3, 2, 1, 1);
    canvas.refresh();
    return MARKER_TEXTURE;
  }

  /** Reações visuais aos eventos da lógica: golpes, recursos apanhados, itens ganhos. */
  private listenForFeedback(): () => void {
    const offs = [
      eventBus.on('player:action', ({ kind }) => {
        if (kind !== 'open') this.attackUntil = this.time.now + ATTACK_MS;
      }),
      eventBus.on('resource:hit', ({ objectId, hp }) => {
        const sprite = this.resourceSprites.get(objectId);
        if (!sprite) return;
        if (hp <= 0) {
          sprite.setVisible(false);
          return;
        }
        // Abanão de 1 px e clarão branco: posições inteiras (o Phaser não arredonda com zoom).
        const x = sprite.x;
        sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        this.time.delayedCall(60, () => sprite.clearTint());
        [1, -1, 1, 0].forEach((dx, i) => {
          this.time.delayedCall(40 * i, () => sprite.setX(x + dx));
        });
      }),
      eventBus.on('resource:respawned', ({ objectId }) => {
        const sprite = this.resourceSprites.get(objectId);
        if (!sprite) return;
        sprite.setVisible(true).setAlpha(0);
        this.tweens.add({ targets: sprite, alpha: 1, duration: 600 });
      }),
      eventBus.on('item:gained', ({ item, qty, x, y }) => {
        this.floatText(t('msg.gained', { qty, item: itemName(item) }), Math.round(x), Math.round(y) - 20);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }

  /** Texto que sobe e desaparece (ex.: "+2 Madeira"). */
  private floatText(text: string, x: number, y: number): void {
    const label = new Label(
      this,
      x,
      y,
      text,
      { size: 7, bold: true, color: 'cream', stroke: true },
      [0.5, 1],
    );
    label.setDepth(LAYER_DEPTH.decor_high + 2);
    const start = this.time.now;
    const timer = this.time.addEvent({
      delay: 30,
      loop: true,
      callback: () => {
        const progress = (this.time.now - start) / FLOAT_TEXT_MS;
        if (progress >= 1) {
          timer.remove();
          label.destroy();
          return;
        }
        label.setPosition(x, y - Math.round(progress * FLOAT_TEXT_RISE));
        label.text.setAlpha(1 - progress * progress);
      },
    });
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

  /**
   * Ctrl + roda do rato (e a pinça dos touchpads, que o browser envia como Ctrl + roda) e
   * teclas +/−. A pinça com 2 dedos no ecrã tátil está na UIScene, que recebe os toques.
   * Devolve a função que remove os listeners.
   */
  private listenForZoomInput(): () => void {
    let lastWheel = 0;
    const canvas = this.game.canvas;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return; // a roda sozinha fica livre (ex.: listas, no futuro)
      event.preventDefault(); // senão o browser amplia a página inteira
      // Um "clique" da roda gera vários eventos (sobretudo em touchpads): um passo por 150 ms.
      if (event.deltaY === 0 || this.time.now - lastWheel < WHEEL_COOLDOWN_MS) return;
      lastWheel = this.time.now;
      stepWorldZoom(event.deltaY < 0 ? 1 : -1, getView().zoom);
    };
    // passive: false — só assim o preventDefault impede o zoom da página.
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const zoomIn = (): void => {
      stepWorldZoom(1, getView().zoom);
    };
    const zoomOut = (): void => {
      stepWorldZoom(-1, getView().zoom);
    };
    for (const key of ['PLUS', 'NUMPAD_ADD']) this.input.keyboard?.on(`keydown-${key}`, zoomIn);
    for (const key of ['MINUS', 'NUMPAD_SUBTRACT']) this.input.keyboard?.on(`keydown-${key}`, zoomOut);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
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
    const define = (key: string, columns: readonly number[], facing: Facing, frameRate: number): void => {
      if (this.anims.exists(key)) return;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(PLAYER_TEXTURE, {
          frames: columns.map((column) => characterFrame(facing, column)),
        }),
        frameRate,
        repeat: -1,
      });
    };
    for (const facing of CHARACTER_ROWS) {
      define(walkAnimationKey(facing), CHARACTER_COLUMNS.walk, facing, WALK_FRAME_RATE);
      define(sneakAnimationKey(facing), CHARACTER_COLUMNS.sneakWalk, facing, SNEAK_FRAME_RATE);
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
      action: add(KeyCodes.SPACE),
      sneak: add(KeyCodes.SHIFT),
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

    if (this.time.now < this.attackUntil) {
      // Golpe: frame "levantado" e depois "estendido".
      const [raised, extended] = CHARACTER_COLUMNS.attack;
      const column = this.attackUntil - this.time.now > ATTACK_MS / 2 ? raised : extended;
      player.stop();
      player.setFrame(characterFrame(state.facing, column));
    } else if (simulation.playerMoved) {
      const sneak = simulation.playerSneaking;
      player.play(sneak ? sneakAnimationKey(state.facing) : walkAnimationKey(state.facing), true);
    } else {
      player.stop();
      const idle = simulation.playerSneaking ? CHARACTER_COLUMNS.sneakIdle : CHARACTER_COLUMNS.idle;
      player.setFrame(characterFrame(state.facing, idle));
    }
  }
}

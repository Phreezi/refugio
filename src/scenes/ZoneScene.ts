import Phaser from 'phaser';
import { PALETTE, paletteNumber, type PaletteColor } from '../assets/palette';
import { PLAYER_FOOTPRINT } from '../config';
import { eventBus } from '../core/EventBus';
import { itemName, t, tKey } from '../i18n';
import { Label } from '../ui/text';
import { gameSpeed } from '../ui/gameSpeed';
import { uiState } from '../ui/uiState';
import { CHARACTER_COLUMNS, CHARACTER_ROWS, characterFrame } from '../assets/characterSheet';
import { zoneMapKey } from '../config';
import { BASE_ZONE_ID, gameState } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { getView } from '../display/view';
import { onWorldZoomChange, stepWorldZoom, worldZoomFor } from '../display/worldZoom';
import { installShortcutGuard } from '../input/browserShortcuts';
import { keyboardDirection } from '../input/joystick';
import { moveInput } from '../input/moveInput';
import { autosave } from '../save';
import { structureSprite } from '../data/types';
import { structureArea, structureFeet, type StructureRecord } from '../systems/building/building';
import { CollisionWorld } from '../systems/movement/CollisionWorld';
import { buildMode, buildTargetTile } from '../ui/buildMode';
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
/** Fundações: por cima do chão do mapa, por baixo de tudo o que tem Y-sort. */
const FOUNDATION_DEPTH = -0.5;
/** Realce dos tiles no modo construção: no chão, por cima das fundações. */
const GHOST_AREA_DEPTH = FOUNDATION_DEPTH + 0.2;
const GHOST_OK = 0x78ae48;
const GHOST_BAD = 0xb33a3a;

/** Transição entre zonas (fade). */
const FADE_MS = 250;
/** Largura da barra de vida dos inimigos (px, par). */
const ENEMY_BAR = 12;

export interface ZoneSceneData {
  /** Zona a mostrar (omisso = a zona onde o jogador está no GameState). */
  zoneId?: string;
}

interface EnemyView {
  sprite: Phaser.GameObjects.Image;
  barBack: Phaser.GameObjects.Rectangle;
  bar: Phaser.GameObjects.Rectangle;
}

const walkAnimationKey = (facing: Facing): string => `${PLAYER_TEXTURE}_walk_${facing}`;
const sneakAnimationKey = (facing: Facing): string => `${PLAYER_TEXTURE}_sneak_${facing}`;
const SNEAK_FRAME_RATE = 4;

type MoveKeys = Record<'up' | 'down' | 'left' | 'right' | 'action' | 'sneak', Phaser.Input.Keyboard.Key[]>;

/**
 * Uma zona jogável (a base ou uma zona explorável): mapa Tiled, recursos, obstáculos, peças
 * construídas, inimigos, mochilas no chão e o jogador. As saídas levam a outras zonas.
 */
export class ZoneScene extends Phaser.Scene {
  private zoneId: string = BASE_ZONE_ID;
  private enemyViews = new Map<number, EnemyView>();
  private bagSprites: Phaser.GameObjects.Image[] = [];
  /** A sair da zona (fade em curso): o jogador fica parado. */
  private leaving = false;
  private hurtUntil = 0;
  private player: Phaser.GameObjects.Sprite | null = null;
  private keys: MoveKeys | null = null;
  /** Sprites dos recursos, pelo id do objeto no Tiled (para golpes, esconder e reaparecer). */
  private resourceSprites = new Map<number, Phaser.GameObjects.Image>();
  /** Sprites das peças construídas, pelo uid. */
  private structureSprites = new Map<number, Phaser.GameObjects.Image>();
  private marker: Phaser.GameObjects.Image | null = null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private ghostArea: Phaser.GameObjects.Rectangle | null = null;
  /** Peça tingida de vermelho (alvo da demolição). */
  private demolishTinted: number | null = null;
  private attackUntil = 0;

  constructor() {
    super(SceneKey.Zone);
  }

  create(data: ZoneSceneData): void {
    const zoneId = data.zoneId ?? gameState.data.player.zoneId;
    this.zoneId = content.zones[zoneId] ? zoneId : BASE_ZONE_ID;
    this.leaving = false;
    this.hurtUntil = 0;
    const zone = content.zoneMap(this.zoneId);
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
    for (const p of zone.stations) {
      const def = content.stations[p.id];
      if (def) place(p, def.sprite);
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
    const offZoomInput = this.listenForZoomInput();
    const offShortcuts = installShortcutGuard();

    this.keys = this.createMoveKeys();
    simulation.setZone({
      zoneId: this.zoneId,
      map: zone,
      collision: CollisionWorld.fromZone(zone, content.resources, content.props, content.stations),
      items: content.items,
      resources: content.resources,
      props: content.props,
      stations: content.stations,
      structures: content.structures,
    });
    simulation.setRespawnPoint(content.zoneMap(BASE_ZONE_ID).playerSpawn);
    simulation.reset();
    for (const [objectId, sprite] of this.resourceSprites) {
      sprite.setVisible(!simulation.interaction.isDepleted(objectId));
    }
    this.structureSprites = new Map();
    for (const record of simulation.building.structures()) this.addStructureSprite(record);
    this.marker = this.add.image(0, 0, this.markerTexture()).setOrigin(0.5, 1).setVisible(false);
    this.ghost = this.add.image(0, 0, '__DEFAULT').setOrigin(0.5, 1).setAlpha(0.75).setVisible(false);
    this.ghostArea = this.add.rectangle(0, 0, 16, 16, GHOST_OK, 0.3).setOrigin(0).setVisible(false);
    this.ghostArea.setDepth(GHOST_AREA_DEPTH);
    this.enemyViews = new Map();
    this.renderBags();
    const offFeedback = this.listenForFeedback();
    camera.fadeIn(FADE_MS);
    autosave.start();
    this.scene.launch(SceneKey.UI, {});

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, applyZoom);
      offZoom();
      offZoomInput();
      offShortcuts();
      this.scene.stop(SceneKey.UI);
      autosave.stop();
      void autosave.flush();
      offFeedback();
      simulation.setZone(null);
      simulation.setRespawnPoint(null);
      this.resourceSprites.clear();
      this.structureSprites.clear();
      this.enemyViews.clear();
      this.bagSprites = [];
      this.marker = null;
      this.ghost = null;
      this.ghostArea = null;
      this.demolishTinted = null;
      buildMode.active = false;
      moveInput.reset();
      this.player = null;
      this.keys = null;
    });
  }

  override update(): void {
    moveInput.keyboard = this.readKeyboard();
    moveInput.keyboardSneak = this.keys?.sneak.some((key) => key.isDown) ?? false;
    // Com a mochila/baú aberto (ou a sair da zona) o jogador fica parado.
    const blocked = uiState.modalOpen || this.leaving;
    simulation.setMoveIntent(blocked ? { x: 0, y: 0 } : moveInput.direction, moveInput.sneak);
    // No modo construção, Espaço/clique colocam peças (UIScene) em vez da ação contextual.
    const actionKey = !buildMode.active && (this.keys?.action.some((key) => key.isDown) ?? false);
    simulation.setActionHeld(!blocked && !buildMode.active && (actionKey || uiState.actionHeld));
    // rawDelta = tempo real entre frames; o delta "suavizado" do Phaser fica limitado a
    // 16,7 ms com a janela sem foco, o que atrasaria o relógio do jogo.
    // Velocidade do jogo (x1/x2/x3): mais tempo de jogo por frame (no máx. 5 ticks por frame).
    const speed = gameSpeed();
    simulation.update(this.game.loop.rawDelta * speed);
    if (this.player) this.player.anims.timeScale = speed;
    this.renderPlayer();
    this.renderEnemies();
    // Com toque, andar volta a pôr a peça à frente do jogador.
    if (simulation.playerMoved && buildMode.pickedBy === 'touch') {
      buildMode.picked = null;
      buildMode.pickedBy = null;
    }
    this.renderMarker();
    this.renderGhost();
  }

  private addStructureSprite(record: StructureRecord): void {
    const [uid, id, tx, ty, rot, state] = record;
    const def = content.structures[id];
    if (!def) return;
    const feet = structureFeet(def, tx, ty, simulation.building.tileSize);
    const sprite = this.add
      .image(feet.x, feet.y, structureSprite(def, rot, state === 1))
      .setOrigin(0.5, 1)
      .setDepth(def.layer === 'floor' ? FOUNDATION_DEPTH : feet.y);
    this.structureSprites.set(uid, sprite);
  }

  /**
   * Pré-visualização do modo construção: a peça escolhida no tile alvo, verde se der para a
   * pôr ou vermelha se não; a demolir, a peça alvo fica vermelha.
   */
  private renderGhost(): void {
    const ghost = this.ghost;
    const area = this.ghostArea;
    if (!ghost || !area) return;
    if (this.demolishTinted !== null) {
      this.structureSprites.get(this.demolishTinted)?.clearTint();
      this.demolishTinted = null;
    }
    if (!buildMode.active || uiState.modalOpen) {
      ghost.setVisible(false);
      area.setVisible(false);
      return;
    }
    const building = simulation.building;
    const tileSize = building.tileSize;
    const { tx, ty } = buildTargetTile();
    if (buildMode.demolish) {
      ghost.setVisible(false);
      const record = building.demolishTarget(tx, ty);
      const def = record ? building.def(record[1]) : undefined;
      const rect =
        record && def
          ? structureArea(def, record[2], record[3], tileSize)
          : { x: tx * tileSize, y: ty * tileSize, w: tileSize, h: tileSize };
      const ok = record !== null && building.demolishProblem(record) === null;
      area
        .setPosition(rect.x, rect.y)
        .setSize(rect.w, rect.h)
        .setFillStyle(ok ? 0xf0a445 : GHOST_BAD, 0.35);
      area.setVisible(true);
      if (record) {
        this.structureSprites.get(record[0])?.setTint(GHOST_BAD);
        this.demolishTinted = record[0];
      }
      return;
    }
    const def = building.def(buildMode.selected);
    if (!def) return;
    const ok = building.check(buildMode.selected, tx, ty) === null;
    const color = ok ? GHOST_OK : GHOST_BAD;
    const feet = structureFeet(def, tx, ty, tileSize);
    // Com a profundidade que a peça terá (o jogador passa à frente/atrás dela como da real).
    ghost
      .setTexture(structureSprite(def, buildMode.rot, false))
      .setPosition(feet.x, feet.y)
      .setDepth(def.layer === 'floor' ? FOUNDATION_DEPTH + 0.1 : feet.y + 0.5)
      .setTint(color)
      .setVisible(true);
    const rect = structureArea(def, tx, ty, tileSize);
    area.setPosition(rect.x, rect.y).setSize(rect.w, rect.h).setFillStyle(color, 0.3).setVisible(true);
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
    const sprite =
      placement.objectId < 0
        ? this.structureSprites.get(-placement.objectId)
        : this.resourceSprites.get(placement.objectId);
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
      eventBus.on('structure:placed', ({ uid }) => {
        const record = simulation.building.get(uid);
        if (record) this.addStructureSprite(record);
      }),
      eventBus.on('structure:removed', ({ uid }) => {
        this.structureSprites.get(uid)?.destroy();
        this.structureSprites.delete(uid);
      }),
      eventBus.on('structure:changed', ({ uid }) => {
        const record = simulation.building.get(uid);
        const def = record ? content.structures[record[1]] : undefined;
        if (record && def)
          this.structureSprites.get(uid)?.setTexture(structureSprite(def, record[4], record[5] === 1));
      }),
      eventBus.on('enemy:hit', ({ uid, damage, x, y }) => {
        this.floatText(`-${String(damage)}`, Math.round(x), Math.round(y) - 2, 'gold');
        const sprite = this.enemyViews.get(uid)?.sprite;
        sprite?.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        this.time.delayedCall(80, () => sprite?.clearTint());
      }),
      eventBus.on('enemy:killed', ({ uid }) => {
        const view = this.enemyViews.get(uid);
        this.enemyViews.delete(uid);
        if (!view) return;
        view.bar.destroy();
        view.barBack.destroy();
        this.tweens.add({
          targets: view.sprite,
          alpha: 0,
          duration: 400,
          onComplete: () => {
            view.sprite.destroy();
          },
        });
      }),
      eventBus.on('player:damaged', ({ amount, x, y }) => {
        this.floatText(`-${String(amount)}`, Math.round(x), Math.round(y) - 34, 'red');
        this.hurtUntil = this.time.now + 150;
        this.cameras.main.shake(100, 0.004);
      }),
      eventBus.on('bag:changed', ({ zoneId }) => {
        if (zoneId === this.zoneId) this.renderBags();
      }),
      eventBus.on('zone:change', ({ to }) => {
        this.leave(() => {
          simulation.enterZone(to, content.zoneMap(to));
          uiState.pendingNotice = tKey(content.zones[to]?.name ?? to);
          return to;
        });
      }),
      eventBus.on('player:died', () => {
        // O jogador já está na base (GameState): se morreu noutra zona, muda de cena.
        if (this.zoneId !== BASE_ZONE_ID) this.leave(() => BASE_ZONE_ID);
      }),
      eventBus.on('item:gained', ({ item, qty, x, y }) => {
        this.floatText(t('msg.gained', { qty, item: itemName(item) }), Math.round(x), Math.round(y) - 20);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }

  /** Sai da zona com um fade; `next` diz para que zona vai (e atualiza o estado). */
  private leave(next: () => string): void {
    if (this.leaving) return;
    this.leaving = true;
    const camera = this.cameras.main;
    camera.fadeOut(FADE_MS, 0, 0, 0);
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      const zoneId = next();
      this.scene.restart({ zoneId } satisfies ZoneSceneData);
    });
  }

  /** Inimigos: posição interpolada, andar aos saltinhos, aviso de ataque a piscar, vida. */
  private renderEnemies(): void {
    const alpha = simulation.alpha;
    const now = this.time.now;
    for (const enemy of simulation.combat.list) {
      const def = content.enemies[enemy.id];
      if (!def) continue;
      let view = this.enemyViews.get(enemy.uid);
      if (!view) {
        view = {
          sprite: this.add.image(0, 0, def.sprite).setOrigin(0.5, 1),
          barBack: this.add.rectangle(0, 0, ENEMY_BAR + 2, 4, paletteNumber('ink')).setOrigin(0),
          bar: this.add.rectangle(0, 0, ENEMY_BAR, 2, paletteNumber('red')).setOrigin(0),
        };
        this.enemyViews.set(enemy.uid, view);
      }
      const x = Math.round(enemy.px + (enemy.x - enemy.px) * alpha);
      const y = Math.round(enemy.py + (enemy.y - enemy.py) * alpha);
      const moving = enemy.px !== enemy.x || enemy.py !== enemy.y;
      const bob = moving && Math.floor(now / 160) % 2 === 1 ? 1 : 0;
      view.sprite
        .setPosition(x, y - bob)
        .setDepth(y)
        .setFlipX(enemy.flip);
      // Aviso de ataque (§7.8): pisca a branco durante o windup.
      if (enemy.state === 'windup') {
        if (Math.floor(now / 70) % 2 === 0) view.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        else view.sprite.clearTint();
      } else if (view.sprite.tintMode === Phaser.TintModes.FILL && enemy.stun === 0) {
        view.sprite.clearTint();
      }
      const hurt = enemy.hp < def.hp;
      const top = y - view.sprite.height - 4;
      view.barBack
        .setPosition(x - ENEMY_BAR / 2 - 1, top)
        .setDepth(y)
        .setVisible(hurt);
      view.bar
        .setPosition(x - ENEMY_BAR / 2, top + 1)
        .setSize(Math.max(1, Math.round((ENEMY_BAR * enemy.hp) / def.hp)), 2)
        .setDepth(y)
        .setVisible(hurt);
    }
    // Jogador: vermelho quando leva um golpe; pisca enquanto está invulnerável.
    if (this.player) {
      if (now < this.hurtUntil) this.player.setTint(0xb33a3a).setTintMode(Phaser.TintModes.FILL);
      else this.player.clearTint();
      this.player.setAlpha(simulation.combat.playerInvulnerable && Math.floor(now / 80) % 2 === 0 ? 0.4 : 1);
    }
  }

  /** Mochilas no chão da zona (redesenhadas quando mudam). */
  private renderBags(): void {
    for (const sprite of this.bagSprites) sprite.destroy();
    this.bagSprites = simulation.combat
      .bags()
      .map((bag) => this.add.image(bag.x, bag.y, 'bag_dropped').setOrigin(0.5, 1).setDepth(bag.y));
  }

  /** Texto que sobe e desaparece (ex.: "+2 Madeira", "-10"). */
  private floatText(text: string, x: number, y: number, color: PaletteColor = 'cream'): void {
    const label = new Label(this, x, y, text, { size: 7, bold: true, color, stroke: true }, [0.5, 1]);
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
    const map = this.make.tilemap({ key: zoneMapKey(this.zoneId) });
    const tileset = map.addTilesetImage(BASE_TILESET_NAME, TILESET_TEXTURE);
    if (!tileset) throw new Error(`O mapa de ${this.zoneId} não tem o tileset "${BASE_TILESET_NAME}".`);
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
      // Shift ou Ctrl (o Ctrl é o "agachar" habitual nos jogos de PC).
      sneak: add(KeyCodes.SHIFT, KeyCodes.CTRL),
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

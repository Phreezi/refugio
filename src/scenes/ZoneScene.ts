import Phaser from 'phaser';
import { PALETTE, paletteNumber, type PaletteColor } from '../assets/palette';
import { PLAYER_FOOTPRINT } from '../config';
import { eventBus, type GameEvents } from '../core/EventBus';
import { itemName, t, tKey } from '../i18n';
import { Label } from '../ui/text';
import { gameSpeed } from '../ui/gameSpeed';
import { uiState } from '../ui/uiState';
import { preferences } from '../ui/preferences';
import { CHARACTER_COLUMNS, CHARACTER_ROWS, characterFrame } from '../assets/characterSheet';
import { zoneMapKey } from '../config';
import { BASE_ZONE_ID, CHARACTER_LOOKS, gameState, type CharacterLook } from '../core/GameState';
import { simulation } from '../core/Simulation';
import { getView } from '../display/view';
import { onWorldZoomChange, stepWorldZoom, worldZoomFor } from '../display/worldZoom';
import { installShortcutGuard } from '../input/browserShortcuts';
import { keyboardDirection } from '../input/joystick';
import { moveInput } from '../input/moveInput';
import { autosave } from '../save';
import { buildZoneContext } from '../world/zoneContext';
import { coop, guestBus } from '../net/coop';
import { CROP_SPROUT_SPRITE, cropSprite, structureSprite, type StructureDef } from '../data/types';
import { structureArea, structureFeet, type StructureRecord } from '../systems/building/building';
import { buildMode, buildTargetTile } from '../ui/buildMode';
import type { Facing } from '../systems/movement/movement';
import { content } from '../world/content';
import { BASE_TILESET_NAME, baseTileIndex } from '../world/tileset';
import { TILE_LAYERS, type TileLayerName } from '../world/zoneMap';
import { darknessAt } from '../core/DayNight';
import { BALANCE } from '../data/balance';
import { SceneKey } from './keys';
import { grayTexture } from '../display/grayTexture';
import type { MainMenuData } from './MainMenuScene';
import type { WorldMapData } from './WorldMapScene';

/** Spritesheet de cada aparência (mesmo layout). */
const PLAYER_TEXTURES: Record<CharacterLook, string> = { boy: 'player', girl: 'player_girl' };
/** Eventos do mundo que, no co-op, também vêm do convidado (o anfitrião vê-os se estiver lá). */
const SHARED_VIEW_EVENTS: ReadonlySet<keyof GameEvents> = new Set<keyof GameEvents>([
  'resource:hit',
  'resource:respawned',
  'structure:placed',
  'structure:removed',
  'structure:changed',
  'structure:damaged',
  'structure:destroyed',
  'enemy:hit',
  'enemy:killed',
  'enemy:exploded',
  'enemy:scream',
  'bag:changed',
  'ground:changed',
  'enemy:missed',
  'corpse:gone',
  'inventory:changed',
]);
/** Tinta do boneco do outro jogador (co-op), para se distinguirem. */
const OTHER_TINT = 0x9fc6ff;
/** Cor do risco de cada munição em voo (omisso: madeira, como as flechas). */
const SHOT_COLORS: Readonly<Record<string, PaletteColor>> = { pistol_ammo: 'gold', pebble: 'stone_light' };
/** Seta por cima do alvo da ação contextual (textura gerada por código). */
const MARKER_TEXTURE = 'target_marker';
/** Duração da animação de golpe (2 frames). */
const ATTACK_MS = 240;
const FLOAT_TEXT_MS = 900;
const FLOAT_TEXT_RISE = 14;
/** "+2 Madeira": desvanece em 5 s, a subir devagar. */
const GAIN_TEXT_MS = 5000;
const GAIN_TEXT_RISE = 18;
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
/** Peças rasas e atravessáveis (canteiros, armadilhas): por cima do chão, por baixo do resto. */
const FLAT_DEPTH = FOUNDATION_DEPTH + 0.1;
const GHOST_OK = 0x78ae48;
const GHOST_BAD = 0xb33a3a;

/** Véu da noite (§7.11): cor, textura das luzes e margem à volta da vista (a câmara segue). */
const NIGHT_COLOR = 0x0b0d26;
const LIGHT_TEXTURE = 'light_soft';
const LIGHT_RADIUS = 64;
const NIGHT_MARGIN = 32;
const NIGHT_DEPTH = 1_000_000 + 5;

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

const walkAnimationKey = (look: CharacterLook, facing: Facing): string =>
  `${PLAYER_TEXTURES[look]}_walk_${facing}`;
const sneakAnimationKey = (look: CharacterLook, facing: Facing): string =>
  `${PLAYER_TEXTURES[look]}_sneak_${facing}`;
const SNEAK_FRAME_RATE = 4;

type MoveKeys = Record<'up' | 'down' | 'left' | 'right' | 'action' | 'sneak', Phaser.Input.Keyboard.Key[]>;

/**
 * Uma zona jogável (a base ou uma zona explorável): mapa Tiled, recursos, obstáculos, peças
 * construídas, inimigos, mochilas no chão e o jogador. As saídas levam a outras zonas.
 */
export class ZoneScene extends Phaser.Scene {
  private zoneId: string = BASE_ZONE_ID;
  private enemyViews = new Map<number, EnemyView>();
  /** Contentores com loot, pelo id do objeto (ficam escuros quando vazios). */
  private containerSprites = new Map<number, Phaser.GameObjects.Image>();
  private bagSprites: Phaser.GameObjects.Image[] = [];
  private groundSprites: Phaser.GameObjects.Image[] = [];
  /** Corpos no chão, pelo uid do inimigo. */
  private corpseSprites = new Map<number, Phaser.GameObjects.Sprite | Phaser.GameObjects.Image>();
  /** Véu escuro da noite, com as luzes "apagadas" nele. */
  private night: Phaser.GameObjects.RenderTexture | null = null;
  /** A sair da zona (fade em curso): o jogador fica parado. */
  private leaving = false;
  private hurtUntil = 0;
  private player: Phaser.GameObjects.Sprite | null = null;
  /** O outro jogador no co-op (o parceiro, ou o anfitrião visto pelo convidado). */
  private other: Phaser.GameObjects.Sprite | null = null;
  private keys: MoveKeys | null = null;
  /** Sprites dos recursos, pelo id do objeto no Tiled (para golpes, esconder e reaparecer). */
  private resourceSprites = new Map<number, Phaser.GameObjects.Image>();
  /** Sprites das peças construídas, pelo uid. */
  private structureSprites = new Map<number, Phaser.GameObjects.Image>();
  /** Projéteis em voo (setas, balas), pelo id. */
  private shotViews = new Map<number, Phaser.GameObjects.Rectangle>();
  /** Plantas dos canteiros da horta, pelo uid do canteiro. */
  private cropSprites = new Map<number, Phaser.GameObjects.Image>();
  private marker: Phaser.GameObjects.Image | null = null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private ghostArea: Phaser.GameObjects.Rectangle | null = null;
  /** Peça tingida de vermelho (alvo da demolição). */
  private demolishTinted: number | null = null;
  private attackUntil = 0;
  /** Último "+N item" mostrado (para empilhar os que chegam juntos). */
  private lastGain: { x: number; y: number; at: number; row: number } | null = null;
  /** Co-op (convidado): as peças desenhadas (para saber se o mundo recebido as mudou). */
  private structuresKey = '';

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
    this.containerSprites = new Map();
    for (const p of zone.containers) {
      const def = content.lootTables[p.id];
      if (def) this.containerSprites.set(p.objectId, place(p, def.sprite));
    }

    this.createPlayerAnimations();
    const { x, y, facing, look } = gameState.data.player;
    // Origem nos pés (meio da base do sprite): é o ponto usado no Y-sort e nas colisões.
    this.player = this.add
      .sprite(x, y, PLAYER_TEXTURES[look], characterFrame(facing, CHARACTER_COLUMNS.idle))
      .setOrigin(0.5, 1)
      .setDepth(y);

    const camera = this.cameras.main;
    // Fora do mapa (ecrãs maiores do que ele, ou zoom afastado) vê-se "noite".
    camera.setBackgroundColor(PALETTE.ink);
    camera.startFollow(this.player, true);
    const applyZoom = (): void => {
      this.applyCameraZoom(zone.width * zone.tileSize, zone.height * zone.tileSize);
      this.createNightLayer();
    };
    applyZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, applyZoom);
    const offZoom = onWorldZoomChange(applyZoom);
    const offZoomInput = this.listenForZoomInput();
    const offShortcuts = installShortcutGuard();

    this.keys = this.createMoveKeys();
    simulation.setZone(buildZoneContext(this.zoneId));
    simulation.setRespawnPoint(content.zoneMap(BASE_ZONE_ID).playerSpawn);
    simulation.reset();
    this.setupCoop();
    for (const [objectId, sprite] of this.resourceSprites) {
      sprite.setVisible(!simulation.interaction.isDepleted(objectId));
    }
    this.structureSprites = new Map();
    this.cropSprites = new Map();
    for (const record of simulation.building.structures()) this.addStructureSprite(record);
    this.structuresKey = JSON.stringify(gameState.data.base.structures);
    this.marker = this.add.image(0, 0, this.markerTexture()).setOrigin(0.5, 1).setVisible(false);
    this.ghost = this.add.image(0, 0, '__DEFAULT').setOrigin(0.5, 1).setAlpha(0.75).setVisible(false);
    this.ghostArea = this.add.rectangle(0, 0, 16, 16, GHOST_OK, 0.3).setOrigin(0).setVisible(false);
    this.ghostArea.setDepth(GHOST_AREA_DEPTH);
    this.enemyViews = new Map();
    this.renderBags();
    this.renderGround();
    this.renderContainers();
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
      this.cropSprites.clear();
      this.shotViews.clear();
      this.enemyViews.clear();
      this.containerSprites.clear();
      this.night = null;
      this.bagSprites = [];
      this.groundSprites = [];
      this.corpseSprites.clear();
      this.marker = null;
      this.ghost = null;
      this.ghostArea = null;
      this.demolishTinted = null;
      buildMode.active = false;
      moveInput.reset();
      coop.onSnapshot = null;
      coop.onLost = null;
      this.player = null;
      this.other = null;
      this.keys = null;
    });
  }

  override update(): void {
    moveInput.keyboard = this.readKeyboard();
    moveInput.keyboardSneak = this.keys?.sneak.some((key) => key.isDown) ?? false;
    // Com a mochila/baú aberto (ou a sair da zona) o jogador fica parado.
    const blocked = uiState.modalOpen || this.leaving;
    simulation.setMoveIntent(blocked ? { x: 0, y: 0 } : moveInput.direction, moveInput.sneak, moveInput.run);
    // No modo construção, Espaço/clique colocam peças (UIScene) em vez da ação contextual.
    const actionKey = !buildMode.active && (this.keys?.action.some((key) => key.isDown) ?? false);
    simulation.setActionHeld(!blocked && !buildMode.active && (actionKey || uiState.actionHeld));
    simulation.autoAttack = preferences().autoAttack && !blocked && !buildMode.active;
    // rawDelta = tempo real entre frames; o delta "suavizado" do Phaser fica limitado a
    // 16,7 ms com a janela sem foco, o que atrasaria o relógio do jogo.
    // Velocidade do jogo (x1/x2/x3): mais tempo de jogo por frame (no máx. 5 ticks por frame).
    const speed = gameSpeed();
    // Menu de pausa aberto: o tempo de jogo pára (o ecrã continua a ser desenhado).
    // Em co-op o tempo nunca pára (o outro jogador continua a jogar).
    if (!uiState.paused || uiState.coop) simulation.update(this.game.loop.rawDelta * speed);
    if (this.player) this.player.anims.timeScale = speed;
    coop.update(performance.now());
    this.renderPlayer();
    this.renderOther();
    this.renderEnemies();
    this.renderShots();
    this.renderHomestead();
    this.renderLighting();
    // Com toque, andar volta a pôr a peça à frente do jogador.
    if (simulation.playerMoved && buildMode.pickedBy === 'touch') {
      buildMode.picked = null;
      buildMode.pickedBy = null;
    }
    this.renderMarker();
    this.renderGhost();
  }

  private addStructureSprite(record: StructureRecord): void {
    const [uid, id, tx, ty] = record;
    const def = content.structures[id];
    if (!def) return;
    const feet = structureFeet(def, tx, ty, simulation.building.tileSize);
    const flat = !def.solid && !def.footprint;
    const depth = def.layer === 'floor' ? FOUNDATION_DEPTH : flat ? FLAT_DEPTH : feet.y;
    const sprite = this.add
      .image(feet.x, feet.y, this.structureTexture(record, def))
      .setOrigin(0.5, 1)
      .setDepth(depth);
    this.structureSprites.set(uid, sprite);
    this.applyDamageTint(uid);
  }

  /** Peças danificadas pela horda ficam avermelhadas (mais, quanto pior estiverem). */
  private applyDamageTint(uid: number): void {
    const sprite = this.structureSprites.get(uid);
    const record = simulation.building.get(uid);
    const def = record ? content.structures[record[1]] : undefined;
    if (!sprite || !def) return;
    const max = simulation.building.maxHp(def);
    const ratio = max > 0 ? simulation.building.damageOf(uid) / max : 0;
    if (ratio === 0) sprite.clearTint();
    else sprite.setTint(ratio < 0.5 ? 0xffd8c8 : 0xff9a88);
  }

  /** Textura de uma peça no estado atual (porta aberta, canteiro regado, algo para recolher). */
  private structureTexture(record: StructureRecord, def: StructureDef): string {
    const [uid, , , , rot, state] = record;
    if (def.farm && simulation.homestead.stage(uid) === 'growing') return `${def.sprite}_wet`;
    if (def.produce && simulation.homestead.produced(uid) > 0) return `${def.sprite}_full`;
    return structureSprite(def, rot, state === 1);
  }

  /** Horta e peças que produzem: o aspeto muda com o tempo (sem eventos), por isso vê-se a cada frame. */
  private renderHomestead(): void {
    const homestead = simulation.homestead;
    for (const record of simulation.building.structures()) {
      const def = content.structures[record[1]];
      if (!def || !(def.farm || def.produce)) continue;
      const uid = record[0];
      const sprite = this.structureSprites.get(uid);
      const texture = this.structureTexture(record, def);
      if (sprite && sprite.texture.key !== texture) sprite.setTexture(texture);
      if (!def.farm || !sprite) continue;
      const stage = homestead.stage(uid);
      const seed = homestead.seedOf(uid);
      const crop = seed ? content.items[seed]?.plant?.crop : undefined;
      const plant =
        stage === 'empty' ? null : stage === 'ready' && crop ? cropSprite(crop) : CROP_SPROUT_SPRITE;
      let view = this.cropSprites.get(uid);
      if (plant === null) {
        view?.destroy();
        this.cropSprites.delete(uid);
        continue;
      }
      if (!view) {
        view = this.add
          .image(sprite.x, sprite.y - 2, plant)
          .setOrigin(0.5, 1)
          .setDepth(sprite.y - 1);
        this.cropSprites.set(uid, view);
      } else if (view.texture.key !== plant) view.setTexture(plant);
    }
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
    // Co-op (anfitrião): o que o convidado faz no mundo (golpes, recursos, peças) também se vê
    // aqui, se ele estiver nesta zona.
    const on = <K extends keyof GameEvents>(
      event: K,
      handler: (payload: GameEvents[K]) => void,
    ): (() => void) => {
      const off = eventBus.on(event, handler);
      if (!SHARED_VIEW_EVENTS.has(event)) return off;
      const offGuest = guestBus.on(event, (payload) => {
        if (coop.isHost && coop.guestHere(this.zoneId)) handler(payload);
      });
      return () => {
        off();
        offGuest();
      };
    };
    const offs = [
      on('player:action', ({ kind }) => {
        if (kind !== 'open') this.attackUntil = this.time.now + ATTACK_MS;
      }),
      on('resource:hit', ({ objectId, hp }) => {
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
      on('resource:respawned', ({ objectId }) => {
        const sprite = this.resourceSprites.get(objectId);
        if (!sprite) return;
        sprite.setVisible(true).setAlpha(0);
        this.tweens.add({ targets: sprite, alpha: 1, duration: 600 });
      }),
      on('structure:placed', ({ uid }) => {
        const record = simulation.building.get(uid);
        if (record) this.addStructureSprite(record);
      }),
      on('structure:removed', ({ uid }) => {
        this.structureSprites.get(uid)?.destroy();
        this.structureSprites.delete(uid);
        this.cropSprites.get(uid)?.destroy();
        this.cropSprites.delete(uid);
      }),
      on('structure:changed', ({ uid }) => {
        const record = simulation.building.get(uid);
        const def = record ? content.structures[record[1]] : undefined;
        if (record && def) this.structureSprites.get(uid)?.setTexture(this.structureTexture(record, def));
        this.applyDamageTint(uid);
      }),
      on('structure:damaged', ({ uid, amount, x, y }) => {
        const record = simulation.building.get(uid);
        const def = record ? content.structures[record[1]] : undefined;
        // As armadilhas gastam-se sem números (seria ruído); as paredes mostram o dano.
        if (!def?.trap) this.floatText(`-${String(amount)}`, Math.round(x), Math.round(y) - 14, 'red');
        const sprite = this.structureSprites.get(uid);
        if (sprite && !def?.trap) {
          const sx = sprite.x;
          [1, -1, 0].forEach((dx, i) => this.time.delayedCall(40 * i, () => sprite.setX(sx + dx)));
        }
      }),
      on('structure:destroyed', ({ x, y }) => {
        // Pó a saltar do sítio da peça.
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const dust = this.add
            .rectangle(Math.round(x), Math.round(y) - 6, 2, 2, paletteNumber(i % 2 ? 'stone' : 'wood'))
            .setDepth(LAYER_DEPTH.decor_high + 1);
          this.tweens.add({
            targets: dust,
            x: Math.round(x + Math.cos(angle) * 12),
            y: Math.round(y - 6 + Math.sin(angle) * 8),
            alpha: 0,
            duration: 400,
            onComplete: () => {
              dust.destroy();
            },
          });
        }
      }),
      on('enemy:hit', ({ uid, damage, x, y }) => {
        if (preferences().damageNumbers)
          this.floatText(`-${String(damage)}`, Math.round(x), Math.round(y) - 2, 'gold');
        const sprite = this.enemyViews.get(uid)?.sprite;
        sprite?.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        this.time.delayedCall(80, () => sprite?.clearTint());
      }),
      on('enemy:killed', ({ uid }) => {
        const view = this.enemyViews.get(uid);
        this.enemyViews.delete(uid);
        if (!view) return;
        view.bar.destroy();
        view.barBack.destroy();
        // O corpo fica no chão, na posição em que estava, a cinzento (morto), até `corpse:gone`.
        const frame = view.sprite.frame.name;
        view.sprite.setTexture(grayTexture(this, view.sprite.texture.key), frame);
        view.sprite.setDepth(view.sprite.y - 12);
        this.corpseSprites.set(uid, view.sprite);
      }),
      on('enemy:exploded', ({ x, y, radius }) => {
        const blast = this.add
          .circle(Math.round(x), Math.round(y) - 6, radius, paletteNumber('orange'), 0.55)
          .setDepth(LAYER_DEPTH.decor_high + 1);
        this.tweens.add({
          targets: blast,
          alpha: 0,
          duration: 350,
          onComplete: () => {
            blast.destroy();
          },
        });
        this.cameras.main.shake(120, 0.002); // a explosão abana só um pouco
      }),
      on('enemy:scream', ({ x, y, radius }) => {
        // Grito: um anel que cresce até ao raio do alerta.
        const ring = this.add
          .circle(Math.round(x), Math.round(y) - 16, 4)
          .setStrokeStyle(2, paletteNumber('ice'), 0.8)
          .setDepth(LAYER_DEPTH.decor_high + 1);
        this.tweens.add({
          targets: ring,
          radius,
          alpha: 0,
          duration: 600,
          onComplete: () => {
            ring.destroy();
          },
        });
      }),
      on('player:damaged', ({ amount, x, y }) => {
        if (preferences().damageNumbers)
          this.floatText(`-${String(amount)}`, Math.round(x), Math.round(y) - 34, 'red');
        this.hurtUntil = this.time.now + 150;
        // Sem abanar o ecrã: o HUD mostra as bordas avermelhadas (pedido do jogador).
      }),
      on('inventory:changed', () => {
        this.renderContainers();
      }),
      on('corpse:gone', ({ uid, x, y }) => {
        const sprite = this.corpseSprites.get(uid);
        this.corpseSprites.delete(uid);
        sprite?.destroy();
        this.smoke(Math.round(x), Math.round(y));
      }),
      on('ground:changed', ({ zoneId }) => {
        if (zoneId === this.zoneId) this.renderGround();
      }),
      on('enemy:missed', ({ x, y }) => {
        if (preferences().damageNumbers)
          this.floatText(t('hud.miss'), Math.round(x), Math.round(y) - 2, 'stone_light');
      }),
      on('bag:changed', ({ zoneId }) => {
        if (zoneId === this.zoneId) this.renderBags();
      }),
      on('zone:change', ({ from, to, exit }) => {
        if (to === null) {
          // Saída para o mapa-mundo: o jogador fica na saída até escolher para onde vai.
          this.leave(() => {
            this.scene.start(SceneKey.WorldMap, { from, exit } satisfies WorldMapData);
          });
          return;
        }
        this.leave(() => {
          simulation.enterZone(to, content.zoneMap(to));
          uiState.pendingNotice = tKey(content.zones[to]?.name ?? to);
          this.scene.restart({ zoneId: to } satisfies ZoneSceneData);
        });
      }),
      on('player:died', () => {
        // O jogador já está na base (GameState): se morreu noutra zona, muda de cena.
        if (this.zoneId !== BASE_ZONE_ID) {
          this.leave(() => {
            this.scene.restart({ zoneId: BASE_ZONE_ID } satisfies ZoneSceneData);
          });
        }
      }),
      on('item:gained', ({ item, qty, x, y }) => {
        // Vários ganhos no mesmo sítio e no mesmo instante (fruto + sementes) ficam empilhados.
        const now = this.time.now;
        const last = this.lastGain;
        const row = last?.x === x && last.y === y && now - last.at < 100 ? last.row + 1 : 0;
        this.lastGain = { x, y, at: now, row };
        const text = t('msg.gained', { qty, item: itemName(item) });
        // O que se apanhou vai desvanecendo durante uns segundos (dá tempo de ler).
        this.floatText(
          text,
          Math.round(x),
          Math.round(y) - 20 - row * 9,
          'cream',
          GAIN_TEXT_MS,
          GAIN_TEXT_RISE,
        );
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }

  /** Sai da zona com um fade; `next` muda de cena (e atualiza o estado, se for preciso). */
  private leave(next: () => void): void {
    if (this.leaving) return;
    this.leaving = true;
    const camera = this.cameras.main;
    camera.fadeOut(FADE_MS, 0, 0, 0);
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, next);
  }

  /** Inimigos: posição interpolada, andar aos saltinhos, aviso de ataque a piscar, vida. */
  /** Setas e balas: quadradinhos (a pixel art não roda), interpolados entre ticks. */
  private renderShots(): void {
    const alpha = simulation.alpha;
    const alive = new Set<number>();
    for (const shot of simulation.combat.shots) {
      alive.add(shot.id);
      let view = this.shotViews.get(shot.id);
      if (!view) {
        const color = SHOT_COLORS[shot.ammo] ?? 'wood_light';
        view = this.add.rectangle(0, 0, 2, 2, paletteNumber(color)).setOrigin(0);
        this.shotViews.set(shot.id, view);
      }
      const x = Math.round(shot.px + (shot.x - shot.px) * alpha);
      const y = Math.round(shot.py + (shot.y - shot.py) * alpha);
      view.setPosition(x - 1, y - 1).setDepth(y + 8);
    }
    for (const [id, view] of this.shotViews) {
      if (alive.has(id)) continue;
      view.destroy();
      this.shotViews.delete(id);
    }
  }

  private renderEnemies(): void {
    // No convidado, os inimigos chegam do anfitrião 10×/s: interpola-se entre frames.
    const alpha = coop.isGuest ? coop.enemyAlpha(performance.now()) : simulation.alpha;
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
      const x = this.toScreenGrid(enemy.px + (enemy.x - enemy.px) * alpha);
      const y = this.toScreenGrid(enemy.py + (enemy.y - enemy.py) * alpha);
      const moving = enemy.px !== enemy.x || enemy.py !== enemy.y;
      const bob = moving && Math.floor(now / 160) % 2 === 1 ? 1 : 0;
      view.sprite
        .setPosition(x, y - bob)
        .setDepth(y)
        .setFlipX(enemy.flip);
      // A rebentar (inchado): pisca a vermelho, cada vez mais depressa.
      if (enemy.dying > 0) {
        const fast = Math.floor(now / (enemy.dying > 8 ? 90 : 45)) % 2 === 0;
        if (fast) view.sprite.setTint(0xdd6f38).setTintMode(Phaser.TintModes.FILL);
        else view.sprite.clearTint();
      } else if (enemy.state === 'windup') {
        // Aviso de ataque (§7.8): pisca a branco durante o windup.
        if (Math.floor(now / 70) % 2 === 0) view.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        else view.sprite.clearTint();
      } else if (view.sprite.tintMode === Phaser.TintModes.FILL && enemy.stun === 0) {
        view.sprite.clearTint();
      }
      const hurt = enemy.hp < enemy.maxHp;
      const top = y - view.sprite.height - 4;
      view.barBack
        .setPosition(x - ENEMY_BAR / 2 - 1, top)
        .setDepth(y)
        .setVisible(hurt);
      view.bar
        .setPosition(x - ENEMY_BAR / 2, top + 1)
        .setSize(Math.max(1, Math.round((ENEMY_BAR * enemy.hp) / enemy.maxHp)), 2)
        .setDepth(y)
        .setVisible(hurt);
    }
    // Inimigos que desapareceram sem morrer (a horda foi-se embora): tirar do ecrã.
    if (this.enemyViews.size > simulation.combat.list.length) {
      const alive = new Set(simulation.combat.list.map((e) => e.uid));
      for (const [uid, view] of this.enemyViews) {
        if (alive.has(uid)) continue;
        view.sprite.destroy();
        view.barBack.destroy();
        view.bar.destroy();
        this.enemyViews.delete(uid);
      }
    }
    // Jogador: vermelho quando leva um golpe; pisca enquanto está invulnerável.
    if (this.player) {
      if (now < this.hurtUntil) this.player.setTint(0xb33a3a).setTintMode(Phaser.TintModes.FILL);
      else this.player.clearTint();
      const blink = simulation.combat.playerInvulnerable && Math.floor(now / 80) % 2 === 0;
      this.player.setAlpha(blink ? 0.4 : 1);
    }
  }

  /**
   * Véu da noite do tamanho máximo que a câmara pode mostrar (zoom afastado = metade), mais uma
   * margem; recria-se quando a vista muda.
   */
  private createNightLayer(): void {
    this.night?.destroy();
    const view = getView();
    const w = view.width * 2 + NIGHT_MARGIN * 2;
    const h = view.height * 2 + NIGHT_MARGIN * 2;
    this.night = this.add.renderTexture(0, 0, w, h).setOrigin(0).setDepth(NIGHT_DEPTH).setVisible(false);
    this.lightTexture();
  }

  /** Círculo de luz em degraus (pixel art): opaco ao centro, a desvanecer para fora. */
  private lightTexture(): void {
    if (this.textures.exists(LIGHT_TEXTURE)) return;
    const size = LIGHT_RADIUS * 2;
    const canvas = this.textures.createCanvas(LIGHT_TEXTURE, size, size);
    const ctx = canvas?.getContext();
    if (!canvas || !ctx) return;
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - LIGHT_RADIUS, y + 0.5 - LIGHT_RADIUS) / LIGHT_RADIUS;
        const alpha = d < 0.55 ? 1 : d < 0.7 ? 0.8 : d < 0.82 ? 0.55 : d < 0.93 ? 0.28 : 0;
        const i = (y * size + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 255;
        image.data[i + 2] = 255;
        image.data[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    canvas.refresh();
  }

  /**
   * Dia e noite (CLAUDE.md §7.11): à noite escurece tudo, menos à volta do jogador e das
   * peças com luz (fogueiras, tochas), que tremeluzem.
   */
  private renderLighting(): void {
    const night = this.night;
    if (!night) return;
    // Debaixo de terra (bunker) é sempre escuro; lá fora, conforme a hora.
    const darkness = content.zones[this.zoneId]?.darkness ?? darknessAt(gameState.data.world.tick, BALANCE);
    if (darkness <= 0.01) {
      night.setVisible(false);
      return;
    }
    const view = this.cameras.main.worldView;
    const x0 = Math.floor(view.x) - NIGHT_MARGIN;
    const y0 = Math.floor(view.y) - NIGHT_MARGIN;
    night.setPosition(x0, y0).setVisible(true);
    night.clear();
    night.fill(NIGHT_COLOR, darkness);
    const light = (x: number, y: number, radius: number): void => {
      night.stamp(LIGHT_TEXTURE, undefined, Math.round(x - x0), Math.round(y - y0), {
        scale: radius / LIGHT_RADIUS,
        blendMode: Phaser.BlendModes.ERASE,
      });
    };
    const player = this.player;
    if (player) light(player.x, player.y - 10, BALANCE.playerLightPx);
    const flicker = Math.sin(this.time.now / 90) * 0.04 + Math.sin(this.time.now / 37) * 0.02;
    for (const record of simulation.building.structures()) {
      const def = content.structures[record[1]];
      if (!def?.light) continue;
      const feet = structureFeet(def, record[2], record[3], simulation.building.tileSize);
      light(feet.x, feet.y - 8, def.light * (1 + flicker));
    }
    night.render();
  }

  /** Contentores já vazios ficam mais escuros (voltam a encher com o tempo). */
  private renderContainers(): void {
    for (const [objectId, sprite] of this.containerSprites) {
      if (simulation.interaction.isLooted(objectId)) sprite.setTint(0x777777);
      else sprite.clearTint();
    }
  }

  /** Itens soltos no chão (flechas…): o ícone, pequeno, onde caíram. */
  private renderGround(): void {
    for (const sprite of this.groundSprites) sprite.destroy();
    const ground = gameState.data.zones[this.zoneId]?.ground ?? [];
    this.groundSprites = ground.map(([x, y, item]) =>
      this.add
        .image(x, y, content.items[item]?.icon ?? item)
        .setOrigin(0.5, 0.75)
        .setDepth(y - 8),
    );
  }

  /** Mochilas no chão da zona (redesenhadas quando mudam). */
  private renderBags(): void {
    for (const sprite of this.bagSprites) sprite.destroy();
    this.bagSprites = simulation.combat
      .bags()
      .map((bag) => this.add.image(bag.x, bag.y, 'bag_dropped').setOrigin(0.5, 1).setDepth(bag.y));
  }

  /** Nuvem de fumo (o corpo de um inimigo a desaparecer): círculos cinzentos que sobem e se apagam. */
  private smoke(x: number, y: number): void {
    const puffs: [number, number, number][] = [
      [-4, -4, 5],
      [4, -6, 4],
      [0, -10, 6],
      [-3, -14, 4],
      [5, -13, 3],
    ];
    for (const [dx, dy, r] of puffs) {
      const puff = this.add
        .circle(x + dx, y + dy, r, paletteNumber('stone_light'), 0.8)
        .setDepth(LAYER_DEPTH.decor_high + 1);
      this.tweens.add({
        targets: puff,
        y: y + dy - 8,
        scale: 1.6,
        alpha: 0,
        duration: 550,
        onComplete: () => {
          puff.destroy();
        },
      });
    }
  }

  /** Texto que sobe e desaparece (ex.: "+2 Madeira", "-10"). */
  private floatText(
    text: string,
    x: number,
    y: number,
    color: PaletteColor = 'cream',
    duration = FLOAT_TEXT_MS,
    rise = FLOAT_TEXT_RISE,
  ): void {
    const label = new Label(this, x, y, text, { size: 7, bold: true, color, stroke: true }, [0.5, 1]);
    label.setDepth(LAYER_DEPTH.decor_high + 2);
    const start = this.time.now;
    const timer = this.time.addEvent({
      delay: 30,
      loop: true,
      callback: () => {
        const progress = (this.time.now - start) / duration;
        if (progress >= 1) {
          timer.remove();
          label.destroy();
          return;
        }
        label.setPosition(x, y - Math.round(progress * rise));
        label.text.setAlpha(duration > FLOAT_TEXT_MS ? 1 - progress : 1 - progress * progress);
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
    this.drawShore(map, tileset.firstgid);
  }

  /**
   * Margens da água: espuma clara onde a água toca terra a norte e nos lados, e uma sombra
   * escura por baixo da margem (a terra fica "acima" da água). Um único Graphics estático.
   */
  private drawShore(map: Phaser.Tilemaps.Tilemap, firstgid: number): void {
    const water = firstgid + baseTileIndex('water');
    const isWater = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
      return TILE_LAYERS.some((layer) => map.getTileAt(x, y, false, layer)?.index === water);
    };
    const g = this.add.graphics().setDepth(LAYER_DEPTH.collision + 0.5);
    const size = map.tileWidth;
    const foam = paletteNumber('ice');
    const bank = paletteNumber('deep_water');
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!isWater(x, y)) continue;
        const px = x * size;
        const py = y * size;
        if (!isWater(x, y - 1)) {
          g.fillStyle(bank, 1).fillRect(px, py, size, 2); // sombra da margem
          g.fillStyle(foam, 1).fillRect(px, py + 2, size, 1);
        }
        if (!isWater(x, y + 1)) g.fillStyle(foam, 1).fillRect(px, py + size - 1, size, 1);
        if (!isWater(x - 1, y)) g.fillStyle(foam, 0.9).fillRect(px, py, 1, size);
        if (!isWater(x + 1, y)) g.fillStyle(foam, 0.9).fillRect(px + size - 1, py, 1, size);
      }
    }
  }

  /** As animações são globais (do jogo), por isso só se criam na primeira vez. */
  private createPlayerAnimations(): void {
    const define = (
      look: CharacterLook,
      key: string,
      columns: readonly number[],
      facing: Facing,
      frameRate: number,
    ): void => {
      if (this.anims.exists(key)) return;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(PLAYER_TEXTURES[look], {
          frames: columns.map((column) => characterFrame(facing, column)),
        }),
        frameRate,
        repeat: -1,
      });
    };
    for (const look of CHARACTER_LOOKS) {
      for (const facing of CHARACTER_ROWS) {
        define(look, walkAnimationKey(look, facing), CHARACTER_COLUMNS.walk, facing, WALK_FRAME_RATE);
        define(look, sneakAnimationKey(look, facing), CHARACTER_COLUMNS.sneakWalk, facing, SNEAK_FRAME_RATE);
      }
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
      // Ctrl agacha (o habitual nos jogos de PC); o Shift corre (ver `create`).
      sneak: add(KeyCodes.CTRL),
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
  /**
   * Arredonda uma coordenada do mundo à grelha de píxeis do ecrã (múltiplos de 1/zoom da
   * câmara). Com zoom inteiro, isto mantém a pixel art exata e deixa o movimento suave.
   */
  private toScreenGrid(value: number): number {
    const zoom = this.cameras.main.zoom;
    return Math.round(value * zoom) / zoom;
  }

  /**
   * Co-op: o anfitrião manda o mundo ao convidado ao entrar numa zona; o convidado refaz a cena
   * quando o anfitrião muda de zona ou de peças, e volta ao menu se a ligação cair.
   */
  private setupCoop(): void {
    coop.setAway(false);
    if (!coop.isGuest) return;
    coop.onSnapshot = () => {
      if (this.leaving) return;
      const zoneId = gameState.data.player.zoneId;
      // O anfitrião mudou-o de zona (morreu e voltou à base): muda de cena.
      if (zoneId !== this.zoneId) {
        this.leave(() => {
          this.scene.restart({ zoneId } satisfies ZoneSceneData);
        });
        return;
      }
      this.resyncWorld();
    };
    coop.onLost = () => {
      gameState.clear();
      this.scene.stop(SceneKey.UI);
      this.scene.start(SceneKey.MainMenu, { message: 'coop.lost' } satisfies MainMenuData);
    };
  }

  /**
   * Co-op (convidado): chegou o mundo do anfitrião. Refaz as peças (se mudaram), os recursos
   * apanhados, os contentores vazios e as mochilas no chão.
   */
  private resyncWorld(): void {
    const structures = JSON.stringify(gameState.data.base.structures);
    if (structures !== this.structuresKey) {
      this.structuresKey = structures;
      simulation.building.resync();
      for (const sprite of this.structureSprites.values()) sprite.destroy();
      for (const sprite of this.cropSprites.values()) sprite.destroy();
      this.structureSprites.clear();
      this.cropSprites.clear();
      for (const record of simulation.building.structures()) this.addStructureSprite(record);
    }
    for (const [objectId, sprite] of this.resourceSprites) {
      const depleted = simulation.interaction.isDepleted(objectId);
      if (sprite.visible === depleted) sprite.setVisible(!depleted).setAlpha(1);
    }
    simulation.interaction.refreshCollisions();
    this.renderContainers();
    this.renderBags();
    this.renderGround();
  }

  /** O outro jogador do co-op (se estiver nesta zona): posição interpolada, andar, golpe. */
  private renderOther(): void {
    const view = coop.otherAvatar(this.zoneId);
    if (!view) {
      this.other?.setVisible(false);
      return;
    }
    this.other ??= this.add
      .sprite(view.x, view.y, PLAYER_TEXTURES[view.look], characterFrame(view.facing, CHARACTER_COLUMNS.idle))
      .setOrigin(0.5, 1);
    const other = this.other;
    const texture = PLAYER_TEXTURES[view.look];
    if (other.texture.key !== texture) other.stop().setTexture(texture);
    // Com a mesma aparência, um tom azulado distingue o outro jogador.
    if (view.look === gameState.data.player.look) other.setTint(OTHER_TINT);
    else other.clearTint();
    const now = performance.now();
    const a = coop.alpha(now, view.at, coop.otherInterval);
    const x = this.toScreenGrid(view.px + (view.x - view.px) * a);
    const y = this.toScreenGrid(view.py + (view.y - view.py) * a);
    other.setVisible(true).setPosition(x, y).setDepth(y);
    const sinceAttack = now - coop.otherAttackAt;
    if (sinceAttack < ATTACK_MS) {
      const [raised, extended] = CHARACTER_COLUMNS.attack;
      other.stop();
      other.setFrame(characterFrame(view.facing, sinceAttack < ATTACK_MS / 2 ? raised : extended));
    } else if (view.moved) {
      other.play(
        view.sneak ? sneakAnimationKey(view.look, view.facing) : walkAnimationKey(view.look, view.facing),
        true,
      );
    } else {
      other.stop();
      other.setFrame(
        characterFrame(view.facing, view.sneak ? CHARACTER_COLUMNS.sneakIdle : CHARACTER_COLUMNS.idle),
      );
    }
  }

  private renderPlayer(): void {
    const player = this.player;
    if (!player) return;
    const state = gameState.data.player;
    const previous = simulation.previousPlayerPosition;
    const alpha = simulation.alpha;
    // Na grelha de píxeis do ECRÃ (múltiplos de 1/zoom), não de jogo: cada píxel de jogo continua
    // a cair em píxeis inteiros do ecrã (pixel art exata), mas o movimento fica zoom× mais fino.
    // A câmara segue o boneco, por isso o mundo inteiro também fica alinhado.
    const x = this.toScreenGrid(previous.x + (state.x - previous.x) * alpha);
    const y = this.toScreenGrid(previous.y + (state.y - previous.y) * alpha);
    player.setPosition(x, y).setDepth(y);
    // A aparência pode mudar no menu de pausa.
    const texture = PLAYER_TEXTURES[state.look];
    if (player.texture.key !== texture) player.stop().setTexture(texture);

    if (this.time.now < this.attackUntil) {
      // Golpe: frame "levantado" e depois "estendido".
      const [raised, extended] = CHARACTER_COLUMNS.attack;
      const column = this.attackUntil - this.time.now > ATTACK_MS / 2 ? raised : extended;
      player.stop();
      player.setFrame(characterFrame(state.facing, column));
    } else if (simulation.playerMoved) {
      const sneak = simulation.playerSneaking;
      player.play(
        sneak ? sneakAnimationKey(state.look, state.facing) : walkAnimationKey(state.look, state.facing),
        true,
      );
    } else {
      player.stop();
      const idle = simulation.playerSneaking ? CHARACTER_COLUMNS.sneakIdle : CHARACTER_COLUMNS.idle;
      player.setFrame(characterFrame(state.facing, idle));
    }
  }
}

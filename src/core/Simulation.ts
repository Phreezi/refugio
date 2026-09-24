import { FIXED_STEP_MS, MAX_STEPS_PER_FRAME, PLAYER_FOOTPRINT } from '../config';
import { BALANCE } from '../data/balance';
import type { ItemDefs } from '../data/types';
import type { CollisionWorld } from '../systems/movement/CollisionWorld';
import { isZero, ZERO, type Vec2 } from '../systems/movement/geometry';
import { facingFromIntent, moveWithCollision, normalize } from '../systems/movement/movement';
import { respawnVitals, survivalRules, tickSurvival } from '../systems/survival/survival';
import { eventBus, type EventBus, type GameEvents } from './EventBus';
import { FixedStep } from './FixedStep';
import { gameState, type GameState } from './GameState';
import { Building } from './Building';
import { Crafting, type CraftingContent } from './Crafting';
import { Interaction, type ZoneContext } from './Interaction';
import { PlayerActions } from './PlayerActions';
import { secondsToTicks } from './Clock';
import { content } from '../world/content';

/**
 * Corre a lógica do jogo em passo fixo. As cenas de jogo (Base, Zona) chamam
 * `update(delta)` uma vez por frame; os sistemas correm dentro de `tick()`.
 */
export class Simulation {
  private readonly clock = new FixedStep(FIXED_STEP_MS, MAX_STEPS_PER_FRAME);
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly survival = survivalRules(BALANCE);
  private readonly actionCooldownTicks = secondsToTicks(BALANCE.actionCooldownSec);
  readonly actions: PlayerActions;
  readonly interaction: Interaction;
  readonly crafting: Crafting;
  readonly building: Building;
  private actionHeld = false;
  private actionQueued = false;
  private nextActionTick = 0;
  private world: CollisionWorld | null = null;
  private respawnPoint: Vec2 | null = null;
  private intent: Vec2 = ZERO;
  private sneaking = false;
  private previous: Vec2 = ZERO;
  private moved = false;

  /**
   * @param items definições dos itens (lidas quando são precisas: carregam depois do arranque).
   * @param crafting receitas e estações (idem).
   */
  constructor(
    state: GameState,
    bus: EventBus<GameEvents>,
    items: () => ItemDefs = () => content.items,
    crafting: () => CraftingContent = () => ({
      items: content.items,
      recipes: content.recipes,
      stations: content.stations,
    }),
  ) {
    this.state = state;
    this.bus = bus;
    this.actions = new PlayerActions(state, bus, items);
    this.building = new Building(state, bus, this.actions);
    this.interaction = new Interaction(state, bus, this.actions, this.building);
    this.crafting = new Crafting(state, bus, crafting, this.actions);
  }

  /** Zona onde o jogador está: colisões, recursos, baús… (null = fora de uma cena de jogo). */
  setZone(zone: ZoneContext | null): void {
    this.world = zone?.collision ?? null;
    this.building.setZone(zone);
    this.interaction.setZone(zone);
  }

  /**
   * Ação contextual (Espaço/clique/botão). `held` = tecla/botão premido: repete golpes em
   * recursos ao ritmo de `actionCooldownSec`. Um toque rápido também conta (fica em fila).
   */
  setActionHeld(held: boolean): void {
    if (held && !this.actionHeld) this.actionQueued = true;
    this.actionHeld = held;
  }

  /** Geometria da zona onde o jogador está (null = sem movimento, ex.: fora de uma cena de jogo). */
  setWorld(world: CollisionWorld | null): void {
    this.world = world;
  }

  /** Onde o jogador reaparece se morrer (o `player_spawn` da base). */
  setRespawnPoint(point: Vec2 | null): void {
    this.respawnPoint = point;
  }

  /**
   * Direção pedida pelo input (é normalizada: nunca anda mais depressa na diagonal).
   * @param sneak agachado: anda a `sneakMultiplier` da velocidade (CLAUDE.md §7.8).
   */
  setMoveIntent(intent: Vec2, sneak = false): void {
    this.intent = normalize(intent);
    this.sneaking = sneak;
  }

  /** O jogador está agachado (para a animação; e, na Fase 6, para o raio de deteção). */
  get playerSneaking(): boolean {
    return this.sneaking;
  }

  /** @returns número de ticks executados. */
  update(deltaMs: number): number {
    return this.clock.advance(deltaMs, () => {
      this.tick();
    });
  }

  /** Fração [0, 1) até ao próximo tick, para interpolar posições no render. */
  get alpha(): number {
    return this.clock.alpha;
  }

  /** Posição dos pés do jogador antes do último tick (render: interpolar até à atual). */
  get previousPlayerPosition(): Vec2 {
    return this.previous;
  }

  /** O jogador mudou de posição no último tick? (para a animação de andar). */
  get playerMoved(): boolean {
    return this.moved;
  }

  /** Descarta tempo acumulado e o movimento anterior (ex.: ao entrar numa cena de jogo). */
  reset(): void {
    this.clock.reset();
    this.intent = ZERO;
    this.moved = false;
    this.actionHeld = false;
    this.actionQueued = false;
    this.nextActionTick = 0;
    if (this.state.hasGame) {
      const { x, y } = this.state.data.player;
      this.previous = { x, y };
    }
  }

  private tick(): void {
    const world = this.state.data.world;
    world.tick += 1;
    this.state.markDirty(); // o tempo de jogo avançou
    this.movePlayer();
    this.runAction(world.tick);
    this.interaction.tick(world.tick);
    this.crafting.advance(1);
    if (tickSurvival(this.state.data.player, world.tick, this.survival)) this.respawn();
    this.bus.emit('world:tick', { tick: world.tick });
  }

  private runAction(tick: number): void {
    if (!(this.actionQueued || this.actionHeld) || tick < this.nextActionTick) return;
    this.actionQueued = false;
    const done = this.interaction.act(PLAYER_FOOTPRINT);
    if (done === null) return;
    this.nextActionTick = tick + this.actionCooldownTicks;
    // Abrir um baú, beber ou abrir uma porta não se repete com a tecla presa (só golpes em recursos).
    if (done === 'chest' || done === 'drink' || done === 'door') this.actionHeld = false;
  }

  private respawn(): void {
    const player = this.state.data.player;
    respawnVitals(player, this.survival);
    if (this.respawnPoint) {
      player.x = this.respawnPoint.x;
      player.y = this.respawnPoint.y;
      // Sem interpolação: o jogador aparece logo no sítio novo.
      this.previous = { x: player.x, y: player.y };
    }
    this.bus.emit('player:died', { zoneId: player.zoneId });
  }

  private movePlayer(): void {
    const player = this.state.data.player;
    this.previous = { x: player.x, y: player.y };
    this.moved = false;
    if (this.world === null || isZero(this.intent)) return;

    player.facing = facingFromIntent(this.intent, player.facing);
    const speed = BALANCE.playerSpeed * (this.sneaking ? BALANCE.sneakMultiplier : 1);
    const step = (speed * FIXED_STEP_MS) / 1000;
    const delta = { x: this.intent.x * step, y: this.intent.y * step };
    const next = moveWithCollision(player, PLAYER_FOOTPRINT, delta, this.world);
    this.moved = next.x !== player.x || next.y !== player.y;
    player.x = next.x;
    player.y = next.y;
  }
}

export const simulation = new Simulation(gameState, eventBus);

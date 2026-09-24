import { FIXED_STEP_MS, MAX_STEPS_PER_FRAME, PLAYER_FOOTPRINT } from '../config';
import { BALANCE } from '../data/balance';
import type { ItemDefs } from '../data/types';
import type { CollisionWorld } from '../systems/movement/CollisionWorld';
import { isZero, ZERO, type Vec2 } from '../systems/movement/geometry';
import { facingFromIntent, moveWithCollision, normalize } from '../systems/movement/movement';
import { respawnVitals, survivalRules, tickSurvival } from '../systems/survival/survival';
import { eventBus, type EventBus, type GameEvents } from './EventBus';
import { FixedStep } from './FixedStep';
import { BASE_ZONE_ID, gameState, type GameState } from './GameState';
import { Building } from './Building';
import { Combat, type CombatContent } from './Combat';
import { Fishing } from './Fishing';
import { Crafting, type CraftingContent } from './Crafting';
import { Interaction, type ZoneContext } from './Interaction';
import { PlayerActions } from './PlayerActions';
import { secondsToTicks } from './Clock';
import { content } from '../world/content';
import { arrivalPoint, canTravel, type TravelCost } from '../systems/travel/travel';
import type { ZoneMap } from '../world/zoneMap';

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
  readonly combat: Combat;
  readonly fishing: Fishing;
  /** Zona para onde o jogador está a sair (a cena faz a transição). */
  private leavingTo: string | null = null;
  private exits: ZoneMap['exits'] = [];
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
    combat: () => CombatContent = () => ({
      items: content.items,
      enemies: content.enemies,
      enemyGroups: content.enemyGroups,
    }),
  ) {
    this.state = state;
    this.bus = bus;
    this.actions = new PlayerActions(state, bus, items);
    this.building = new Building(state, bus, this.actions);
    this.combat = new Combat(state, bus, this.actions, combat);
    this.fishing = new Fishing(state, bus, this.actions, items);
    this.interaction = new Interaction(state, bus, this.actions, this.building, this.combat, this.fishing);
    this.crafting = new Crafting(state, bus, crafting, this.actions);
  }

  /** Zona onde o jogador está: colisões, recursos, baús… (null = fora de uma cena de jogo). */
  setZone(zone: ZoneContext | null): void {
    this.world = zone?.collision ?? null;
    this.exits = zone?.map.exits ?? [];
    this.leavingTo = null;
    this.fishing.cancel();
    this.building.setZone(zone);
    this.combat.setZone(zone);
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

  /**
   * Passa o jogador para a zona `to` (chamado pela cena na transição): fica no ponto de chegada
   * (junto à saída que leva de volta, ou no `player_spawn`).
   */
  enterZone(to: string, map: ZoneMap, via?: { x: number; y: number }): void {
    const player = this.state.data.player;
    const from = player.zoneId === to ? null : player.zoneId;
    const at = arrivalPoint(map, via ? null : from, via);
    player.zoneId = to;
    player.x = at.x;
    player.y = at.y;
    this.state.markDirty();
  }

  /**
   * Viagem pelo mapa-mundo (CLAUDE.md §8.1): paga a fome/sede e entra na zona `to` pela saída
   * que dá para o mapa-mundo. @returns false se o jogador estiver demasiado fraco.
   */
  travel(to: string, map: ZoneMap, cost: TravelCost): boolean {
    const player = this.state.data.player;
    if (!canTravel(player, cost)) return false;
    player.hunger -= cost.hunger;
    player.thirst -= cost.thirst;
    const at = arrivalPoint(map, null);
    player.zoneId = to;
    player.x = at.x;
    player.y = at.y;
    this.state.markDirty();
    return true;
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
    this.checkExits();
    this.runAction(world.tick);
    this.interaction.tick(world.tick);
    this.combat.tick(this.sneaking);
    this.crafting.advance(1);
    tickSurvival(this.state.data.player, world.tick, this.survival);
    if (this.state.data.player.hp <= 0) this.respawn();
    this.bus.emit('world:tick', { tick: world.tick });
  }

  /** Pisar uma saída leva a outra zona (uma vez; a cena trata da transição). */
  private checkExits(): void {
    if (this.leavingTo !== null || !this.moved) return;
    const player = this.state.data.player;
    const exit = this.exits.find((e) => Math.hypot(e.x - player.x, e.y - player.y) <= BALANCE.exitReachPx);
    if (!exit) return;
    // Sem destino, a saída abre o mapa-mundo (a cena decide para onde se vai).
    this.leavingTo = exit.to ?? 'world';
    this.bus.emit('zone:change', { from: player.zoneId, to: exit.to, exit: { x: exit.x, y: exit.y } });
  }

  private runAction(tick: number): void {
    if (!(this.actionQueued || this.actionHeld) || tick < this.nextActionTick) return;
    this.actionQueued = false;
    // A pescar, o botão de ação é o "puxar" do mini-jogo.
    if (this.fishing.active) {
      this.fishing.strike();
      this.actionHeld = false;
      this.nextActionTick = tick + this.actionCooldownTicks;
      return;
    }
    const done = this.interaction.act(PLAYER_FOOTPRINT);
    if (done === null) return;
    // Golpes (em inimigos ou no ar) seguem o ritmo da arma; o resto, o ritmo normal.
    const attack = done === 'enemy' || done === 'swing';
    this.nextActionTick = tick + (attack ? this.combat.attackTicks() : this.actionCooldownTicks);
    // Abrir um baú, beber ou abrir uma porta não se repete com a tecla presa (só golpes em recursos).
    if (done !== 'enemy' && done !== 'resource' && done !== 'swing') this.actionHeld = false;
  }

  /**
   * Morte (CLAUDE.md §7.12): o conteúdo da mochila fica numa mochila no chão onde morreu; a
   * hotbar e o equipamento ficam com o jogador, que reaparece na base.
   */
  private respawn(): void {
    const player = this.state.data.player;
    const zoneId = player.zoneId;
    const bag = this.combat.dropBag(zoneId, player.x, player.y, player.inventory, true);
    if (bag) player.inventory.fill(null);
    respawnVitals(player, this.survival);
    player.zoneId = BASE_ZONE_ID;
    if (this.respawnPoint) {
      player.x = this.respawnPoint.x;
      player.y = this.respawnPoint.y;
      // Sem interpolação: o jogador aparece logo no sítio novo.
      this.previous = { x: player.x, y: player.y };
    }
    this.bus.emit('player:died', { zoneId, bag: bag !== null });
  }

  private movePlayer(): void {
    const player = this.state.data.player;
    this.previous = { x: player.x, y: player.y };
    this.moved = false;
    if (this.world === null || isZero(this.intent) || this.fishing.active) return;

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

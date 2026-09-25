import { FIXED_STEP_MS, MAX_STEPS_PER_FRAME, PLAYER_FOOTPRINT } from '../config';
import { BALANCE } from '../data/balance';
import type { ItemDefs } from '../data/types';
import type { CollisionWorld } from '../systems/movement/CollisionWorld';
import { isZero, ZERO, type Vec2 } from '../systems/movement/geometry';
import { facingFromIntent, moveWithCollision, normalize } from '../systems/movement/movement';
import { respawnVitals, survivalRules, tickSurvival } from '../systems/survival/survival';
import { eventBus, type EventBus, type GameEvents } from './EventBus';
import { FixedStep } from './FixedStep';
import { BASE_ZONE_ID, gameState, type GameState, type PlayerState } from './GameState';
import { Building } from './Building';
import { Combat, type CombatContent } from './Combat';
import { Fishing } from './Fishing';
import { Homestead } from './Homestead';
import { Horde, type HordeContent } from './Horde';
import { Stats } from './Stats';
import { Tutorial } from './Tutorial';
import { Progression, type ProgressionContent } from './Progression';
import { Crafting, type CraftingContent } from './Crafting';
import { Interaction, type ZoneContext } from './Interaction';
import { PlayerActions } from './PlayerActions';
import { secondsToTicks } from './Clock';
import { content } from '../world/content';
import { arrivalPoint, canTravel, type TravelCost } from '../systems/travel/travel';
import type { ZoneMap } from '../world/zoneMap';
import { buildZoneContext } from '../world/zoneContext';

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
  readonly homestead: Homestead;
  readonly horde: Horde;
  readonly stats: Stats;
  readonly tutorial: Tutorial;
  readonly progression: Progression;
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
  private zone: ZoneContext | null = null;
  /**
   * Co-op (no ecrã do convidado): o mundo corre no anfitrião; aqui só se anda (e se prevê o
   * relógio) e a ação é pedida ao anfitrião.
   */
  remote: { act(held: boolean, tick: number): void } | null = null;
  /** Co-op (no anfitrião): a simulação do jogador principal, se esta for a do convidado. */
  private primary: Simulation | null = null;
  /** Co-op (no anfitrião): as simulações dos convidados (correm dentro do tick desta). */
  private readonly secondaries: Simulation[] = [];
  /** Convidado na mesma zona do anfitrião: partilham inimigos, peças e colisões. */
  private linked = false;
  /** Co-op: contexto de uma zona para um convidado que está noutra (substituível nos testes). */
  contextFor: (zoneId: string) => ZoneContext = buildZoneContext;
  /**
   * Ataque automático (botão "Auto" do HUD): sem a ação premida, bate ou dispara sozinho no
   * inimigo mais perto que esteja ao alcance da arma.
   */
  autoAttack = false;
  /** Tick (no ecrã do convidado) em que carregou na ação: a pesca usa-o. */
  private strikeTick: number | null = null;

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
    progression: () => ProgressionContent = () => ({
      recipes: content.recipes,
      structures: content.structures,
      zones: content.zones,
      resources: content.resources,
      enemies: content.enemies,
    }),
    horde: () => HordeContent = () => ({
      items: content.items,
      enemyGroups: content.enemyGroups,
      lootTables: content.lootTables,
    }),
  ) {
    this.state = state;
    this.bus = bus;
    this.actions = new PlayerActions(state, bus, items);
    this.progression = new Progression(state, bus, progression);
    this.actions.readNote = (recipe) => this.progression.learn(recipe);
    this.actions.dropItems = (items) => this.combat.dropHere(items);
    this.building = new Building(state, bus, this.actions);
    this.building.isUnlocked = (id) => this.progression.isStructureUnlocked(id);
    this.combat = new Combat(state, bus, this.actions, combat);
    this.combat.building = this.building;
    this.stats = new Stats(state, bus);
    this.tutorial = new Tutorial(state, bus);
    this.horde = new Horde(state, bus, this.combat, horde);
    this.fishing = new Fishing(state, bus, this.actions, items);
    this.homestead = new Homestead(state, bus, this.actions, this.building, items);
    this.interaction = new Interaction(
      state,
      bus,
      this.actions,
      this.building,
      this.combat,
      this.fishing,
      this.homestead,
    );
    this.crafting = new Crafting(state, bus, crafting, this.actions);
    this.crafting.isUnlocked = (recipe) => this.progression.isRecipeUnlocked(recipe);
  }

  /** Zona onde o jogador está: colisões, recursos, baús… (null = fora de uma cena de jogo). */
  setZone(zone: ZoneContext | null): void {
    // O convidado ligado a esta zona fica com ela (e com os inimigos que lá estão).
    for (const secondary of this.secondaries) secondary.unlink();
    this.linked = false;
    this.zone = zone;
    this.world = zone?.collision ?? null;
    this.exits = zone?.map.exits ?? [];
    this.leavingTo = null;
    this.fishing.cancel();
    this.building.setZone(zone);
    this.combat.setZone(zone);
    // Co-op (convidado): os inimigos são os do anfitrião (chegam pela rede).
    if (this.remote) this.combat.setRemote([]);
    this.horde.setZone(zone);
    if (zone) this.progression.visit(zone.zoneId);
    this.interaction.setZone(zone);
    this.syncLinks();
  }

  /** Zona atual (id), ou null. */
  get zoneId(): string | null {
    return this.zone?.zoneId ?? null;
  }

  /** Co-op (anfitrião): junta a simulação de um convidado (corre dentro do tick desta). */
  attach(secondary: Simulation): void {
    if (this.secondaries.includes(secondary)) return;
    secondary.primary = this;
    this.secondaries.push(secondary);
    this.syncLinks();
  }

  /** Co-op (anfitrião): o convidado saiu. */
  detach(secondary: Simulation): void {
    const index = this.secondaries.indexOf(secondary);
    if (index < 0) return;
    secondary.unlink();
    secondary.setZone(null);
    secondary.primary = null;
    this.secondaries.splice(index, 1);
  }

  /**
   * Co-op: cada convidado na mesma zona que o jogador principal partilha a zona dele (inimigos,
   * peças, colisões); noutra zona, tem a sua (o mundo — baús, recursos, contentores — é sempre
   * o mesmo).
   */
  private syncLinks(): void {
    for (const secondary of this.secondaries) {
      const zoneId = secondary.state.data.player.zoneId;
      if (zoneId === this.zone?.zoneId) {
        if (!secondary.linked) secondary.linkTo(this);
      } else if (secondary.linked || secondary.zone?.zoneId !== zoneId) {
        secondary.unlink();
        if (secondary.zone?.zoneId !== zoneId) secondary.setZone(this.contextFor(zoneId));
      }
    }
  }

  private linkTo(primary: Simulation): void {
    const zone = primary.zone;
    if (!zone) return;
    this.linked = true;
    this.zone = zone;
    this.world = zone.collision;
    this.exits = zone.map.exits;
    this.leavingTo = null;
    this.fishing.cancel();
    this.combat.link(primary.combat);
    this.building.link(primary.building);
    this.progression.visit(zone.zoneId);
    this.interaction.setZone(zone);
  }

  private unlink(): void {
    if (!this.linked) return;
    this.linked = false;
    this.combat.unlink();
    this.building.unlink();
  }

  /** Co-op: multiplicador de vida e dano dos inimigos que nascem (§Fase 15). */
  setDifficulty(multiplier: number): void {
    this.combat.setDifficulty(multiplier);
    for (const secondary of this.secondaries) secondary.combat.setDifficulty(multiplier);
  }

  /** Co-op: o jogador está no mapa-mundo ou em pausa (não age e os inimigos ignoram-no). */
  set away(away: boolean) {
    this.combat.away = away;
  }

  get away(): boolean {
    return this.combat.away;
  }

  /**
   * Co-op (anfitrião): onde está o convidado (ele anda no ecrã dele e o anfitrião confia na
   * posição, como num jogo entre amigos).
   */
  setRemotePlayer(x: number, y: number, facing: PlayerState['facing'], moved: boolean, sneak: boolean): void {
    const player = this.state.data.player;
    this.previous = { x: player.x, y: player.y };
    player.x = x;
    player.y = y;
    player.facing = facing;
    this.moved = moved;
    this.sneaking = sneak;
    if (moved) this.tutorial.playerMoved();
  }

  /**
   * Ação contextual (Espaço/clique/botão). `held` = tecla/botão premido: repete golpes em
   * recursos ao ritmo de `actionCooldownSec`. Um toque rápido também conta (fica em fila).
   */
  setActionHeld(held: boolean, atTick?: number): void {
    // Co-op (convidado): quem faz a ação é o anfitrião.
    if (this.remote) {
      if (held !== this.actionHeld && this.state.hasGame) this.remote.act(held, this.state.data.world.tick);
      this.actionHeld = held;
      return;
    }
    if (held && !this.actionHeld) {
      this.actionQueued = true;
      this.strikeTick = atTick ?? null;
    }
    // Ao largar a ação, a mira deixa de estar presa (o próximo tiro vai ao mais perto).
    if (!held) this.combat.releaseLock();
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
  travel(to: string, map: ZoneMap, cost: TravelCost, atSpawn = false): boolean {
    const player = this.state.data.player;
    if (!canTravel(player, cost)) return false;
    player.hunger -= cost.hunger;
    player.thirst -= cost.thirst;
    // Num piso de baixo de uma masmorra (checkpoint), aparece-se no início do piso.
    const at = atSpawn ? { ...map.playerSpawn } : arrivalPoint(map, null);
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
    // Co-op (convidado): o mundo corre no anfitrião; aqui só se anda e se prevê o relógio e as
    // estações (o anfitrião manda o estado certo de vez em quando).
    if (this.remote) {
      world.tick += 1;
      this.movePlayer();
      this.checkExits();
      this.crafting.advance(1);
      return;
    }
    // A simulação de um convidado corre dentro do tick do jogador principal.
    if (this.primary) return;
    world.tick += 1;
    this.state.markDirty(); // o tempo de jogo avançou
    this.movePlayer();
    if (this.moved) this.tutorial.playerMoved();
    this.combat.collectGround();
    this.combat.tickCorpses();
    this.combat.syncQuiver();
    this.combat.pruneBags();
    this.checkExits();
    this.runAction(world.tick);
    for (const secondary of this.secondaries) secondary.tickSecondary(world.tick);
    if (this.secondaries.length > 0) this.syncLinks();
    this.interaction.tick(world.tick);
    this.combat.tick(this.sneaking);
    this.horde.tick();
    this.stats.tick();
    this.crafting.advance(1);
    tickSurvival(this.state.data.player, world.tick, this.survival);
    this.tickBleeding(world.tick);
    if (this.state.data.player.hp <= 0) this.respawn();
    this.bus.emit('world:tick', { tick: world.tick });
  }

  /**
   * Co-op (anfitrião): um tick do convidado. A posição chega pela rede; o relógio, as estações
   * e a horda são do mundo (correm uma vez, no principal); na mesma zona, os inimigos também.
   */
  private tickSecondary(tick: number): void {
    if (this.combat.away) return;
    this.combat.sneaking = this.sneaking;
    this.combat.collectGround();
    this.combat.tickCorpses();
    this.combat.syncQuiver();
    this.combat.pruneBags();
    this.runAction(tick);
    if (!this.linked && this.zone) {
      this.interaction.tick(tick);
      this.combat.tick(this.sneaking);
    }
    this.stats.tick();
    tickSurvival(this.state.data.player, tick, this.survival);
    this.tickBleeding(tick);
    if (this.state.data.player.hp <= 0) this.respawn();
  }

  /** A sangrar: perde vida devagar até acabar o tempo ou usar uma ligadura (nunca instantâneo). */
  private tickBleeding(tick: number): void {
    const player = this.state.data.player;
    if (player.bleed === 0) return;
    player.bleed -= 1;
    if (tick % secondsToTicks(BALANCE.bleedEverySec) === 0) player.hp = Math.max(0, player.hp - 1);
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
    if (tick < this.nextActionTick) return;
    if (!(this.actionQueued || this.actionHeld)) {
      if (this.autoAttack) this.runAutoAttack(tick);
      return;
    }
    this.actionQueued = false;
    const strikeTick = this.strikeTick ?? undefined;
    this.strikeTick = null;
    // A pescar, o botão de ação é o "puxar" do mini-jogo.
    if (this.fishing.active) {
      this.fishing.strike(strikeTick);
      this.actionHeld = false;
      this.nextActionTick = tick + this.actionCooldownTicks;
      return;
    }
    // Arma à distância: dispara no inimigo mais perto (se houver); senão, a ação normal. Com a
    // ação premida, a mira fica presa ao mesmo inimigo até se largar.
    const shot = this.combat.shoot(this.actionHeld);
    if (shot !== null) {
      this.nextActionTick = tick + this.combat.attackTicks();
      if (shot === 'no_ammo') {
        const ammo = this.combat.weapon().ranged?.ammo;
        this.bus.emit('action:blocked', { reason: 'needs_item', ...(ammo ? { item: ammo } : {}) });
        this.actionHeld = false;
      }
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

  /** Ataque automático: vira-se para o inimigo mais perto ao alcance e bate (ou dispara). */
  private runAutoAttack(tick: number): void {
    if (this.fishing.active) return;
    const weapon = this.combat.weapon();
    const target = weapon.ranged
      ? this.combat.nearestInRange(weapon.ranged.range)
      : this.combat.nearestInReach(PLAYER_FOOTPRINT, weapon.reach);
    if (!target) return;
    if (weapon.ranged) {
      // Sem munição não insiste (nem avisa a cada tick).
      if (this.combat.shoot() === 'shot') this.nextActionTick = tick + this.combat.attackTicks();
      return;
    }
    const player = this.state.data.player;
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    player.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    this.bus.emit('player:action', { kind: 'attack' });
    this.combat.attack(target.uid);
    this.nextActionTick = tick + this.combat.attackTicks();
  }

  /**
   * Morte (CLAUDE.md §7.12): o conteúdo da mochila fica numa mochila no chão onde morreu; a
   * hotbar e o equipamento ficam com o jogador, que reaparece na base.
   */
  private respawn(): void {
    const player = this.state.data.player;
    const zoneId = player.zoneId;
    this.horde.playerDied();
    const bag = this.combat.dropBag(zoneId, player.x, player.y, player.inventory, true);
    if (bag) player.inventory.fill(null);
    respawnVitals(player, this.survival);
    player.bleed = 0;
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

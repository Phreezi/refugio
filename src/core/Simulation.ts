import { FIXED_STEP_MS, MAX_STEPS_PER_FRAME, PLAYER_FOOTPRINT } from '../config';
import { BALANCE } from '../data/balance';
import type { ItemDefs } from '../data/types';
import type { CollisionWorld } from '../systems/movement/CollisionWorld';
import { isZero, ZERO, type Vec2 } from '../systems/movement/geometry';
import { facingFromIntent, moveWithCollision, normalize } from '../systems/movement/movement';
import { respawnVitals, survivalRules, tickSurvival, type SurvivalRules } from '../systems/survival/survival';
import { talentOf } from '../data/talents';
import { eventBus, type EventBus, type GameEvents } from './EventBus';
import { FixedStep } from './FixedStep';
import { BASE_ZONE_ID, gameState, type GameState, type PlayerState } from './GameState';
import { Building, structureStationKey } from './Building';
import { Combat, type CombatContent } from './Combat';
import { Fishing } from './Fishing';
import { Homestead } from './Homestead';
import { Horde, type HordeContent } from './Horde';
import { Stats } from './Stats';
import { Tutorial } from './Tutorial';
import { Quests, type QuestContent } from './Quests';
import { removeItem } from '../systems/inventory/inventory';
import { Progression, type ProgressionContent } from './Progression';
import { Crafting, type CraftingContent } from './Crafting';
import { Interaction, type ZoneContext } from './Interaction';
import { PlayerActions } from './PlayerActions';
import { secondsToTicks, TICKS_PER_SECOND } from './Clock';
import { content } from '../world/content';
import { arrivalPoint, canTravel, type TravelCost } from '../systems/travel/travel';
import type { ZoneMap } from '../world/zoneMap';
import { buildZoneContext } from '../world/zoneContext';

/**
 * Corre a lógica do jogo em passo fixo. As cenas de jogo (Base, Zona) chamam
 * `update(delta)` uma vez por frame; os sistemas correm dentro de `tick()`.
 */
/**
 * Saídas que abrem o mapa-mundo (ou levam a outra zona): as que estão numa abertura para uma
 * zona vizinha do mundo contínuo não contam — por ali passa-se a andar (Etapa E).
 */
function travelExits(zone: ZoneContext): ZoneMap['exits'] {
  if (!zone.neighborAt) return zone.map.exits;
  const { width, height, tileSize } = zone.map;
  return zone.map.exits.filter((exit) => {
    const tx = Math.floor(exit.x / tileSize);
    const ty = Math.floor(exit.y / tileSize);
    const outward: [number, number][] = [];
    if (tx === 0) outward.push([-1, ty]);
    if (ty === 0) outward.push([tx, -1]);
    if (tx === width - 1) outward.push([width, ty]);
    if (ty === height - 1) outward.push([tx, height]);
    return !outward.some(([ox, oy]) => !zone.collision.isSolidTile(ox, oy));
  });
}

/** Como se paga o teletransporte: moedas ou um pergaminho de viagem. */
export type TeleportPay = 'coins' | 'scroll';

/** Pergaminho de viagem (§7.18). */
export const TRAVEL_SCROLL = 'travel_scroll';

/** Prop dos postes de teletransporte nos mapas (`prop:waystone`). */
export const WAYSTONE_PROP = 'waystone';

export class Simulation {
  private readonly clock = new FixedStep(FIXED_STEP_MS, MAX_STEPS_PER_FRAME);
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private survival: SurvivalRules = survivalRules(BALANCE);
  private survivalKey = '{}';
  /** A correr (Shift / botão "Correr"): mais depressa, mas gasta muito mais fome e sede. */
  private running = false;
  private runHunger = 0;
  private runThirst = 0;
  /** Ataque automático sem munição: próximo aviso (não a cada tick). */
  private noAmmoWarnTick = 0;
  private readonly actionCooldownTicks = secondsToTicks(BALANCE.actionCooldownSec);
  readonly actions: PlayerActions;
  readonly interaction: Interaction;
  readonly crafting: Crafting;
  readonly building: Building;
  readonly combat: Combat;
  readonly fishing: Fishing;
  readonly homestead: Homestead;
  readonly quests: Quests;
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
  /** Voltar a casa: ticks que faltam (0 = parado) e a vida quando começou (dano cancela). */
  private recallLeft = 0;
  private recallHp = 0;
  private sneaking = false;
  private previous: Vec2 = ZERO;
  /** Mundo contínuo: não repetir o aviso "precisas de nível" a cada tick na borda. */
  private edgeWarnTick = 0;
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
  /** Opções do Auto: atacar e/ou recolher (preferências do dispositivo). */
  autoFight = true;
  autoGather = true;
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
    quests: () => QuestContent = () => ({
      quests: content.quests,
      npcs: content.npcs,
      waystones: content.waystones,
      items: content.items,
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
    this.quests = new Quests(state, bus, quests, this.actions, this.progression);
    // Falar com um NPC conta para as missões (e a interface abre a conversa).
    bus.on('npc:talk', ({ npc }) => {
      this.quests.talkTo(npc);
    });
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
    // Baús construídos com regras próprias (frigorífico: 60 espaços, só comida).
    this.actions.chestRules = (chestId) => {
      const uid = Number(chestId.slice(1));
      const record = chestId.startsWith('s')
        ? state.data.base.structures.find((r) => r[0] === uid)
        : undefined;
      const def = record ? this.building.def(record[1]) : undefined;
      if (!def) return null;
      // "Encomendar" abre a estação de encomendas deste frigorífico (`<estação>_s<uid>`).
      const orders = def.orders ? structureStationKey(def.orders, uid) : undefined;
      return { slots: def.chestSlots, foodOnly: def.foodOnly, ...(orders ? { orders } : {}) };
    };
    // Encomendas (§7.17): chegam à porta de casa (junto ao ponto onde se aparece na base).
    this.crafting.deliver = (items) => {
      const door = this.respawnPoint ?? { x: 0, y: 0 };
      this.combat.dropBag(BASE_ZONE_ID, door.x + BALANCE.deliveryOffsetPx, door.y, items, false);
    };
  }

  /** Zona onde o jogador está: colisões, recursos, baús… (null = fora de uma cena de jogo). */
  setZone(zone: ZoneContext | null, seamless = false): void {
    // O convidado ligado a esta zona fica com ela (e com os inimigos que lá estão).
    for (const secondary of this.secondaries) secondary.unlink();
    this.linked = false;
    this.zone = zone;
    this.world = zone?.collision ?? null;
    this.exits = zone ? travelExits(zone) : [];
    this.leavingTo = null;
    this.fishing.cancel();
    this.building.setZone(zone);
    this.combat.remote = this.remote !== null;
    this.combat.setZone(zone, seamless);
    // Co-op (convidado): os inimigos são os do anfitrião (chegam pela rede).
    if (this.remote) this.combat.setRemote([]);
    this.horde.setZone(zone);
    if (zone) {
      this.progression.visit(zone.zoneId);
      this.quests.visit(zone.zoneId);
    }
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
    this.exits = travelExits(zone);
    this.leavingTo = null;
    this.fishing.cancel();
    this.combat.link(primary.combat);
    this.building.link(primary.building);
    this.progression.visit(zone.zoneId);
    this.quests.visit(zone.zoneId);
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

  /** Mudou a dificuldade (definições): os inimigos da zona ajustam-se. */
  refreshDifficulty(): void {
    this.combat.refreshDifficulty();
    for (const secondary of this.secondaries) secondary.combat.refreshDifficulty();
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
  setRemotePlayer(
    x: number,
    y: number,
    facing: PlayerState['facing'],
    moved: boolean,
    sneak: boolean,
    run = false,
  ): void {
    const player = this.state.data.player;
    this.previous = { x: player.x, y: player.y };
    player.x = x;
    player.y = y;
    player.facing = facing;
    this.moved = moved;
    this.sneaking = sneak;
    this.running = run;
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

  /**
   * Teletransporte (Etapa E): sem custo, para a base ou para uma zona com o poste ativado;
   * chega-se ao lado do poste. @returns false se o destino não tiver poste ativado.
   */
  teleport(to: string, map: ZoneMap, pay: TeleportPay = 'coins'): boolean {
    const player = this.state.data.player;
    if (to !== BASE_ZONE_ID) {
      if (!this.state.data.waystones.includes(to)) return false;
      // Paga-se em moedas (mais, quanto mais perigosa a zona) ou com um pergaminho.
      if (pay === 'scroll') {
        if (!removeItem(this.actions.pickupContainers(), TRAVEL_SCROLL, 1)) return false;
      } else {
        const price = this.teleportPrice(to);
        if (player.coins < price) return false;
        player.coins -= price;
      }
    }
    const post = map.props.find((p) => p.id === WAYSTONE_PROP);
    const at = post ? { x: post.x, y: post.y + BALANCE.teleportArrivalPx } : { ...map.playerSpawn };
    player.zoneId = to;
    player.x = at.x;
    player.y = at.y;
    this.state.markDirty();
    this.bus.emit('inventory:changed', {});
    return true;
  }

  /**
   * Botão "Casa": ao fim de `recallSec` segundos parado (sem andar nem levar dano), volta-se à
   * base de qualquer lado, sem custo. @returns 'home' se já está na base.
   */
  startRecall(): 'started' | 'home' {
    const player = this.state.data.player;
    if (player.zoneId === BASE_ZONE_ID) return 'home';
    this.recallLeft = Math.max(1, Math.round(BALANCE.recallSec * TICKS_PER_SECOND));
    this.recallHp = player.hp;
    return 'started';
  }

  /** Interrompe a contagem do "Casa" (se houver). */
  cancelRecall(): void {
    if (this.recallLeft === 0) return;
    this.recallLeft = 0;
    this.bus.emit('home:recall_cancelled', {});
  }

  /** Contagem do "Casa": fração feita [0, 1] e segundos que faltam; null se parada. */
  get recall(): { progress: number; secondsLeft: number } | null {
    if (this.recallLeft === 0) return null;
    const total = Math.max(1, Math.round(BALANCE.recallSec * TICKS_PER_SECOND));
    return {
      progress: 1 - this.recallLeft / total,
      secondsLeft: Math.ceil(this.recallLeft / TICKS_PER_SECOND),
    };
  }

  private tickRecall(): void {
    if (this.recallLeft === 0) return;
    const player = this.state.data.player;
    if (this.intent.x !== 0 || this.intent.y !== 0 || player.hp < this.recallHp || player.hp <= 0) {
      this.cancelRecall();
      return;
    }
    this.recallHp = player.hp; // a regeneração não conta
    this.recallLeft -= 1;
    if (this.recallLeft === 0) this.bus.emit('home:recall', { zoneId: player.zoneId });
  }

  /** Moedas do teletransporte para uma zona (para casa é grátis). */
  teleportPrice(to: string): number {
    if (to === BASE_ZONE_ID) return 0;
    return BALANCE.teleportCoinsPerDanger * Math.max(1, this.progression.zoneDanger(to));
  }

  /** Onde o jogador reaparece se morrer (o `player_spawn` da base). */
  setRespawnPoint(point: Vec2 | null): void {
    this.respawnPoint = point;
  }

  /**
   * Direção pedida pelo input (é normalizada: nunca anda mais depressa na diagonal).
   * @param sneak agachado: anda a `sneakMultiplier` da velocidade (CLAUDE.md §7.8).
   */
  setMoveIntent(intent: Vec2, sneak = false, run = false): void {
    this.intent = normalize(intent);
    this.sneaking = sneak;
    this.running = run;
  }

  /** O jogador está a correr (e a andar)? (para a animação e o co-op). */
  get playerRunning(): boolean {
    return this.running && !this.sneaking;
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
    this.recallLeft = 0;
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
      this.tickRecall();
      this.movePlayer();
      this.checkExits();
      this.crafting.advance(1);
      return;
    }
    // A simulação de um convidado corre dentro do tick do jogador principal.
    if (this.primary) return;
    world.tick += 1;
    this.state.markDirty(); // o tempo de jogo avançou
    this.tickRecall();
    this.movePlayer();
    if (this.moved) this.tutorial.playerMoved();
    this.combat.collectGround();
    this.combat.syncQuiver();
    this.actions.syncBackpack();
    this.actions.sweepCoins();
    this.actions.tickBuffs(world.tick);
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
    tickSurvival(this.state.data.player, world.tick, this.survivalRules());
    this.tickRunDrain();
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
    this.combat.syncQuiver();
    this.actions.syncBackpack();
    this.actions.sweepCoins();
    this.actions.tickBuffs(tick);
    this.combat.pruneBags();
    this.runAction(tick);
    if (!this.linked && this.zone) {
      this.interaction.tick(tick);
      this.combat.tick(this.sneaking);
    }
    this.stats.tick();
    tickSurvival(this.state.data.player, tick, this.survivalRules());
    this.tickRunDrain();
    this.tickBleeding(tick);
    if (this.state.data.player.hp <= 0) this.respawn();
  }

  /** Ritmos de fome/sede/regeneração com os talentos do jogador (§7.15). */
  private survivalRules(): SurvivalRules {
    const player = this.state.data.player;
    const key = JSON.stringify(player.talents);
    if (key !== this.survivalKey) {
      this.survivalKey = key;
      this.survival = survivalRules(BALANCE, {
        hungerSlowPct: talentOf(player, 'hungerSlowPct'),
        thirstSlowPct: talentOf(player, 'thirstSlowPct'),
        regenPct: talentOf(player, 'regenPct'),
      });
    }
    return this.survival;
  }

  /**
   * A correr (Shift / botão "Correr"): gasta fome e sede `sprintDrainMultiplier` vezes mais
   * depressa enquanto anda (menos com o talento "Fôlego"). Frações acumuladas em memória.
   */
  private tickRunDrain(): void {
    if (!this.running || this.sneaking || !this.moved) return;
    const player = this.state.data.player;
    const rules = this.survivalRules();
    const extra = (BALANCE.sprintDrainMultiplier - 1) * (1 - talentOf(player, 'sprintCostPct') / 100);
    this.runHunger += extra / rules.hungerEveryTicks;
    this.runThirst += extra / rules.thirstEveryTicks;
    if (this.runHunger >= 1) {
      this.runHunger -= 1;
      player.hunger = Math.max(0, player.hunger - 1);
    }
    if (this.runThirst >= 1) {
      this.runThirst -= 1;
      player.thirst = Math.max(0, player.thirst - 1);
    }
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
    if (this.checkEdges()) return;
    const player = this.state.data.player;
    const exit = this.exits.find((e) => Math.hypot(e.x - player.x, e.y - player.y) <= BALANCE.exitReachPx);
    if (!exit) return;
    // Sem destino, a saída abre o mapa-mundo (a cena decide para onde se vai).
    this.leavingTo = exit.to ?? 'world';
    this.bus.emit('zone:change', { from: player.zoneId, to: exit.to, exit: { x: exit.x, y: exit.y } });
  }

  /**
   * Mundo contínuo (Etapa E): passou a borda do mapa para uma zona vizinha? Muda-se para lá sem
   * ecrã de viagem (a cena troca a zona); se o nível (ou o item pedido) não chegar, volta atrás.
   * @returns true se o jogador saiu do mapa (mudou de zona ou foi travado).
   */
  private checkEdges(): boolean {
    const zone = this.zone;
    const player = this.state.data.player;
    if (!zone?.neighborAt) return false;
    const { width, height, tileSize } = zone.map;
    if (player.x >= 0 && player.y >= 0 && player.x < width * tileSize && player.y < height * tileSize)
      return false;
    const next = zone.neighborAt(player.x, player.y);
    const level = next ? this.progression.zoneLevel(next.zoneId) : 1;
    const missing = next ? this.progression.missingItem(next.zoneId) : null;
    if (!next || !this.progression.isZoneUnlocked(next.zoneId) || missing) {
      player.x = this.previous.x;
      player.y = this.previous.y;
      const tick = this.state.data.world.tick;
      if (next && tick >= this.edgeWarnTick) {
        this.edgeWarnTick = tick + secondsToTicks(BALANCE.noAmmoWarnSec);
        if (missing) this.bus.emit('action:blocked', { reason: 'needs_item', item: missing });
        else this.bus.emit('action:blocked', { reason: 'zone_level', level });
      }
      return true;
    }
    this.leavingTo = next.zoneId;
    this.bus.emit('zone:cross', { from: zone.zoneId, to: next.zoneId, x: next.x, y: next.y });
    return true;
  }

  /**
   * Mundo contínuo: entra na zona vizinha exatamente no ponto (x, y) dela (continua a andar sem
   * saltos). A cena chama isto ao receber `zone:cross` (no co-op, é um comando do convidado).
   */
  crossTo(to: string, _map: ZoneMap, x: number, y: number): void {
    const player = this.state.data.player;
    // A posição anterior passa para as coordenadas da zona nova (a interpolação não salta).
    this.previous = { x: this.previous.x + x - player.x, y: this.previous.y + y - player.y };
    player.zoneId = to;
    player.x = x;
    player.y = y;
    this.state.markDirty();
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
    // Com o ataque automático, a ação manual apanha/abre o que estiver à frente (mesmo a meio
    // de um combate); só sem nada disso é que ataca.
    if (this.autoAttack && this.interaction.currentTarget(PLAYER_FOOTPRINT, true)) {
      const done = this.interaction.act(PLAYER_FOOTPRINT, true);
      this.nextActionTick = tick + this.actionCooldownTicks;
      if (done !== 'resource') this.actionHeld = false;
      return;
    }
    // Arma à distância: dispara no inimigo mais perto (se houver); senão, a ação normal. Com a
    // ação premida, a mira fica presa ao mesmo inimigo até se largar.
    const shot = this.combat.shoot(this.actionHeld);
    if (shot !== null) {
      this.nextActionTick = tick + this.combat.attackTicks();
      if (shot === 'no_ammo') {
        this.noAmmo();
        this.actionHeld = false;
      }
      return;
    }
    // Arma à distância sem munição e nada à frente: avisa (senão parecia que não fazia nada).
    const ranged = this.combat.weapon().ranged;
    if (ranged && this.combat.ammoCount() === 0 && !this.interaction.currentTarget(PLAYER_FOOTPRINT, true)) {
      this.noAmmo();
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

  /** Avisa que a arma à distância não tem munição. */
  private noAmmo(): void {
    const ammo = this.combat.weapon().ranged?.ammo;
    this.bus.emit('action:blocked', { reason: 'no_ammo', ...(ammo ? { item: ammo } : {}) });
  }

  /** Ataque automático: vira-se para o inimigo mais perto ao alcance e bate (ou dispara). */
  private runAutoAttack(tick: number): void {
    if (this.fishing.active) return;
    const weapon = this.combat.weapon();
    const target = !this.autoFight
      ? null
      : weapon.ranged
        ? this.combat.nearestInRange(weapon.ranged.range)
        : this.combat.nearestInReach(PLAYER_FOOTPRINT, weapon.reach);
    if (!target) {
      if (!this.autoGather) return;
      // Sem inimigos: recolhe sozinho o recurso à frente (árvores, pedras, bagas…).
      const ahead = this.interaction.currentTarget(PLAYER_FOOTPRINT, true);
      if (ahead?.data.type === 'resource') {
        this.interaction.act(PLAYER_FOOTPRINT, true);
        this.nextActionTick = tick + this.actionCooldownTicks;
      }
      return;
    }
    if (weapon.ranged) {
      const shot = this.combat.shoot();
      if (shot === 'shot') this.nextActionTick = tick + this.combat.attackTicks();
      // Sem munição avisa, mas não a cada tick.
      else if (shot === 'no_ammo' && tick >= this.noAmmoWarnTick) {
        this.noAmmo();
        this.noAmmoWarnTick = tick + secondsToTicks(BALANCE.noAmmoWarnSec);
      }
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
    const sprinting = this.running && !this.sneaking;
    const speed =
      BALANCE.playerSpeed *
      (this.sneaking ? BALANCE.sneakMultiplier : 1) *
      (sprinting ? BALANCE.sprintMultiplier : 1);
    const step = (speed * FIXED_STEP_MS) / 1000;
    const delta = { x: this.intent.x * step, y: this.intent.y * step };
    const next = moveWithCollision(player, PLAYER_FOOTPRINT, delta, this.world);
    this.moved = next.x !== player.x || next.y !== player.y;
    player.x = next.x;
    player.y = next.y;
  }
}

export const simulation = new Simulation(gameState, eventBus);

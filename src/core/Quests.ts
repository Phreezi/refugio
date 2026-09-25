import type { ItemDefs } from '../data/types';
import {
  goalProgress,
  questAvailable,
  questComplete,
  type NpcDefs,
  type QuestDef,
  type QuestState,
  type WaystoneCost,
} from '../systems/quests/quests';
import { addItem, countItem, removeItem } from '../systems/inventory/inventory';
import type { EventBus, GameEvents } from './EventBus';
import type { GameState } from './GameState';
import type { PlayerActions } from './PlayerActions';
import type { Progression } from './Progression';

export interface QuestContent {
  quests: readonly QuestDef[];
  npcs: NpcDefs;
  waystones: Readonly<Record<string, WaystoneCost>>;
  items: ItemDefs;
}

export type TurnInResult = 'ok' | 'not_ready' | 'no_space';
export type RepairResult = 'ok' | 'missing' | 'no_coins' | 'done';

/**
 * Missões e NPCs (CLAUDE.md §7.18): aceitar, contar o progresso (ouve os eventos), entregar e dar
 * a recompensa; e o técnico que repara os postes de teletransporte (itens + moedas). O estado
 * está em `player.quests` (no co-op, cada jogador tem as suas).
 */
export class Quests {
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly content: () => QuestContent;
  private readonly actions: PlayerActions;
  private readonly progression: Progression;

  constructor(
    state: GameState,
    bus: EventBus<GameEvents>,
    content: () => QuestContent,
    actions: PlayerActions,
    progression: Progression,
  ) {
    this.state = state;
    this.bus = bus;
    this.content = content;
    this.actions = actions;
    this.progression = progression;
    bus.on('enemy:killed', ({ enemy }) => {
      this.count((goal) => goal.type === 'kill' && (goal.enemy === 'any' || goal.enemy === enemy));
    });
  }

  private get quests(): QuestState {
    return this.state.data.player.quests;
  }

  private have = (item: string): number => {
    const { inventory, hotbar } = this.state.data.player;
    return countItem([inventory, hotbar], item);
  };

  /** Soma 1 aos objetivos das missões ativas que `match` escolhe. */
  private count(match: (goal: QuestDef['goals'][number]) => boolean): void {
    if (!this.state.hasGame) return;
    const active = this.quests.active;
    if (Object.keys(active).length === 0) return; // o normal: sem ler o conteúdo
    let changed = false;
    for (const quest of this.content().quests) {
      const saved = active[quest.id];
      if (!saved) continue;
      for (const [i, goal] of quest.goals.entries()) {
        if (!match(goal)) continue;
        const [done, total] = goalProgress(goal, saved[i] ?? 0, this.have);
        if (done >= total) continue;
        saved[i] = (saved[i] ?? 0) + 1;
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /** Entrou numa zona (objetivos "ir a"). */
  visit(zoneId: string): void {
    this.count((goal) => goal.type === 'reach' && goal.zone === zoneId);
  }

  /** Falou com um NPC (objetivos "falar com"). */
  talkTo(npcId: string): void {
    this.count((goal) => goal.type === 'talk' && goal.npc === npcId);
    this.bus.emit('npc:talked', { npc: npcId });
  }

  def(id: string): QuestDef | undefined {
    return this.content().quests.find((q) => q.id === id);
  }

  /** Missões que este NPC tem para dar agora. */
  offers(npcId: string): QuestDef[] {
    const level = this.state.data.player.level;
    return this.content().quests.filter((q) => q.giver === npcId && questAvailable(q, this.quests, level));
  }

  /** Missões ativas que se entregam a este NPC (prontas ou não). */
  handIns(npcId: string): QuestDef[] {
    return this.content().quests.filter((q) => q.turnIn === npcId && q.id in this.quests.active);
  }

  active(): QuestDef[] {
    return this.content().quests.filter((q) => q.id in this.quests.active);
  }

  /** Progresso de cada objetivo: [feito, total]. */
  progress(id: string): [number, number][] {
    const quest = this.def(id);
    const saved = this.quests.active[id] ?? [];
    return quest ? quest.goals.map((goal, i) => goalProgress(goal, saved[i] ?? 0, this.have)) : [];
  }

  ready(id: string): boolean {
    const quest = this.def(id);
    return quest !== undefined && questComplete(quest, this.quests.active[id] ?? [], this.have);
  }

  accept(id: string): boolean {
    const quest = this.def(id);
    if (!quest || !questAvailable(quest, this.quests, this.state.data.player.level)) return false;
    this.quests.active[id] = quest.goals.map(() => 0);
    // "Ir a" já feito se se estiver lá.
    this.visit(this.state.data.player.zoneId);
    this.changed();
    this.bus.emit('quest:accepted', { quest: id });
    return true;
  }

  /** Entrega: tira o que se pediu para recolher e dá a recompensa. */
  turnIn(id: string): TurnInResult {
    const quest = this.def(id);
    if (!quest || !this.ready(id)) return 'not_ready';
    const containers = this.actions.pickupContainers();
    const { items } = this.content();
    for (const goal of quest.goals) if (goal.type === 'collect') removeItem(containers, goal.item, goal.qty);
    // A recompensa: o que não couber na mochila fica numa pilha no chão (nada se perde).
    const overflow: [string, number][] = [];
    for (const [item, qty] of quest.reward.items) {
      const left = addItem(containers, item, qty, items);
      if (left > 0) overflow.push([item, left]);
    }
    if (overflow.length > 0) this.actions.dropItems(overflow);
    this.state.data.player.coins += quest.reward.coins;
    Reflect.deleteProperty(this.quests.active, id);
    this.quests.done.push(id);
    this.progression.gain(quest.reward.xp);
    this.changed();
    this.bus.emit('quest:done', { quest: id });
    return 'ok';
  }

  /** O que o técnico pede para reparar o poste da zona (null = não há poste a reparar). */
  waystoneCost(zoneId: string): WaystoneCost | null {
    return this.content().waystones[zoneId] ?? null;
  }

  waystoneActive(zoneId: string): boolean {
    return this.state.data.waystones.includes(zoneId);
  }

  /** Entrega ao técnico o material e as moedas: o poste da zona passa a funcionar. */
  repairWaystone(zoneId: string): RepairResult {
    if (this.waystoneActive(zoneId)) return 'done';
    const cost = this.waystoneCost(zoneId);
    if (!cost) return 'missing';
    if (cost.items.some(([item, qty]) => this.have(item) < qty)) return 'missing';
    const player = this.state.data.player;
    if (player.coins < cost.coins) return 'no_coins';
    for (const [item, qty] of cost.items) removeItem(this.actions.pickupContainers(), item, qty);
    player.coins -= cost.coins;
    this.state.data.waystones.push(zoneId);
    this.changed();
    this.bus.emit('waystone:activated', { zoneId });
    return 'ok';
  }

  private changed(): void {
    this.state.markDirty();
    this.bus.emit('quests:changed', {});
    this.bus.emit('inventory:changed', {});
  }
}

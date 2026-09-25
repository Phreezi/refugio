import { talentOf } from '../data/talents';
import { BALANCE } from '../data/balance';
import {
  HANDS,
  type ItemDefs,
  type Recipe,
  type Recipes,
  type StationDefs,
  isTradeCategory,
} from '../data/types';
import {
  advanceStation,
  cancelJob,
  collectOutput,
  craftInstant,
  enqueue,
  repairCost,
  repairSlot,
  type CraftResult,
} from '../systems/crafting/crafting';
import { secondsToTicks } from './Clock';
import type { EventBus, GameEvents } from './EventBus';
import { stationState, type GameState } from './GameState';
import type { PlayerActions, SlotRef } from './PlayerActions';

export interface CraftingContent {
  items: ItemDefs;
  recipes: Recipes;
  stations: StationDefs;
}

/** Chave de uma estação no save: `<tipo>_<id do objeto no Tiled>` (ex.: `campfire_90`). */
export function stationKey(type: string, objectId: number): string {
  return `${type}_${String(objectId)}`;
}

export function stationType(key: string): string {
  return key.slice(0, key.lastIndexOf('_'));
}

/**
 * Crafting do jogador (CLAUDE.md §7.5): mãos (instantâneo) e estações (fila com tempo de jogo),
 * recolher, cancelar, reparar ferramentas. Altera o GameState e emite eventos.
 */
export class Crafting {
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private readonly content: () => CraftingContent;
  private readonly actions: PlayerActions;
  /** A receita está desbloqueada (nível ou nota)? Por omissão, todas. */
  isUnlocked: (recipe: Recipe) => boolean = () => true;

  constructor(
    state: GameState,
    bus: EventBus<GameEvents>,
    content: () => CraftingContent,
    actions: PlayerActions,
  ) {
    this.state = state;
    this.bus = bus;
    this.content = content;
    this.actions = actions;
  }

  /** Receitas de uma estação (`hands` = mãos), pela ordem do JSON. */
  recipesFor(type: string): Recipe[] {
    return this.content().recipes.filter((r) => r.station === type);
  }

  /** Faz uma receita: nas mãos já; numa estação, põe-na na fila de `key`. */
  craft(recipeId: string, key: string | null): CraftResult {
    const { recipes, items, stations } = this.content();
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return 'missing';
    if (!this.isUnlocked(recipe)) return 'locked';
    const containers = this.actions.pickupContainers();
    let result: CraftResult;
    if (recipe.station === HANDS) {
      result = craftInstant(containers, recipe, items);
      if (result === 'ok')
        this.bus.emit('craft:finished', { stationKey: HANDS, item: recipe.output, recipe: recipe.id });
    } else if (isTradeCategory(recipe.category)) {
      // Troca com o comerciante: instantânea, mas só junto dele.
      if (!key || stationType(key) !== recipe.station) return 'missing';
      result = craftInstant(containers, recipe, items);
      if (result === 'ok') this.bus.emit('traded', { item: recipe.output });
    } else {
      if (!key || stationType(key) !== recipe.station) return 'missing';
      const max = stations[recipe.station]?.queue ?? 1;
      result = enqueue(
        stationState(this.state.data, key),
        containers,
        recipe,
        max,
        // Talento "fabrico rápido" (§7.15) de quem põe o trabalho na fila.
        Math.max(
          1,
          Math.round(
            secondsToTicks(recipe.timeSec) *
              (1 - Math.min(BALANCE.talentCapPct, talentOf(this.state.data.player, 'craftSpeedPct')) / 100),
          ),
        ),
      );
    }
    if (result === 'ok') this.changed();
    return result;
  }

  cancel(key: string, index: number): boolean {
    const { recipes, items } = this.content();
    const done = cancelJob(
      stationState(this.state.data, key),
      index,
      recipes,
      this.actions.pickupContainers(),
      items,
    );
    if (done) this.changed();
    return done;
  }

  /** Recolhe o que está pronto na estação para o inventário. @returns quantidade. */
  collect(key: string): number {
    const moved = collectOutput(
      stationState(this.state.data, key),
      this.actions.pickupContainers(),
      this.content().items,
    );
    if (moved > 0) this.changed();
    return moved;
  }

  /** Custo de reparar o item do slot (null se não precisar ou não der). */
  repairCostOf(ref: SlotRef): { item: string; qty: number }[] | null {
    const slot = this.actions.container(ref.container)[ref.index];
    const { items, recipes } = this.content();
    const max = slot ? items[slot[0]]?.durability : undefined;
    if (!slot || max === undefined || slot[2] === undefined) return null;
    return repairCost(slot[0], slot[2], max, recipes, BALANCE.repairCostPct);
  }

  repair(ref: SlotRef): boolean {
    const slot = this.actions.container(ref.container)[ref.index];
    const cost = this.repairCostOf(ref);
    const max = slot ? this.content().items[slot[0]]?.durability : undefined;
    if (!slot || !cost || max === undefined) return false;
    const done = repairSlot(slot, max, cost, this.actions.pickupContainers());
    if (done) this.changed();
    return done;
  }

  /** Avança as filas de todas as estações `ticks` ticks. @returns quantos trabalhos acabaram. */
  advance(ticks: number): number {
    const busy = Object.entries(this.state.data.stations).filter(([, station]) => station.queue.length > 0);
    if (busy.length === 0) return 0; // o caso normal: nada em fila (e sem ler o conteúdo)
    const { recipes, items } = this.content();
    let finished = 0;
    for (const [key, station] of busy) {
      for (const recipeId of advanceStation(station, ticks, recipes, items)) {
        finished++;
        const output = recipes.find((r) => r.id === recipeId)?.output ?? recipeId;
        this.bus.emit('craft:finished', { stationKey: key, item: output, recipe: recipeId });
      }
    }
    if (finished > 0) this.changed();
    return finished;
  }

  private changed(): void {
    this.state.markDirty();
    this.bus.emit('inventory:changed', {});
  }
}

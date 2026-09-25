import type { ItemDefs, Recipe, Recipes } from '../../data/types';
import { HANDS } from '../../data/types';
import {
  addItem,
  COIN,
  countItem,
  removeItem,
  type Container,
  type Slot,
  type Wallet,
} from '../inventory/inventory';

// Crafting (CLAUDE.md §7.5), lógica pura. Nas mãos é instantâneo; nas estações há uma fila
// (máx. 3) e só o primeiro trabalho avança. O resultado fica na saída da estação até ser
// recolhido. Tempos em ticks de jogo, para poderem avançar também offline (§7.6).

/** Trabalho em fila: [id da receita, ticks que faltam]. Compacto para o save (§10.5). */
export type CraftJob = [recipeId: string, remainingTicks: number];

export interface StationState {
  queue: CraftJob[];
  /** Itens prontos à espera de ser recolhidos. */
  output: Container;
}

export const STATION_OUTPUT_SLOTS = 6;

export interface Missing {
  item: string;
  have: number;
  need: number;
}

/** Quanto há de um ingrediente (as moedas estão na carteira, não nos slots). */
export function haveInput(containers: readonly Container[], item: string, wallet?: Wallet): number {
  return item === COIN && wallet ? wallet.coins : countItem(containers, item);
}

export function missingInputs(containers: readonly Container[], recipe: Recipe, wallet?: Wallet): Missing[] {
  return recipe.inputs
    .map(({ item, qty }) => ({ item, have: haveInput(containers, item, wallet), need: qty }))
    .filter((m) => m.have < m.need);
}

/** Tira os ingredientes (moedas da carteira). */
function takeInputs(containers: readonly Container[], recipe: Recipe, wallet?: Wallet): void {
  for (const { item, qty } of recipe.inputs) {
    if (item === COIN && wallet) wallet.coins -= qty;
    else removeItem(containers, item, qty);
  }
}

function snapshot(containers: readonly Container[]): (Slot | null)[][] {
  return containers.map((c) => c.map((slot) => (slot ? [...slot] : null)));
}

function restore(containers: readonly Container[], saved: (Slot | null)[][]): void {
  containers.forEach((c, i) => {
    c.splice(0, c.length, ...(saved[i] ?? []));
  });
}

export type CraftResult = 'ok' | 'missing' | 'no_space' | 'queue_full' | 'locked';

/** Craft nas mãos: consome os ingredientes e dá o resultado já (tudo ou nada). */
export function craftInstant(
  containers: readonly Container[],
  recipe: Recipe,
  items: ItemDefs,
  wallet?: Wallet,
): CraftResult {
  if (missingInputs(containers, recipe, wallet).length > 0) return 'missing';
  const saved = snapshot(containers);
  const coins = wallet?.coins ?? 0;
  takeInputs(containers, recipe, wallet);
  if (recipe.output === COIN && wallet) {
    wallet.coins += recipe.qty; // vender: as moedas vão para a carteira (cabem sempre)
    return 'ok';
  }
  if (addItem(containers, recipe.output, recipe.qty, items) > 0) {
    restore(containers, saved);
    if (wallet) wallet.coins = coins;
    return 'no_space';
  }
  return 'ok';
}

export function createStationState(): StationState {
  return { queue: [], output: new Array<Slot | null>(STATION_OUTPUT_SLOTS).fill(null) };
}

/** Põe uma receita na fila da estação (os ingredientes saem já do inventário). */
export function enqueue(
  station: StationState,
  containers: readonly Container[],
  recipe: Recipe,
  maxQueue: number,
  ticks: number,
  wallet?: Wallet,
): CraftResult {
  if (station.queue.length >= maxQueue) return 'queue_full';
  if (missingInputs(containers, recipe, wallet).length > 0) return 'missing';
  takeInputs(containers, recipe, wallet);
  station.queue.push([recipe.id, ticks]);
  return 'ok';
}

/** Cancela um trabalho e devolve os ingredientes (só se couberem). */
export function cancelJob(
  station: StationState,
  index: number,
  recipes: Recipes,
  containers: readonly Container[],
  items: ItemDefs,
  wallet?: Wallet,
): boolean {
  const job = station.queue[index];
  const recipe = job ? recipes.find((r) => r.id === job[0]) : undefined;
  if (!recipe) return false;
  const saved = snapshot(containers);
  for (const { item, qty } of recipe.inputs) {
    if (item === COIN && wallet) continue;
    if (addItem(containers, item, qty, items) > 0) {
      restore(containers, saved);
      return false;
    }
  }
  for (const { item, qty } of recipe.inputs) if (item === COIN && wallet) wallet.coins += qty;
  station.queue.splice(index, 1);
  return true;
}

/**
 * Avança a fila `ticks` ticks (a cada tick, ou de uma vez ao voltar de offline). Se a saída
 * estiver cheia, o trabalho acabado espera (não se perde nada).
 * @returns ids das receitas terminadas.
 */
export function advanceStation(
  station: StationState,
  ticks: number,
  recipes: Recipes,
  items: ItemDefs,
): string[] {
  const finished: string[] = [];
  let left = ticks;
  while (left > 0 || station.queue[0]?.[1] === 0) {
    const job = station.queue[0];
    if (!job) break;
    const used = Math.min(left, job[1]);
    job[1] -= used;
    left -= used;
    if (job[1] > 0) break;
    const recipe = recipes.find((r) => r.id === job[0]);
    if (!recipe) {
      station.queue.shift(); // receita que deixou de existir: descarta
      continue;
    }
    // Só sai da fila se couber na saída (tudo ou nada).
    const saved = snapshot([station.output]);
    if (addItem([station.output], recipe.output, recipe.qty, items) > 0) {
      restore([station.output], saved);
      break;
    }
    station.queue.shift();
    finished.push(recipe.id);
  }
  return finished;
}

/** Passa o que estiver pronto para o inventário. @returns quantidade recolhida. */
export function collectOutput(
  station: StationState,
  containers: readonly Container[],
  items: ItemDefs,
): number {
  let moved = 0;
  station.output.forEach((slot, i) => {
    if (!slot) return;
    const left = addItem(containers, slot[0], slot[1], items);
    moved += slot[1] - left;
    if (left === 0) station.output[i] = null;
    else slot[1] = left;
  });
  return moved;
}

/** Quantidade pronta a recolher. */
export function outputCount(station: StationState): number {
  return station.output.reduce((sum, slot) => sum + (slot?.[1] ?? 0), 0);
}

/**
 * Custo de reparar uma ferramenta até ao máximo: `pct`% dos ingredientes da receita de mãos que
 * a faz, proporcional ao desgaste (mínimo 1 de cada). null se não houver receita.
 */
export function repairCost(
  itemId: string,
  durability: number,
  maxDurability: number,
  recipes: Recipes,
  pct: number,
): { item: string; qty: number }[] | null {
  const recipe = recipes.find((r) => r.output === itemId && r.station === HANDS);
  if (!recipe || durability >= maxDurability) return null;
  const wear = 1 - durability / maxDurability;
  return recipe.inputs.map(({ item, qty }) => ({
    item,
    qty: Math.max(1, Math.ceil((qty * pct * wear) / 100)),
  }));
}

/** Repara o slot (durabilidade ao máximo) pagando o custo. @returns false se faltar material. */
export function repairSlot(
  slot: Slot,
  maxDurability: number,
  cost: readonly { item: string; qty: number }[],
  containers: readonly Container[],
): boolean {
  if (cost.some(({ item, qty }) => countItem(containers, item) < qty)) return false;
  for (const { item, qty } of cost) removeItem(containers, item, qty);
  slot[2] = maxDurability;
  return true;
}

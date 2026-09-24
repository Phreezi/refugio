import { nextRandom, randomInt, type RngState } from '../../core/Rng';
import type { ItemDefs, LootEntry, LootTableDef } from '../../data/types';
import { addItem, createContainer, type Container } from '../inventory/inventory';

// Loot dos contentores (CLAUDE.md §7.10), lógica pura: tiragens com pesos, quantidades
// mín–máx e "pity" (as tabelas `guaranteeUncommon` dão sempre pelo menos um item incomum+).

/** Escolhe uma entrada pelos pesos. */
export function pickWeighted(entries: readonly LootEntry[], rng: RngState): LootEntry | undefined {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = nextRandom(rng) * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

const isCommon = (item: string, defs: ItemDefs): boolean => (defs[item]?.rarity ?? 'common') === 'common';

/** Enche um contentor novo com o loot da tabela. */
export function rollLoot(table: LootTableDef, defs: ItemDefs, rng: RngState): Container {
  const container = createContainer(table.slots);
  const rolls = randomInt(rng, table.rolls.min, table.rolls.max);
  let uncommon = false;
  for (let i = 0; i < rolls; i++) {
    const entry = pickWeighted(table.entries, rng);
    if (!entry) break;
    addItem([container], entry.item, randomInt(rng, entry.min, entry.max), defs);
    if (!isCommon(entry.item, defs)) uncommon = true;
  }
  if (table.guaranteeUncommon && !uncommon) {
    const better = table.entries.filter((e) => !isCommon(e.item, defs));
    const entry = pickWeighted(better, rng);
    if (entry) addItem([container], entry.item, randomInt(rng, entry.min, entry.max), defs);
  }
  return container;
}

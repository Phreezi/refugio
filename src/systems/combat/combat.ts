import { randomInt, type RngState } from '../../core/Rng';
import type { EnemyDef, ItemDefs, RangedDef } from '../../data/types';
import type { ItemStack } from '../gathering/gathering';
import type { Container } from '../inventory/inventory';

// Combate corpo a corpo (CLAUDE.md §7.8), lógica pura: estatísticas da arma, armadura e drops.

export interface WeaponStats {
  damage: number;
  /** Segundos entre golpes. */
  attackSec: number;
  /** Alcance do golpe (px). */
  reach: number;
  /** Arma à distância: munição, alcance e velocidade do projétil. */
  ranged?: RangedDef;
}

export interface CombatBalance {
  fistDamage: number;
  fistAttackSec: number;
  fistReachPx: number;
  weaponAttackSec: number;
  weaponReachPx: number;
  maxArmorReductionPct: number;
}

/** Arma equipada (slot 0 do equipamento) ou os punhos. */
export function weaponStats(equipment: Container, defs: ItemDefs, balance: CombatBalance): WeaponStats {
  const slot = equipment[0];
  const def = slot ? defs[slot[0]] : undefined;
  if (!slot || def?.damage === undefined || (slot[2] !== undefined && slot[2] <= 0)) {
    return { damage: balance.fistDamage, attackSec: balance.fistAttackSec, reach: balance.fistReachPx };
  }
  return {
    damage: def.damage,
    attackSec: def.attackSec ?? balance.weaponAttackSec,
    reach: def.reach ?? balance.weaponReachPx,
    ...(def.ranged ? { ranged: def.ranged } : {}),
  };
}

/** % de dano evitado pelas peças de armadura equipadas (até ao máximo). */
export function armorPct(equipment: Container, defs: ItemDefs, maxPct: number): number {
  let total = 0;
  for (const slot of equipment) {
    if (!slot || (slot[2] !== undefined && slot[2] <= 0)) continue;
    total += defs[slot[0]]?.armor ?? 0;
  }
  return Math.min(maxPct, total);
}

/** Dano depois da armadura: nunca menos de 1 (um ataque que acerta dói sempre um pouco). */
export function reduceDamage(damage: number, pct: number): number {
  if (damage <= 0) return 0;
  return Math.max(1, Math.round((damage * (100 - pct)) / 100));
}

/**
 * Gasta 1 de durabilidade às peças com durabilidade dos slots `indices` (as que se partem
 * desaparecem). @returns ids das que partiram.
 */
export function wearSlots(container: Container, indices: readonly number[]): string[] {
  const broken: string[] = [];
  for (const i of indices) {
    const slot = container[i];
    if (slot?.[2] === undefined) continue;
    slot[2] -= 1;
    if (slot[2] <= 0) {
      broken.push(slot[0]);
      container[i] = null;
    }
  }
  return broken;
}

/** Drops de um inimigo derrotado (os de quantidade 0 ficam de fora). */
export function rollEnemyDrops(def: EnemyDef, rng: RngState): ItemStack[] {
  return def.drops
    .map((drop) => ({ item: drop.item, qty: randomInt(rng, drop.min, drop.max) }))
    .filter((drop) => drop.qty > 0);
}

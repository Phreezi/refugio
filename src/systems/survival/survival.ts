import { secondsToTicks } from '../../core/Clock';

// Vida, fome e sede (CLAUDE.md §7.1). Os ritmos são múltiplos do tick global, por isso não é
// preciso guardar temporizadores no save: "a cada 18 s" = quando tick % 360 === 0.

export interface Vitals {
  hp: number;
  hunger: number;
  thirst: number;
}

export interface SurvivalRules {
  max: number;
  hungerEveryTicks: number;
  thirstEveryTicks: number;
  starvationEveryTicks: number;
  regenEveryTicks: number;
  /** Regenera só se fome E sede estiverem acima disto (valor absoluto). */
  regenAbove: number;
  /** Valor de vida, fome e sede ao reaparecer depois de morrer. */
  respawnValue: number;
}

export interface SurvivalBalance {
  statMax: number;
  hungerDecaySec: number;
  thirstDecaySec: number;
  starvationDamageEverySec: number;
  regenEverySec: number;
  regenThreshold: number;
  respawnHpPct: number;
}

/** Talentos de sobrevivência (§7.15), em %: fome/sede mais lentas, regeneração mais rápida. */
export interface SurvivalTalents {
  hungerSlowPct: number;
  thirstSlowPct: number;
  regenPct: number;
}

const NO_TALENTS: SurvivalTalents = { hungerSlowPct: 0, thirstSlowPct: 0, regenPct: 0 };

export function survivalRules(
  balance: SurvivalBalance,
  talents: SurvivalTalents = NO_TALENTS,
): SurvivalRules {
  const max = balance.statMax;
  return {
    max,
    hungerEveryTicks: secondsToTicks(balance.hungerDecaySec * (1 + talents.hungerSlowPct / 100)),
    thirstEveryTicks: secondsToTicks(balance.thirstDecaySec * (1 + talents.thirstSlowPct / 100)),
    starvationEveryTicks: secondsToTicks(balance.starvationDamageEverySec),
    regenEveryTicks: Math.max(1, secondsToTicks(balance.regenEverySec / (1 + talents.regenPct / 100))),
    regenAbove: (max * balance.regenThreshold) / 100,
    respawnValue: Math.round((max * balance.respawnHpPct) / 100),
  };
}

/**
 * Aplica um tick de sobrevivência (altera `vitals`). Fome e sede nunca matam de repente:
 * a 0, tiram 1 de vida a cada `starvationEveryTicks`.
 * @returns true se a vida chegou a 0 neste tick.
 */
export function tickSurvival(vitals: Vitals, tick: number, rules: SurvivalRules): boolean {
  if (tick % rules.hungerEveryTicks === 0) vitals.hunger = Math.max(0, vitals.hunger - 1);
  if (tick % rules.thirstEveryTicks === 0) vitals.thirst = Math.max(0, vitals.thirst - 1);

  const starving = vitals.hunger === 0 || vitals.thirst === 0;
  if (starving && tick % rules.starvationEveryTicks === 0) {
    vitals.hp = Math.max(0, vitals.hp - 1);
    return vitals.hp === 0;
  }
  const fed = vitals.hunger > rules.regenAbove && vitals.thirst > rules.regenAbove;
  if (fed && tick % rules.regenEveryTicks === 0) vitals.hp = Math.min(rules.max, vitals.hp + 1);
  return false;
}

/** CLAUDE.md §7.12: reaparece com vida, fome e sede a 50% (nunca abaixo do que tinha). */
export function respawnVitals(vitals: Vitals, rules: SurvivalRules): void {
  vitals.hp = rules.respawnValue;
  vitals.hunger = Math.max(vitals.hunger, rules.respawnValue);
  vitals.thirst = Math.max(vitals.thirst, rules.respawnValue);
}

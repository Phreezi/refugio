// Resistência e sono (CLAUDE.md §7.19). Lógica pura.
//
// A resistência gasta-se a correr (a correr sempre, a base acaba em `staminaRunHours` horas de
// jogo) e a atacar; recupera-se a dormir e com comida/bebida (`effects.stamina`). O máximo sobe
// com o nível, até +`staminaMaxBonusPct`%. Dorme-se na cama a partir das `sleepFromHour` e
// acorda-se às `wakeHour`; quem ainda estiver acordado às `sleepLatestHour` adormece onde está e
// acorda às `passOutWakeHour` com `staminaPassOutPct`% da resistência.

export interface StaminaRules {
  staminaMax: number;
  staminaPerLevelPct: number;
  staminaMaxBonusPct: number;
  staminaRunHours: number;
  dayLengthSec: number;
}

export interface SleepRules {
  sleepFromHour: number;
  sleepLatestHour: number;
  /** Até esta hora, quem está acordado adormece (o jogo novo começa às 6h, já fora). */
  passOutUntilHour: number;
  wakeHour: number;
  passOutWakeHour: number;
}

/** Resistência máxima no nível `level`: +`staminaPerLevelPct`% por nível, até +`staminaMaxBonusPct`%. */
export function staminaMax(level: number, rules: StaminaRules): number {
  const bonus = Math.min(rules.staminaMaxBonusPct, Math.max(0, level - 1) * rules.staminaPerLevelPct);
  return Math.round(rules.staminaMax * (1 + bonus / 100));
}

/** Resistência gasta por tick a correr (a base toda em `staminaRunHours` horas de jogo). */
export function runDrainPerTick(rules: StaminaRules, ticksPerSecond: number): number {
  const ticks = (rules.staminaRunHours / 24) * rules.dayLengthSec * ticksPerSecond;
  return rules.staminaMax / ticks;
}

/** Horas (0–24) até à próxima vez que o relógio marca `target` a partir de `hour`. */
export function hoursUntil(hour: number, target: number): number {
  const h = (((target - hour) % 24) + 24) % 24;
  return h === 0 ? 24 : h;
}

/** Pode deitar-se na cama agora? (das `sleepFromHour` até às `wakeHour`). */
export function canSleep(hour: number, rules: SleepRules): boolean {
  return hour >= rules.sleepFromHour || hour < rules.wakeHour;
}

/** Devia estar a dormir? (entre as `sleepLatestHour` e as `passOutUntilHour`: adormece onde está). */
export function mustPassOut(hour: number, rules: SleepRules): boolean {
  return hour >= rules.sleepLatestHour && hour < rules.passOutUntilHour;
}

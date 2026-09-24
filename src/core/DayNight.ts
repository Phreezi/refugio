import { TICKS_PER_SECOND } from './Clock';

// Dia e noite (CLAUDE.md §7.11): a noite é `nightFraction` do dia, centrada na meia-noite, com
// uma hora de crepúsculo antes e de madrugada depois. Lógica pura: a cena só desenha.

export interface DayNightRules {
  dayLengthSec: number;
  dayStartHour: number;
  nightFraction: number;
  /** Escuridão máxima (0–1) no meio da noite. */
  nightDarkness: number;
}

/** Hora do dia (0–24, com frações) num tick. */
export function hourAt(tick: number, rules: DayNightRules): number {
  const days = tick / TICKS_PER_SECOND / rules.dayLengthSec;
  return (((rules.dayStartHour + days * 24) % 24) + 24) % 24;
}

/** Escuridão (0 = dia, `nightDarkness` = noite cerrada) num tick. */
export function darknessAt(tick: number, rules: DayNightRules): number {
  const hour = hourAt(tick, rules);
  const half = (rules.nightFraction * 24) / 2;
  // Distância (em horas) à meia-noite.
  const fromMidnight = Math.min(hour, 24 - hour);
  if (fromMidnight <= half) return rules.nightDarkness;
  if (fromMidnight >= half + 1) return 0;
  return rules.nightDarkness * (half + 1 - fromMidnight);
}

/** É de noite? (mais de metade da escuridão máxima). */
export function isNight(tick: number, rules: DayNightRules): boolean {
  return darknessAt(tick, rules) >= rules.nightDarkness / 2;
}

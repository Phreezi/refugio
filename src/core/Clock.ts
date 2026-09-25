import { FIXED_STEP_MS } from '../config';
import { BALANCE } from '../data/balance';

/** Ticks de lógica por segundo de jogo (20 com passo de 50 ms). */
export const TICKS_PER_SECOND = 1000 / FIXED_STEP_MS;

const MINUTES_PER_DAY = 24 * 60;

export interface ClockTime {
  /** Dia de jogo, a começar em 1. */
  day: number;
  hour: number;
  minute: number;
}

/** Converte segundos de jogo em ticks (arredonda; mínimo 1). */
export function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * TICKS_PER_SECOND));
}

/** Ticks de `hours` horas de jogo (1 dia de jogo = `dayLengthSec` segundos). */
export function gameHoursToTicks(hours: number): number {
  return secondsToTicks((hours * BALANCE.dayLengthSec) / 24);
}

/**
 * Hora do dia a partir dos ticks decorridos (CLAUDE.md §5.2: 1 dia de jogo = `dayLengthSec` reais).
 * Um jogo novo começa às `startHour` do dia 1; o dia muda à meia-noite.
 */
/**
 * Proteção de principiante: até às 00:00 do dia `beginnerUntilDay` armas, ferramentas e armadura não gastam usos
 * (as primeiras ~72 h de jogo de uma conta nova).
 */
export function beginnerProtected(
  tick: number,
  dayLengthSec: number,
  startHour: number,
  untilDay: number,
): boolean {
  return clockAt(tick, dayLengthSec, startHour).day < untilDay;
}

export function clockAt(tick: number, dayLengthSec: number, startHour: number): ClockTime {
  const elapsedDays = tick / TICKS_PER_SECOND / dayLengthSec;
  const totalMinutes = Math.floor(startHour * 60 + elapsedDays * MINUTES_PER_DAY);
  const minuteOfDay = totalMinutes % MINUTES_PER_DAY;
  return {
    day: Math.floor(totalMinutes / MINUTES_PER_DAY) + 1,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
  };
}

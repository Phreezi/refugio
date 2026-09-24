import type { GameStateData } from './GameState';

/**
 * Tempo em que o jogo esteve fechado (CLAUDE.md §7.6): os crafts e o reaparecimento dos
 * recursos avançam, limitado a `capHours`; fome e sede NÃO descem (mais simpático).
 * @returns ticks de jogo a aplicar (0 se o relógio do sistema recuou).
 */
export function offlineTicks(savedAt: number, now: number, capHours: number, stepMs: number): number {
  const elapsed = Math.max(0, Math.min(now - savedAt, capHours * 3_600_000));
  return Math.floor(elapsed / stepMs);
}

/** Aproxima o reaparecimento dos recursos apanhados (o relógio do jogo não avança). */
export function advanceRespawns(data: GameStateData, ticks: number): void {
  for (const zone of Object.values(data.zones)) {
    for (const key of Object.keys(zone.depleted)) {
      zone.depleted[key] = Math.max(0, (zone.depleted[key] ?? 0) - ticks);
    }
  }
}

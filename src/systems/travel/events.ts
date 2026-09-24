import type { WorldEventDef } from '../../data/types';

// Zonas-evento (CLAUDE.md §8.3, Fase 10): aparecem e desaparecem com o relógio do jogo, sem
// estado gravado — o mesmo tick dá sempre o mesmo resultado.

/** Dia de jogo (0, 1, 2…) de um tick. */
export function dayOf(tick: number, dayTicks: number): number {
  return Math.floor(tick / dayTicks);
}

/** O evento está a decorrer neste tick? */
export function eventActive(event: WorldEventDef, tick: number, dayTicks: number): boolean {
  const day = dayOf(tick, dayTicks) - event.offsetDays;
  return day >= 0 && day % event.everyDays < event.durationDays;
}

/** Ticks até o evento acabar (0 se não estiver a decorrer). */
export function eventTicksLeft(event: WorldEventDef, tick: number, dayTicks: number): number {
  if (!eventActive(event, tick, dayTicks)) return 0;
  const day = dayOf(tick, dayTicks) - event.offsetDays;
  const endDay = day - (day % event.everyDays) + event.durationDays + event.offsetDays;
  return endDay * dayTicks - tick;
}

/** Custo de uma viagem com o desconto de um veículo (em %), arredondado para baixo. */
export function discountedCost(
  cost: { hunger: number; thirst: number },
  discountPct: number,
): { hunger: number; thirst: number } {
  const keep = (v: number): number => Math.floor((v * (100 - discountPct)) / 100);
  return { hunger: keep(cost.hunger), thirst: keep(cost.thirst) };
}

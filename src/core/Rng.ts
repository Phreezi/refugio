// Gerador pseudoaleatório com seed (mulberry32). O estado é um número guardado no GameState
// (world.rng): os resultados são reproduzíveis nos testes e continuam iguais depois de gravar.

export interface RngState {
  rng: number;
}

/** Número em [0, 1); avança o estado. */
export function nextRandom(state: RngState): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Inteiro em [min, max] (inclusive). */
export function randomInt(state: RngState, min: number, max: number): number {
  return min + Math.floor(nextRandom(state) * (max - min + 1));
}

// Vedações que se ligam às vizinhas (pedido do jogador: as verticais e os cantos ligavam mal).
// Módulo puro: a máscara diz para que lados há vedação ao lado.

export const FENCE_N = 1;
export const FENCE_E = 2;
export const FENCE_S = 4;
export const FENCE_W = 8;

/** Máscara (0–15) das vizinhas com vedação: norte 1, este 2, sul 4, oeste 8. */
export function fenceMask(isFence: (tx: number, ty: number) => boolean, tx: number, ty: number): number {
  return (
    (isFence(tx, ty - 1) ? FENCE_N : 0) |
    (isFence(tx + 1, ty) ? FENCE_E : 0) |
    (isFence(tx, ty + 1) ? FENCE_S : 0) |
    (isFence(tx - 1, ty) ? FENCE_W : 0)
  );
}

// Textura das vedações ligadas (16 variantes, uma por máscara de src/world/fences.ts), desenhada
// píxel a píxel com a paleta. Cada frame tem 16×24 px com os pés na última linha (vista 3/4).
import type Phaser from 'phaser';
import { PALETTE, type PaletteColor } from '../assets/palette';
import { FENCE_E, FENCE_N, FENCE_S, FENCE_W } from '../world/fences';

export const FENCE_TEXTURE = 'fence_auto';
const W = 16;
const H = 24;

/** Cria (uma vez) a textura com as 16 variantes; o frame é a máscara. */
export function fenceTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(FENCE_TEXTURE)) return FENCE_TEXTURE;
  const canvas = scene.textures.createCanvas(FENCE_TEXTURE, W * 16, H);
  const ctx = canvas?.getContext();
  if (!canvas || !ctx) return '__DEFAULT';
  for (let mask = 0; mask < 16; mask++) drawFence(ctx, mask * W, mask);
  canvas.refresh();
  for (let mask = 0; mask < 16; mask++) canvas.add(mask, 0, mask * W, 0, W, H);
  return FENCE_TEXTURE;
}

function drawFence(ctx: CanvasRenderingContext2D, ox: number, mask: number): void {
  const fill = (x: number, y: number, w: number, h: number, color: PaletteColor, alpha = 1): void => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = PALETTE[color];
    ctx.fillRect(ox + x, y, w, h);
    ctx.globalAlpha = 1;
  };
  // Sombra no chão, por baixo do poste.
  fill(5, 22, 6, 1, 'ink', 0.35);
  // Tábuas para os lados (duas, como a vedação de sempre).
  const rail = (x: number, w: number): void => {
    for (const y of [12, 17]) {
      fill(x, y, w, 2, 'wood');
      fill(x, y, w, 1, 'wood_light');
    }
  };
  if (mask & FENCE_W) rail(0, 7);
  if (mask & FENCE_E) rail(9, 7);
  // Tábua ao longo (para cima e para baixo): vista de cima, uma faixa estreita.
  const along = (y: number, h: number): void => {
    fill(7, y, 2, h, 'wood');
    fill(7, y, 1, h, 'wood_light');
    fill(9, y, 1, h, 'bark_dark');
  };
  // Até ao pé do poste de cima (y 5 neste frame): os postes continuam à vista.
  if (mask & FENCE_N) along(5, 5);
  if (mask & FENCE_S) along(20, 4);
  // Poste ao centro (luz de cima-esquerda).
  fill(6, 9, 4, 13, 'bark');
  fill(6, 9, 1, 13, 'wood');
  fill(9, 10, 1, 12, 'bark_dark');
  fill(6, 9, 4, 1, 'wood_light');
}

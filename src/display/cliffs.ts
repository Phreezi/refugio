// Cenário fora das zonas do mundo contínuo (pedido do jogador: "nunca aparecer preto"):
// penhascos e montanhas vistos de cima, em pixel art com a paleta, a repetir sem costuras.
import { PALETTE, type PaletteColor } from '../assets/palette';

interface Boulder {
  x: number;
  y: number;
  r: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(color: PaletteColor): [number, number, number] {
  const hex = PALETTE[color];
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * Pedregulhos (luz de cima-esquerda, contorno escuro) com fendas escuras e tufos de mato entre
 * eles. Desenhado píxel a píxel (sem antialias), `size`×`size`, repete-se sem costuras.
 */
export function drawCliffs(ctx: CanvasRenderingContext2D, size: number, seed = 7): void {
  const random = rng(seed);
  const boulders: Boulder[] = [];
  for (let i = 0; i < 11; i++) {
    boulders.push({ x: random() * size, y: random() * size, r: 7 + random() * 8 });
  }
  // Os de baixo tapam os de cima (vista 3/4).
  boulders.sort((p, q) => p.y - q.y);
  const tufts = new Set<number>();
  for (let i = 0; i < 26; i++) tufts.add(Math.floor(random() * size) * size + Math.floor(random() * size));
  const wrap = (d: number): number => {
    const m = ((d % size) + size) % size;
    return m > size / 2 ? m - size : m;
  };
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color: PaletteColor = (x * 7 + y * 13) % 11 === 0 ? 'shadow' : 'night';
      if (tufts.has(y * size + x)) color = 'forest_dark';
      for (const b of boulders) {
        const dx = wrap(x + 0.5 - b.x);
        const dy = wrap(y + 0.5 - b.y);
        const d = Math.hypot(dx, dy);
        if (d >= b.r) continue;
        if (d > b.r - 1.2) {
          color = 'ink';
          continue;
        }
        const light = (-(dx + dy) / b.r) * 0.75 + (1 - d / b.r) * 0.45;
        color =
          light > 0.62 ? 'stone_light' : light > 0.18 ? 'stone' : light > -0.3 ? 'stone_dark' : 'shadow';
      }
      const [r, g, bl] = rgb(color);
      const i = (y * size + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = bl;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

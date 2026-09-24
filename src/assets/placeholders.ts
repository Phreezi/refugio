import type Phaser from 'phaser';
import type { AssetManifest, PlaceholderSpec } from './manifest';
import { PALETTE, contrastingColor, hexToRgb, isPaletteColor, type PaletteColor, type Rgb } from './palette';

// Placeholders gerados por código (CLAUDE.md §6.1): retângulo com a cor da paleta,
// contorno opcional de 1 px e uma letra ao centro. Só usam cores da paleta: a letra é
// rasterizada e depois "binarizada" (sem antialias), para não criar tons intermédios.

const LETTER_FONT = 'bold {size}px monospace';
const MIN_FONT_PX = 6;
const MAX_FONT_PX = 12;
/** Alfa mínimo (0–255) para um píxel da letra contar como cheio. */
const LETTER_ALPHA_THRESHOLD = 110;

function paletteColor(name: string): PaletteColor {
  // O manifest já foi validado contra a paleta; isto só protege contra uso direto.
  if (!isPaletteColor(name)) throw new Error(`Placeholder: cor fora da paleta "${name}"`);
  return name;
}

/**
 * Pinta `rgb` (opaco) em `target` onde a máscara tem alfa ≥ `threshold`.
 * Ambos são buffers RGBA do mesmo tamanho (ImageData.data).
 */
export function stampMask(
  target: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  rgb: Rgb,
  threshold: number,
): number {
  if (target.length !== mask.length) throw new Error('stampMask: buffers com tamanhos diferentes');
  let painted = 0;
  for (let i = 0; i < mask.length; i += 4) {
    if ((mask[i + 3] ?? 0) >= threshold) {
      target[i] = rgb.r;
      target[i + 1] = rgb.g;
      target[i + 2] = rgb.b;
      target[i + 3] = 255;
      painted++;
    }
  }
  return painted;
}

/** Tamanho de letra proporcional à caixa, limitado para ficar legível e uniforme. */
export function letterFontSize(width: number, height: number): number {
  return Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.min(width, height) - 4));
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Placeholder: Canvas 2D indisponível');
  return ctx;
}

function drawLetter(ctx: CanvasRenderingContext2D, letter: string, width: number, height: number, rgb: Rgb) {
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const sctx = context2d(scratch);
  sctx.font = LETTER_FONT.replace('{size}', String(letterFontSize(width, height)));
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillStyle = '#ffffff';
  sctx.fillText(letter, width / 2, height / 2 + 1);

  const image = ctx.getImageData(0, 0, width, height);
  stampMask(image.data, sctx.getImageData(0, 0, width, height).data, rgb, LETTER_ALPHA_THRESHOLD);
  ctx.putImageData(image, 0, 0);
}

/** Cria um canvas com o placeholder desenhado. */
export function paintPlaceholder(spec: PlaceholderSpec): HTMLCanvasElement {
  const { width, height } = spec;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = context2d(canvas);

  const fill = paletteColor(spec.color);
  ctx.fillStyle = PALETTE[fill];
  ctx.fillRect(0, 0, width, height);

  if (spec.border !== undefined) {
    ctx.fillStyle = PALETTE[paletteColor(spec.border)];
    ctx.fillRect(0, 0, width, 1);
    ctx.fillRect(0, height - 1, width, 1);
    ctx.fillRect(0, 0, 1, height);
    ctx.fillRect(width - 1, 0, 1, height);
  }

  if (spec.letter !== undefined) {
    drawLetter(ctx, spec.letter, width, height, hexToRgb(PALETTE[contrastingColor(fill)]));
  }
  return canvas;
}

/**
 * Gera texturas placeholder para todas as chaves do manifest que ainda não existam
 * no gestor de texturas (sem ficheiro, ou cujo ficheiro falhou a carregar).
 * @returns as chaves geradas.
 */
export function ensurePlaceholderTextures(
  textures: Phaser.Textures.TextureManager,
  manifest: AssetManifest,
): string[] {
  const generated: string[] = [];
  for (const [key, entry] of Object.entries(manifest.assets)) {
    if (textures.exists(key)) continue;
    if (textures.addCanvas(key, paintPlaceholder(entry.placeholder)) === null) {
      throw new Error(`Placeholder: não foi possível criar a textura "${key}"`);
    }
    generated.push(key);
  }
  return generated;
}

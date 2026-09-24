import paletteJson from './palette.json';

/**
 * Paleta de 32 cores do jogo (CLAUDE.md §6.3). A fonte de verdade é `palette.json`;
 * `npm run palette` gera `public/assets/palette.png` a partir dela, para os artistas.
 */
export type PaletteColor = keyof typeof paletteJson;

export const PALETTE: Readonly<Record<PaletteColor, string>> = paletteJson;

export const PALETTE_NAMES: readonly PaletteColor[] = Object.keys(paletteJson) as PaletteColor[];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isPaletteColor(name: string): name is PaletteColor {
  return Object.hasOwn(paletteJson, name);
}

export function hexToRgb(hex: string): Rgb {
  if (!HEX_COLOR.test(hex)) throw new Error(`Cor inválida: "${hex}" (esperado #rrggbb)`);
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/** Cor da paleta como número 0xRRGGBB (formato usado pelo Phaser). */
export function paletteNumber(name: PaletteColor): number {
  return Number.parseInt(PALETTE[name].slice(1), 16);
}

/** Luminância relativa WCAG (0 = preto, 1 = branco). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Rácio de contraste WCAG entre duas cores (1 a 21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Cor da paleta (`ink` ou `cream`) mais legível por cima de `background`. */
export function contrastingColor(background: PaletteColor): PaletteColor {
  const bg = hexToRgb(PALETTE[background]);
  const dark = contrastRatio(bg, hexToRgb(PALETTE.ink));
  const light = contrastRatio(bg, hexToRgb(PALETTE.cream));
  return dark >= light ? 'ink' : 'cream';
}

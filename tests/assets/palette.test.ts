import { describe, expect, it } from 'vitest';
import {
  PALETTE,
  PALETTE_NAMES,
  contrastingColor,
  hexToRgb,
  isPaletteColor,
  paletteNumber,
} from '../../src/assets/palette';

describe('palette', () => {
  it('tem exatamente 32 cores (CLAUDE.md §6.3)', () => {
    expect(PALETTE_NAMES).toHaveLength(32);
  });

  it('todas as cores são #rrggbb e não há repetidas', () => {
    const values = Object.values(PALETTE);
    for (const hex of values) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(values).size).toBe(values.length);
  });

  it('nomes em snake_case', () => {
    for (const name of PALETTE_NAMES) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('hexToRgb e paletteNumber convertem corretamente', () => {
    expect(hexToRgb('#1c1521')).toEqual({ r: 0x1c, g: 0x15, b: 0x21 });
    expect(paletteNumber('ink')).toBe(0x1c1521);
    expect(() => hexToRgb('red')).toThrow(/#rrggbb/);
  });

  it('isPaletteColor distingue nomes válidos', () => {
    expect(isPaletteColor('grass')).toBe(true);
    expect(isPaletteColor('toString')).toBe(false);
    expect(isPaletteColor('verde')).toBe(false);
  });

  it('contrastingColor escolhe texto claro em fundos escuros e escuro em fundos claros', () => {
    expect(contrastingColor('ink')).toBe('cream');
    expect(contrastingColor('forest_dark')).toBe('cream');
    expect(contrastingColor('cream')).toBe('ink');
    expect(contrastingColor('gold')).toBe('ink');
  });
});

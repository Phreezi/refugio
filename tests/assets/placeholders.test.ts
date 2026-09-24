import { describe, expect, it } from 'vitest';
import { letterFontSize, stampMask } from '../../src/assets/placeholders';

function rgba(...pixels: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flat());
}

describe('stampMask', () => {
  it('pinta só os píxeis da máscara acima do limiar, com cor opaca', () => {
    const target = rgba([1, 2, 3, 255], [1, 2, 3, 255], [1, 2, 3, 255]);
    const mask = rgba([255, 255, 255, 255], [255, 255, 255, 60], [255, 255, 255, 110]);
    const painted = stampMask(target, mask, { r: 9, g: 8, b: 7 }, 110);
    expect(painted).toBe(2);
    expect([...target]).toEqual([9, 8, 7, 255, 1, 2, 3, 255, 9, 8, 7, 255]);
  });

  it('não cria cores intermédias (sem mistura com o fundo)', () => {
    const target = rgba([10, 10, 10, 255], [10, 10, 10, 255]);
    const mask = rgba([255, 255, 255, 200], [255, 255, 255, 20]);
    stampMask(target, mask, { r: 200, g: 200, b: 200 }, 110);
    const colors = new Set([target.slice(0, 3).join(), target.slice(4, 7).join()]);
    expect(colors).toEqual(new Set(['200,200,200', '10,10,10']));
  });

  it('rejeita buffers de tamanhos diferentes', () => {
    expect(() =>
      stampMask(new Uint8ClampedArray(4), new Uint8ClampedArray(8), { r: 0, g: 0, b: 0 }, 1),
    ).toThrow();
  });
});

describe('letterFontSize', () => {
  it('fica entre 6 e 12 px', () => {
    expect(letterFontSize(16, 16)).toBe(12);
    expect(letterFontSize(16, 32)).toBe(12);
    expect(letterFontSize(32, 32)).toBe(12);
    expect(letterFontSize(8, 8)).toBe(6);
    expect(letterFontSize(4, 4)).toBe(6);
  });
});

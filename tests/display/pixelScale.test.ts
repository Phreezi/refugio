import { describe, expect, it } from 'vitest';
import { computePixelScale, type PixelScaleOptions } from '../../src/display/pixelScale';

const OPTIONS: PixelScaleOptions = { targetHeight: 400, minHeight: 240, minAspect: 4 / 3, maxAspect: 21 / 9 };
const TOUCH: PixelScaleOptions = { ...OPTIONS, targetHeight: 320 };

describe('computePixelScale', () => {
  it('1920×1080 a 1× → zoom 3, jogo 640×360, ocupa o ecrã todo', () => {
    expect(computePixelScale(1920, 1080, 1, OPTIONS)).toEqual({
      gameWidth: 640,
      gameHeight: 360,
      canvasWidth: 1920,
      canvasHeight: 1080,
      deviceZoom: 3,
      cssWidth: 1920,
      cssHeight: 1080,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('a largura acompanha o formato do ecrã (sem barras laterais)', () => {
    const s = computePixelScale(1600, 830, 1, OPTIONS);
    expect(s.deviceZoom).toBe(2);
    expect(s.gameHeight).toBe(414); // sempre par: o centro da vista cai num píxel inteiro
    expect(s.gameWidth).toBe(800);
    expect(s.offsetX).toBe(0);
  });

  it('conta píxeis do dispositivo: portátil a 125% (CSS 1536×864 = 1920×1080 físicos) → zoom 3', () => {
    const s = computePixelScale(1536, 864, 1.25, OPTIONS);
    expect(s.deviceZoom).toBe(3);
    expect(s.gameWidth).toBe(640);
    expect(s.cssWidth).toBeCloseTo(1536);
  });

  it('telemóvel em paisagem (915×412 @ 2,625) com alvo tátil → zoom 3 exato em píxeis físicos', () => {
    const s = computePixelScale(915, 412, 2.625, TOUCH);
    expect(s.deviceZoom).toBe(3);
    expect(s.gameHeight).toBe(360);
    expect(s.gameWidth).toBe(800);
    expect(s.cssWidth * 2.625).toBeCloseTo(2400);
  });

  it('a margem de centragem cai sempre num píxel inteiro do dispositivo e o canvas cabe no viewport', () => {
    for (const [w, h, dpr] of [
      [915, 412, 2.625],
      [1366, 768, 1],
      [1537, 865, 1.25],
      [851, 393, 2.75],
      [800, 600, 1],
      [412, 915, 2.625],
      [3440, 1440, 1],
    ] as const) {
      const s = computePixelScale(w, h, dpr, OPTIONS);
      expect(Number.isInteger(Math.round(s.offsetX * dpr * 1e6) / 1e6)).toBe(true);
      expect(Number.isInteger(Math.round(s.offsetY * dpr * 1e6) / 1e6)).toBe(true);
      expect(s.offsetX + s.cssWidth).toBeLessThanOrEqual(w + 1e-6);
      expect(s.offsetY + s.cssHeight).toBeLessThanOrEqual(h + 1e-6);
      expect(Number.isInteger(s.gameWidth) && Number.isInteger(s.gameHeight)).toBe(true);
    }
  });

  it('com o alvo de 270 px (≈ 17 tiles), 1920×1080 → zoom 4, 480×270 → 480×270 par', () => {
    const s = computePixelScale(1920, 1080, 1, { ...OPTIONS, targetHeight: 270, minHeight: 216 });
    expect(s.deviceZoom).toBe(4);
    expect([s.gameWidth, s.gameHeight]).toEqual([480, 270]);
    expect([s.canvasWidth, s.canvasHeight]).toEqual([1920, 1080]);
  });

  it('dimensões do jogo sempre pares e canvas = jogo × zoom', () => {
    for (const [w, h, dpr] of [
      [1537, 865, 1.25],
      [915, 412, 2.625],
      [1601, 833, 1],
    ] as const) {
      const s = computePixelScale(w, h, dpr, OPTIONS);
      expect(s.gameWidth % 2).toBe(0);
      expect(s.gameHeight % 2).toBe(0);
      expect(s.canvasWidth).toBe(s.gameWidth * s.deviceZoom);
    }
  });

  it('ultrawide: largura limitada a 21:9, com barras laterais', () => {
    const s = computePixelScale(3440, 1440, 1, OPTIONS);
    expect(s.deviceZoom).toBe(4);
    expect(s.gameHeight).toBe(360);
    expect(s.gameWidth).toBe(840);
    expect(s.offsetX).toBe(40);
  });

  it('janela estreita: altura reduzida para manter pelo menos 4:3', () => {
    const s = computePixelScale(800, 900, 1, OPTIONS);
    expect(s.gameWidth / s.gameHeight).toBeGreaterThanOrEqual(4 / 3 - 0.01);
    expect(s.offsetY).toBeGreaterThan(0);
  });

  it('ecrã minúsculo → tamanho mínimo com zoom fracionário', () => {
    const s = computePixelScale(320, 180, 1, OPTIONS);
    expect(s.gameHeight).toBe(240);
    expect(s.deviceZoom).toBeCloseTo(0.75);
    expect(s.cssHeight).toBeCloseTo(180);
  });

  it('valores inválidos não rebentam', () => {
    expect(computePixelScale(0, 0, 1, OPTIONS).gameHeight).toBe(240);
    expect(computePixelScale(1920, 1080, Number.NaN, OPTIONS).deviceZoom).toBe(3);
    expect(computePixelScale(1920, 1080, 0, OPTIONS).deviceZoom).toBe(3);
  });
});

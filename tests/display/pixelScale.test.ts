import { describe, expect, it } from 'vitest';
import { computePixelScale } from '../../src/display/pixelScale';

const W = 480;
const H = 270;

describe('computePixelScale', () => {
  it('1920×1080 a 1× → zoom 4, ocupa o ecrã todo', () => {
    expect(computePixelScale(1920, 1080, 1, W, H)).toEqual({
      deviceZoom: 4,
      cssWidth: 1920,
      cssHeight: 1080,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('usa só inteiros: 1366×768 a 1× → zoom 2, centrado', () => {
    const s = computePixelScale(1366, 768, 1, W, H);
    expect(s.deviceZoom).toBe(2);
    expect(s.offsetX).toBe(203);
    expect(s.offsetY).toBe(114);
  });

  it('a margem de centragem cai sempre num píxel inteiro do dispositivo', () => {
    for (const [w, h, dpr] of [
      [915, 412, 2.625],
      [1366, 768, 1],
      [1537, 865, 1.25],
      [851, 393, 2.75],
    ] as const) {
      const s = computePixelScale(w, h, dpr, W, H);
      expect(Number.isInteger(Math.round(s.offsetX * dpr * 1e6) / 1e6)).toBe(true);
      expect(Number.isInteger(Math.round(s.offsetY * dpr * 1e6) / 1e6)).toBe(true);
      expect(s.offsetX + s.cssWidth).toBeLessThanOrEqual(w + 1e-6);
      expect(s.offsetY + s.cssHeight).toBeLessThanOrEqual(h + 1e-6);
    }
  });

  it('conta píxeis do dispositivo: portátil 1920×1080 a 125% (CSS 1536×864) → zoom 4', () => {
    const s = computePixelScale(1536, 864, 1.25, W, H);
    expect(s.deviceZoom).toBe(4);
    expect(s.cssWidth).toBeCloseTo(1536);
    expect(s.cssHeight).toBeCloseTo(864);
  });

  it('telemóvel em paisagem com DPR fracionário (915×412 @ 2.625) → zoom 4 exato em píxeis físicos', () => {
    const s = computePixelScale(915, 412, 2.625, W, H);
    expect(s.deviceZoom).toBe(4);
    expect(s.cssWidth * 2.625).toBeCloseTo(1920);
    expect(s.cssHeight * 2.625).toBeCloseTo(1080);
  });

  it('o canvas nunca excede o viewport', () => {
    for (const [w, h, dpr] of [
      [800, 600, 1],
      [412, 915, 2.625],
      [1280, 720, 1.5],
      [2560, 1440, 1],
      [390, 844, 3],
    ] as const) {
      const s = computePixelScale(w, h, dpr, W, H);
      expect(s.cssWidth).toBeLessThanOrEqual(w + 1e-6);
      expect(s.cssHeight).toBeLessThanOrEqual(h + 1e-6);
      expect(s.deviceZoom).toBeGreaterThan(0);
    }
  });

  it('ecrã menor do que o jogo → reduz para caber (zoom fracionário)', () => {
    const s = computePixelScale(240, 135, 1, W, H);
    expect(s.deviceZoom).toBeCloseTo(0.5);
    expect(s.cssWidth).toBeCloseTo(240);
  });

  it('valores inválidos não rebentam', () => {
    expect(computePixelScale(0, 0, 1, W, H).deviceZoom).toBe(1);
    expect(computePixelScale(1920, 1080, Number.NaN, W, H).deviceZoom).toBe(4);
    expect(computePixelScale(1920, 1080, 0, W, H).deviceZoom).toBe(4);
  });
});

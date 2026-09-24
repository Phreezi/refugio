import { describe, expect, it } from 'vitest';
import { formatDebugInfo } from '../../src/debug/DebugOverlay';

describe('formatDebugInfo', () => {
  it('mostra FPS, tick com tempo de jogo, posição em píxeis e tiles, cenas e escala', () => {
    const text = formatDebugInfo({
      fps: 59.6,
      tick: 1234,
      player: { x: 384, y: 390.25 },
      scenes: ['Base', 'UI'],
      deviceZoom: 4,
      devicePixelRatio: 2.625,
      gameWidth: 480,
      gameHeight: 270,
    });
    expect(text.split('\n')).toEqual([
      'FPS 60',
      'tick 1234 · 61.7 s',
      'pos 384, 390.3 · tile 24, 24',
      'cenas Base + UI',
      'jogo 480×270 · escala ×4 · dpr 2.6',
    ]);
  });

  it('no menu (sem jogo) mostra traços', () => {
    const text = formatDebugInfo({
      fps: 60,
      tick: null,
      player: null,
      scenes: [],
      deviceZoom: 2,
      devicePixelRatio: 1,
      gameWidth: 640,
      gameHeight: 360,
    });
    expect(text).toContain('tick —');
    expect(text).toContain('pos —');
    expect(text).toContain('cenas —');
  });
});

import { describe, expect, it } from 'vitest';
import { SOUNDS } from '../../src/audio/sfx';

describe('Efeitos sonoros sintetizados (Fase 12)', () => {
  it('todos os sons têm partes curtas com frequências e volumes válidos', () => {
    for (const [name, parts] of Object.entries(SOUNDS)) {
      expect(parts.length, name).toBeGreaterThan(0);
      for (const part of parts as readonly Record<string, unknown>[]) {
        const sec = Number(part.sec);
        expect(sec, name).toBeGreaterThan(0);
        expect(sec, name).toBeLessThanOrEqual(1);
        // As rampas exponenciais do Web Audio não aceitam 0 nem negativos.
        for (const key of ['from', 'to', 'cutoff', 'cutoffTo', 'gain']) {
          if (part[key] !== undefined) expect(Number(part[key]), `${name}.${key}`).toBeGreaterThan(0);
        }
        if (part.gain !== undefined) expect(Number(part.gain), name).toBeLessThanOrEqual(1);
      }
    }
  });
});

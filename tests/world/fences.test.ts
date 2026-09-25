import { describe, expect, it } from 'vitest';
import { FENCE_E, FENCE_N, FENCE_S, FENCE_W, fenceMask } from '../../src/world/fences';

describe('fenceMask', () => {
  const fences = new Set(['5,5', '5,4', '5,6', '6,5', '4,9', '5,9']);
  const isFence = (x: number, y: number): boolean => fences.has(`${String(x)},${String(y)}`);

  it('liga-se aos quatro lados (cantos, T e cruz)', () => {
    expect(fenceMask(isFence, 5, 5)).toBe(FENCE_N | FENCE_S | FENCE_E);
    expect(fenceMask(isFence, 5, 4)).toBe(FENCE_S);
    expect(fenceMask(isFence, 6, 5)).toBe(FENCE_W);
    expect(fenceMask(isFence, 5, 9)).toBe(FENCE_W);
    expect(fenceMask(isFence, 20, 20)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { gameSpeed, nextGameSpeed } from '../../src/ui/gameSpeed';

describe('gameSpeed', () => {
  it('começa em x1 e roda x1 → x2 → x3 → x1', () => {
    expect(gameSpeed()).toBe(1);
    expect(nextGameSpeed()).toBe(2);
    expect(nextGameSpeed()).toBe(3);
    expect(nextGameSpeed()).toBe(1);
    expect(gameSpeed()).toBe(1);
  });
});

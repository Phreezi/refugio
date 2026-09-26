import { describe, expect, it } from 'vitest';
import { healOf } from '../../src/core/PlayerActions';
import { BALANCE } from '../../src/data/balance';

describe('Comida cura um pouco', () => {
  it('sem efeito na vida, cura foodHealPct% da fome; com efeito, usa o do item', () => {
    expect(healOf({ hunger: 40 })).toBe(Math.round((40 * BALANCE.foodHealPct) / 100));
    expect(healOf({ hunger: 2 })).toBe(1);
    expect(healOf({ hunger: 30, hp: -3 })).toBe(-3); // carne crua continua a fazer mal
    expect(healOf({ hp: 35 })).toBe(35);
    expect(healOf({})).toBe(0);
  });
});

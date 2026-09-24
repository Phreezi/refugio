import { describe, expect, it } from 'vitest';
import { clockAt, secondsToTicks, TICKS_PER_SECOND } from '../../src/core/Clock';
import { BALANCE } from '../../src/data/balance';
import { respawnVitals, survivalRules, tickSurvival, type Vitals } from '../../src/systems/survival/survival';

const RULES = survivalRules(BALANCE);

/** Corre `seconds` de jogo a partir do tick `from`. */
function run(v: Vitals, seconds: number, from = 0): { tick: number; died: boolean } {
  let died = false;
  let tick = from;
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) {
    tick++;
    died = tickSurvival(v, tick, RULES) || died;
  }
  return { tick, died };
}

describe('survival', () => {
  it('fome desce 1 a cada 18 s e sede 1 a cada 12 s (balance.json)', () => {
    const v = { hp: 100, hunger: 100, thirst: 100 };
    run(v, 36);
    expect(v).toEqual({ hp: 100, hunger: 98, thirst: 97 });
  });

  it('com fome e sede acima de 50 regenera 1 de vida a cada 5 s, até ao máximo', () => {
    const v = { hp: 90, hunger: 100, thirst: 100 };
    run(v, 20);
    expect(v.hp).toBe(94);
    const full = { hp: 100, hunger: 100, thirst: 100 };
    run(full, 20);
    expect(full.hp).toBe(100);
  });

  it('não regenera com fome ou sede a 50 ou menos', () => {
    const v = { hp: 50, hunger: 50, thirst: 100 };
    run(v, 10);
    expect(v.hp).toBe(50);
  });

  it('a 0 de fome perde 1 de vida a cada 3 s (nunca de repente) e avisa quando morre', () => {
    const v = { hp: 3, hunger: 0, thirst: 100 };
    const first = run(v, 6);
    expect(v.hp).toBe(1);
    expect(first.died).toBe(false);
    expect(run(v, 3, first.tick).died).toBe(true);
    expect(v.hp).toBe(0);
  });

  it('ao reaparecer: vida a 50%, fome e sede pelo menos 50%', () => {
    const v = { hp: 0, hunger: 0, thirst: 80 };
    respawnVitals(v, RULES);
    expect(v).toEqual({ hp: 50, hunger: 50, thirst: 80 });
  });
});

describe('Clock', () => {
  it('converte segundos em ticks (20/s)', () => {
    expect(secondsToTicks(18)).toBe(360);
    expect(secondsToTicks(0)).toBe(1);
  });

  it('o jogo começa às 06:00 do dia 1 e 1 dia = 20 min reais', () => {
    expect(clockAt(0, 1200, 6)).toEqual({ day: 1, hour: 6, minute: 0 });
    // 5 min reais = 1/4 de dia = 6 h de jogo
    expect(clockAt(5 * 60 * TICKS_PER_SECOND, 1200, 6)).toEqual({ day: 1, hour: 12, minute: 0 });
    // 15 min reais: 06:00 + 18 h = 00:00 do dia 2
    expect(clockAt(15 * 60 * TICKS_PER_SECOND, 1200, 6)).toEqual({ day: 2, hour: 0, minute: 0 });
  });
});

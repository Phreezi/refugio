import { describe, expect, it } from 'vitest';
import { TALENTS } from '../../src/data/talents';
import {
  canLearn,
  learnTalent,
  parseTalents,
  talentPoints,
  talentValue,
  type Talents,
} from '../../src/systems/progression/talents';

describe('talentos', () => {
  it('os dados validam-se (cada talento pede outro do mesmo ramo que existe)', () => {
    expect(Object.keys(TALENTS).length).toBeGreaterThanOrEqual(12);
    expect(() =>
      parseTalents({
        a: { branch: 'combat', effect: 'armorPct', perRank: 1, maxRank: 1, level: 1, requires: ['x', 1] },
      }),
    ).toThrow(/não existe/);
    expect(() =>
      parseTalents({ a: { branch: 'magic', effect: 'armorPct', perRank: 1, maxRank: 1, level: 1 } }),
    ).toThrow();
  });

  it('1 ponto por nível acima do 1; gastar tira pontos', () => {
    const talents: Talents = {};
    expect(talentPoints(1, talents)).toBe(0);
    expect(canLearn('strong_arm', 1, talents, TALENTS)).toBe('no_points');
    expect(talentPoints(4, talents)).toBe(3);
    expect(learnTalent('strong_arm', 4, talents, TALENTS)).toBe('ok');
    expect(talentPoints(4, talents)).toBe(2);
    expect(talentValue(talents, 'meleeDamagePct', TALENTS)).toBe(10);
  });

  it('respeita o nível mínimo, o talento pedido e o máximo', () => {
    const talents: Talents = {};
    expect(canLearn('thick_skin', 10, talents, TALENTS)).toBe('requires');
    expect(canLearn('berserker', 5, { thick_skin: 2, strong_arm: 1 }, TALENTS)).toBe('level');
    learnTalent('strong_arm', 10, talents, TALENTS);
    expect(canLearn('thick_skin', 10, talents, TALENTS)).toBe('ok');
    learnTalent('strong_arm', 10, talents, TALENTS);
    learnTalent('strong_arm', 10, talents, TALENTS);
    expect(canLearn('strong_arm', 10, talents, TALENTS)).toBe('max');
    expect(canLearn('nope', 10, talents, TALENTS)).toBe('unknown');
  });
});

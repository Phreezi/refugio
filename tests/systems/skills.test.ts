import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/data/balance';
import { skillOf } from '../../src/data/types';
import { missPct, skillLevel, trainSkill, type Skills } from '../../src/systems/combat/skills';
import { loadContent } from '../helpers/content';

const content = loadContent();

describe('perícias de combate', () => {
  it('sobem de nível com o uso (curva geométrica) e param no máximo', () => {
    expect(skillLevel(0, BALANCE)).toBe(1);
    expect(skillLevel(BALANCE.skillCurve.base - 1, BALANCE)).toBe(1);
    expect(skillLevel(BALANCE.skillCurve.base, BALANCE)).toBe(2);
    expect(skillLevel(1e9, BALANCE)).toBe(BALANCE.skillMaxLevel);
    const skills: Skills = {};
    const ups: number[] = [];
    for (let i = 0; i < 200; i++) {
      const up = trainSkill(skills, 'archery', BALANCE);
      if (up !== null) ups.push(up);
    }
    expect(ups.slice(0, 3)).toEqual([2, 3, 4]);
  });

  it('falha-se menos com mais nível, nunca abaixo do mínimo; à distância falha-se mais', () => {
    expect(missPct(1, true, BALANCE)).toBe(BALANCE.missPctRanged);
    expect(missPct(1, false, BALANCE)).toBe(BALANCE.missPctMelee);
    expect(missPct(5, true, BALANCE)).toBeLessThan(missPct(1, true, BALANCE));
    expect(missPct(BALANCE.skillMaxLevel, false, BALANCE)).toBe(BALANCE.missPctMin);
  });

  it('cada arma treina a sua perícia', () => {
    expect(skillOf(undefined)).toBe('fists');
    expect(skillOf(content.items.wooden_club)).toBe('blunt');
    expect(skillOf(content.items.machete)).toBe('blade');
    expect(skillOf(content.items.short_bow)).toBe('archery');
    expect(skillOf(content.items.pistol)).toBe('firearms');
    expect(skillOf(content.items.wood)).toBe('fists');
  });
});

import { describe, expect, it } from 'vitest';
import { DataError, parseItems, parseResources } from '../../src/data/types';
import { loadContent } from '../helpers/content';

function problemsOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof DataError) return error.problems;
    throw error;
  }
  return [];
}

describe('dados reais', () => {
  it('items, resources e props são válidos e referem-se entre si', () => {
    const { items, resources, props } = loadContent();
    expect(Object.keys(items).length).toBeGreaterThanOrEqual(25);
    expect(resources.tree_small?.footprint).toEqual({ width: 8, height: 6 });
    expect(resources.tree_large?.toolRequired).toBe(true);
    expect(resources.tall_grass?.footprint).toBeUndefined();
    expect(props.well?.action).toBe('drink');
    expect(items.stone_axe).toMatchObject({ toolKind: 'axe', gatherPower: 2, stack: 1 });
  });
});

describe('parseResources', () => {
  it('reporta sprites em falta, footprints e drops inválidos, campos desconhecidos', () => {
    const problems = problemsOf(() =>
      parseResources(
        {
          rock: { sprite: 'nope', hp: 3, drops: [['stone', 1, 2]], respawnSec: 10 },
          tree: {
            sprite: 'tree',
            footprint: { width: 0, height: 4 },
            hp: 3,
            drops: [['wood', 3, 1]],
            respawnSec: 10,
          },
          Bush: { sprite: 'tree', hp: 3, drops: [['unicorn', 1, 1]], respawnSec: 10, color: 'red' },
          big: { sprite: 'tree', hp: 0, toolRequired: true, drops: [], respawnSec: 10 },
        },
        ['tree'],
        ['stone', 'wood'],
      ),
    );
    expect(problems).toEqual([
      expect.stringContaining('"nope"'),
      expect.stringContaining('footprint'),
      expect.stringContaining('min/max'),
      expect.stringContaining('snake_case'),
      expect.stringContaining('"color"'),
      expect.stringContaining('unicorn'),
      expect.stringContaining('hp'),
      expect.stringContaining('toolRequired sem tool'),
      expect.stringContaining('drops'),
    ]);
  });
});

describe('parseItems', () => {
  it('valida nome, ícone, tipo, efeitos, returns e durabilidade', () => {
    const problems = problemsOf(() =>
      parseItems(
        {
          apple: { name: 'item.apple', icon: 'i', type: 'consumable', stack: 10, rarity: 'common' },
          axe: {
            name: 'item.axe',
            icon: 'i',
            type: 'tool',
            stack: 5,
            rarity: 'common',
            toolKind: 'axe',
            durability: 10,
          },
          water: {
            name: 'item.water',
            icon: 'nope',
            type: 'consumable',
            stack: 10,
            rarity: 'legendary',
            effects: { thirst: 10, mana: 3 },
            returns: 'bottle',
          },
        },
        ['i'],
      ),
    );
    expect(problems).toEqual([
      expect.stringContaining('consumível sem effects'),
      expect.stringContaining('gatherPower'),
      expect.stringContaining('stack 1'),
      expect.stringContaining('"nope"'),
      expect.stringContaining('rarity'),
      expect.stringContaining('mana'),
      expect.stringContaining('bottle'),
    ]);
  });
});

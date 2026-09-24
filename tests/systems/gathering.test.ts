import { describe, expect, it } from 'vitest';
import { nextRandom, randomInt } from '../../src/core/Rng';
import { bestTool, hitPower, rollDrops, wearTool } from '../../src/systems/gathering/gathering';
import { createContainer } from '../../src/systems/inventory/inventory';
import { pickTarget, type Target } from '../../src/systems/interaction/targeting';
import { loadContent } from '../helpers/content';

const { items, resources } = loadContent();

describe('Rng', () => {
  it('é determinista para a mesma semente e fica em [0, 1)', () => {
    const a = { rng: 42 };
    const b = { rng: 42 };
    const seq = Array.from({ length: 5 }, () => nextRandom(a));
    expect(Array.from({ length: 5 }, () => nextRandom(b))).toEqual(seq);
    for (let i = 0; i < 1000; i++) {
      const v = randomInt(a, 2, 4);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(4);
    }
  });
});

describe('recolha', () => {
  const tree = resources.tree_small;
  const bigTree = resources.tree_large;
  if (!tree || !bigTree) throw new Error('faltam recursos');

  it('árvore pequena: 6 golpes à mão, 3 com machado de pedra (§7.4)', () => {
    expect(tree.hp / hitPower(tree, null)).toBe(6);
    const bag = createContainer(2);
    bag[1] = ['stone_axe', 1, 120];
    const axe = bestTool([bag], 'axe', items);
    expect(axe?.index).toBe(1);
    expect(tree.hp / hitPower(tree, axe)).toBe(3);
  });

  it('árvore grande exige machado', () => {
    expect(hitPower(bigTree, null)).toBe(0);
  });

  it('drops dentro de min–max', () => {
    const rng = { rng: 7 };
    for (let i = 0; i < 100; i++) {
      const [drop] = rollDrops(tree, rng);
      expect(drop?.item).toBe('wood');
      expect(drop?.qty).toBeGreaterThanOrEqual(2);
      expect(drop?.qty).toBeLessThanOrEqual(3);
    }
  });

  it('a ferramenta gasta-se e parte-se a 0', () => {
    const bag = createContainer(1);
    bag[0] = ['stone_axe', 1, 2];
    const axe = bestTool([bag], 'axe', items);
    if (!axe) throw new Error('sem machado');
    expect(wearTool(axe)).toBe(false);
    expect(bag[0]).toEqual(['stone_axe', 1, 1]);
    expect(wearTool(axe)).toBe(true);
    expect(bag[0]).toBeNull();
  });
});

describe('pickTarget', () => {
  const box = (x: number, y: number) => ({ x: x - 4, y: y - 4, w: 8, h: 8 });
  const targets: Target<string>[] = [
    { kind: 'resource', area: box(30, 0), data: 'árvore à direita' },
    { kind: 'resource', area: box(-14, 0), data: 'pedra à esquerda' },
    { kind: 'container', area: box(0, 14), data: 'baú em baixo' },
  ];

  it('só considera alvos em frente e ao alcance', () => {
    expect(pickTarget({ x: 0, y: 0 }, 'left', targets, 12)?.data).toBe('pedra à esquerda');
    expect(pickTarget({ x: 0, y: 0 }, 'right', targets, 12)).toBeNull(); // árvore longe demais
    expect(pickTarget({ x: 0, y: 0 }, 'up', targets, 12)).toBeNull();
  });

  it('contentor tem prioridade sobre recurso', () => {
    const near = [...targets, { kind: 'resource' as const, area: box(0, 11), data: 'erva em baixo' }];
    expect(pickTarget({ x: 0, y: 0 }, 'down', near, 12)?.data).toBe('baú em baixo');
  });
});

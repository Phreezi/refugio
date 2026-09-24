import { describe, expect, it } from 'vitest';
import {
  addItem,
  countItem,
  createContainer,
  moveSlot,
  removeItem,
  spaceFor,
  splitSlot,
  storeSimilar,
} from '../../src/systems/inventory/inventory';
import { loadContent } from '../helpers/content';

const { items } = loadContent();

describe('inventário', () => {
  it('adicionar completa stacks existentes e depois ocupa slots vazios', () => {
    const bag = createContainer(3);
    expect(addItem([bag], 'wood', 30, items)).toBe(0);
    expect(addItem([bag], 'wood', 30, items)).toBe(0);
    expect(bag).toEqual([['wood', 50], ['wood', 10], null]);
    expect(countItem([bag], 'wood')).toBe(60);
  });

  it('devolve o que não coube e não passa do stack', () => {
    const bag = createContainer(2);
    expect(addItem([bag], 'berries', 50, items)).toBe(10); // stack 20
    expect(bag).toEqual([
      ['berries', 20],
      ['berries', 20],
    ]);
    expect(spaceFor([bag], 'berries', items)).toBe(0);
  });

  it('ferramentas não empilham e nascem com a durabilidade máxima', () => {
    const bag = createContainer(3);
    addItem([bag], 'stone_axe', 2, items);
    expect(bag).toEqual([['stone_axe', 1, 120], ['stone_axe', 1, 120], null]);
    expect(spaceFor([bag], 'stone_axe', items)).toBe(1);
  });

  it('respeita a ordem dos contentores (ex.: mochila antes da hotbar)', () => {
    const bag = createContainer(1);
    const hotbar = createContainer(1);
    addItem([bag, hotbar], 'stone', 60, items);
    expect(bag).toEqual([['stone', 50]]);
    expect(hotbar).toEqual([['stone', 10]]);
  });

  it('remover é tudo ou nada', () => {
    const bag = createContainer(3);
    addItem([bag], 'fiber', 60, items);
    expect(removeItem([bag], 'fiber', 100)).toBe(false);
    expect(countItem([bag], 'fiber')).toBe(60);
    expect(removeItem([bag], 'fiber', 55)).toBe(true);
    expect(bag).toEqual([['fiber', 5], null, null]);
  });

  it('mover junta stacks iguais (o resto fica na origem) e troca itens diferentes', () => {
    const a = createContainer(2);
    const b = createContainer(2);
    a[0] = ['wood', 40];
    b[0] = ['wood', 30];
    expect(moveSlot(a, 0, b, 0, items)).toBe(true);
    expect(b[0]).toEqual(['wood', 50]);
    expect(a[0]).toEqual(['wood', 20]);
    a[1] = ['stone', 5];
    moveSlot(a, 1, b, 0, items);
    expect(b[0]).toEqual(['stone', 5]);
    expect(a[1]).toEqual(['wood', 50]);
    expect(moveSlot(a, 0, a, 0, items)).toBe(false);
    expect(moveSlot(a, 5, a, 0, items)).toBe(false);
  });

  it('dividir passa metade para o primeiro slot vazio', () => {
    const bag = createContainer(3);
    bag[1] = ['berries', 7];
    expect(splitSlot(bag, 1)).toBe(true);
    expect(bag).toEqual([['berries', 3], ['berries', 4], null]);
    expect(splitSlot(bag, 0)).toBe(true);
    expect(splitSlot(bag, 0)).toBe(false); // sem slot vazio
  });

  it('guardar semelhantes só leva o que já existe no baú', () => {
    const bag = createContainer(4);
    const chest = createContainer(4);
    bag[0] = ['wood', 20];
    bag[1] = ['stone', 5];
    bag[2] = ['berries', 3];
    chest[0] = ['wood', 45];
    chest[1] = ['berries', 1];
    expect(storeSimilar(bag, chest, items)).toBe(23);
    expect(chest).toEqual([['wood', 50], ['berries', 4], ['wood', 15], null]);
    expect(bag).toEqual([null, ['stone', 5], null, null]);
  });
});

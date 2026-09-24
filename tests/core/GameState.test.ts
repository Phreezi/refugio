import { describe, expect, it } from 'vitest';
import { BASE_ZONE_ID, GameState, createNewGameState } from '../../src/core/GameState';

const SPAWN = { x: 392, y: 392 };

describe('GameState', () => {
  it('um jogo novo começa na base, no spawn, com mochila vazia e um pouco de comida e água', () => {
    const state = createNewGameState(SPAWN);
    expect(state.player).toMatchObject({
      x: 392,
      y: 392,
      facing: 'down',
      zoneId: BASE_ZONE_ID,
      hp: 100,
      hunger: 100,
      thirst: 100,
    });
    expect(state.world).toEqual({ tick: 0, rng: 1 });
    expect(state.player.inventory).toHaveLength(20);
    expect(state.player.hotbar).toEqual([['berries', 5], ['water_clean', 2], null, null]);
    expect(state.base).toEqual({ chests: {} });
    expect(state.zones).toEqual({});
  });

  it('o estado é serializável em JSON sem perdas', () => {
    const state = createNewGameState(SPAWN);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('cada jogo novo é um objeto independente', () => {
    const a = createNewGameState(SPAWN);
    const b = createNewGameState(SPAWN);
    a.world.tick = 99;
    expect(b.world.tick).toBe(0);
  });

  it('data lança erro claro antes de haver jogo', () => {
    const gs = new GameState();
    expect(gs.hasGame).toBe(false);
    expect(() => gs.data).toThrow(/newGame/);
  });

  it('newGame() cria e substitui o jogo ativo; clear() remove-o', () => {
    const gs = new GameState();
    const first = gs.newGame(SPAWN);
    first.world.tick = 10;
    expect(gs.data.world.tick).toBe(10);
    gs.newGame(SPAWN);
    expect(gs.data.world.tick).toBe(0);
    gs.clear();
    expect(gs.hasGame).toBe(false);
  });

  it('dirty: jogo novo tem alterações; load() e markSaved() limpam; markDirty() volta a marcar', () => {
    const gs = new GameState();
    expect(gs.dirty).toBe(false);
    const data = gs.newGame(SPAWN);
    expect(gs.dirty).toBe(true);
    gs.markSaved();
    expect(gs.dirty).toBe(false);
    gs.markDirty();
    expect(gs.dirty).toBe(true);
    gs.load(data);
    expect(gs.dirty).toBe(false);
  });
});

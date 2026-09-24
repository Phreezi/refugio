import { describe, expect, it } from 'vitest';
import { BASE_MAP_TILES, TILE_SIZE } from '../../src/config';
import { BASE_ZONE_ID, GameState, createNewGameState } from '../../src/core/GameState';

describe('GameState', () => {
  it('um jogo novo começa na base, ao centro, no tick 0', () => {
    const state = createNewGameState();
    const center = (BASE_MAP_TILES * TILE_SIZE) / 2;
    expect(state).toEqual({
      player: { x: center, y: center, zoneId: BASE_ZONE_ID },
      world: { tick: 0 },
    });
  });

  it('o estado é serializável em JSON sem perdas', () => {
    const state = createNewGameState();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('cada jogo novo é um objeto independente', () => {
    const a = createNewGameState();
    const b = createNewGameState();
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
    const first = gs.newGame();
    first.world.tick = 10;
    expect(gs.data.world.tick).toBe(10);
    gs.newGame();
    expect(gs.data.world.tick).toBe(0);
    gs.clear();
    expect(gs.hasGame).toBe(false);
  });
});

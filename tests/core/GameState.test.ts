import { describe, expect, it } from 'vitest';
import { BASE_ZONE_ID, GameState, createNewGameState } from '../../src/core/GameState';

const SPAWN = { x: 392, y: 392 };

describe('GameState', () => {
  it('um jogo novo começa na base, no ponto de spawn, virado para baixo, no tick 0', () => {
    const state = createNewGameState(SPAWN);
    expect(state).toEqual({
      player: { x: 392, y: 392, facing: 'down', zoneId: BASE_ZONE_ID },
      world: { tick: 0 },
    });
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
});

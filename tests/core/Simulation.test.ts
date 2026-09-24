import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';

function setup() {
  const state = new GameState();
  state.newGame();
  const bus = new EventBus<GameEvents>();
  const ticks: number[] = [];
  bus.on('world:tick', ({ tick }) => ticks.push(tick));
  return { state, sim: new Simulation(state, bus), ticks };
}

describe('Simulation', () => {
  it('avança world.tick em passo fixo e emite world:tick', () => {
    const { state, sim, ticks } = setup();
    expect(sim.update(FIXED_STEP_MS * 3)).toBe(3);
    expect(state.data.world.tick).toBe(3);
    expect(ticks).toEqual([1, 2, 3]);
  });

  it('20 ticks por segundo de jogo', () => {
    const { state, sim } = setup();
    for (let i = 0; i < 60; i++) sim.update(1000 / 60);
    expect(state.data.world.tick).toBe(1000 / FIXED_STEP_MS);
  });

  it('reset() descarta a fração acumulada', () => {
    const { state, sim } = setup();
    sim.update(FIXED_STEP_MS * 0.9);
    sim.reset();
    sim.update(FIXED_STEP_MS * 0.9);
    expect(state.data.world.tick).toBe(0);
  });
});

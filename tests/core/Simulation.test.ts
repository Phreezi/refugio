import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';

/** Mundo 10×10 tiles vazio, com uma parede na coluna 7. */
function worldWithWall(): CollisionWorld {
  const solid = Array.from({ length: 100 }, (_, i) => i % 10 === 7);
  return new CollisionWorld(10, 10, 16, solid);
}

function setup() {
  const state = new GameState();
  state.newGame({ x: 40, y: 40 });
  const bus = new EventBus<GameEvents>();
  const ticks: number[] = [];
  bus.on('world:tick', ({ tick }) => ticks.push(tick));
  return { state, sim: new Simulation(state, bus), ticks, bus };
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

  it('sem mundo (fora de uma cena de jogo) o jogador não se move', () => {
    const { state, sim } = setup();
    sim.setMoveIntent({ x: 1, y: 0 });
    sim.update(FIXED_STEP_MS * 4);
    expect(state.data.player.x).toBe(40);
  });

  it('move o jogador à velocidade do balance.json', () => {
    const { state, sim } = setup();
    sim.setWorld(worldWithWall());
    sim.reset();
    sim.setMoveIntent({ x: 0, y: 1 });
    for (let i = 0; i < 20; i++) sim.update(FIXED_STEP_MS); // 1 s de jogo
    expect(state.data.player.y).toBeCloseTo(40 + BALANCE.playerSpeed);
    expect(state.data.player.facing).toBe('down');
    expect(sim.playerMoved).toBe(true);
  });

  it('na diagonal anda à mesma velocidade (intenção normalizada)', () => {
    const { state, sim } = setup();
    sim.setWorld(worldWithWall());
    sim.setMoveIntent({ x: -1, y: 1 });
    sim.update(FIXED_STEP_MS);
    const { x, y } = state.data.player;
    expect(Math.hypot(x - 40, y - 40)).toBeCloseTo((BALANCE.playerSpeed * FIXED_STEP_MS) / 1000);
  });

  it('guarda a posição anterior para interpolar e para quando bate na parede', () => {
    const { state, sim } = setup();
    sim.setWorld(worldWithWall());
    sim.setMoveIntent({ x: 1, y: 0 });
    sim.update(FIXED_STEP_MS);
    expect(sim.previousPlayerPosition).toEqual({ x: 40, y: 40 });
    sim.update(5000); // o limite de 5 ticks por frame não deixa "saltar" a parede
    for (let i = 0; i < 40; i++) sim.update(FIXED_STEP_MS);
    // Parede em x = 112; a caixa do jogador tem 10 px de largura, centrada nos pés.
    expect(state.data.player.x).toBe(112 - 5);
    expect(sim.playerMoved).toBe(false);
    expect(state.data.player.facing).toBe('right');
  });

  it('reset() esquece a intenção e alinha a posição anterior com a atual', () => {
    const { state, sim } = setup();
    sim.setWorld(worldWithWall());
    sim.setMoveIntent({ x: 1, y: 0 });
    sim.update(FIXED_STEP_MS);
    sim.reset();
    expect(sim.previousPlayerPosition).toEqual({ x: state.data.player.x, y: 40 });
    sim.update(FIXED_STEP_MS);
    expect(sim.playerMoved).toBe(false);
  });
});

describe('Simulation: sobrevivência e morte', () => {
  it('a fome desce com o tempo de jogo', () => {
    const { state, sim } = setup();
    for (let i = 0; i < 360; i++) sim.update(FIXED_STEP_MS); // 18 s
    expect(state.data.player.hunger).toBe(99);
    expect(state.dirty).toBe(true);
  });

  it('ao morrer reaparece no ponto de respawn, com 50% de vida, e emite player:died', () => {
    const { state, sim, bus } = setup();
    const died: string[] = [];
    bus.on('player:died', ({ zoneId }) => died.push(zoneId));
    sim.setRespawnPoint({ x: 100, y: 120 });
    Object.assign(state.data.player, { hp: 1, hunger: 0, thirst: 0, x: 10, y: 10 });
    for (let i = 0; i < 60; i++) sim.update(FIXED_STEP_MS); // 3 s
    expect(died).toEqual(['zone_base']);
    expect(state.data.player).toMatchObject({ hp: 50, hunger: 50, thirst: 50, x: 100, y: 120 });
    expect(sim.previousPlayerPosition).toEqual({ x: 100, y: 120 });
  });
});

describe('Simulation: velocidade do jogo', () => {
  it('x3 = três vezes mais tempo de jogo pelo mesmo tempo real', () => {
    const normal = setup();
    const fast = setup();
    for (let i = 0; i < 60; i++) {
      normal.sim.update(1000 / 60);
      fast.sim.update((1000 / 60) * 3);
    }
    expect(fast.state.data.world.tick).toBe(normal.state.data.world.tick * 3);
  });
});

describe('Simulation: agachado', () => {
  it('anda a metade da velocidade (sneakMultiplier)', () => {
    const { state, sim } = setup();
    sim.setWorld(worldWithWall());
    sim.setMoveIntent({ x: 0, y: 1 }, true);
    for (let i = 0; i < 20; i++) sim.update(FIXED_STEP_MS);
    expect(state.data.player.y).toBeCloseTo(40 + BALANCE.playerSpeed * BALANCE.sneakMultiplier);
    expect(sim.playerSneaking).toBe(true);
  });
});

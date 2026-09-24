import { FIXED_STEP_MS, MAX_STEPS_PER_FRAME } from '../config';
import { eventBus, type EventBus, type GameEvents } from './EventBus';
import { FixedStep } from './FixedStep';
import { gameState, type GameState } from './GameState';

/**
 * Corre a lógica do jogo em passo fixo. As cenas de jogo (Base, Zona) chamam
 * `update(delta)` uma vez por frame; os sistemas (Fase 2+) correm dentro de `tick()`.
 */
export class Simulation {
  private readonly clock = new FixedStep(FIXED_STEP_MS, MAX_STEPS_PER_FRAME);
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;

  constructor(state: GameState, bus: EventBus<GameEvents>) {
    this.state = state;
    this.bus = bus;
  }

  /** @returns número de ticks executados. */
  update(deltaMs: number): number {
    return this.clock.advance(deltaMs, () => {
      this.tick();
    });
  }

  /** Fração [0, 1) até ao próximo tick, para interpolar posições no render. */
  get alpha(): number {
    return this.clock.alpha;
  }

  /** Descarta tempo acumulado (ex.: ao entrar numa cena de jogo). */
  reset(): void {
    this.clock.reset();
  }

  private tick(): void {
    const world = this.state.data.world;
    world.tick += 1;
    this.bus.emit('world:tick', { tick: world.tick });
  }
}

export const simulation = new Simulation(gameState, eventBus);

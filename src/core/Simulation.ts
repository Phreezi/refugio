import { FIXED_STEP_MS, MAX_STEPS_PER_FRAME, PLAYER_FOOTPRINT } from '../config';
import { BALANCE } from '../data/balance';
import type { CollisionWorld } from '../systems/movement/CollisionWorld';
import { isZero, ZERO, type Vec2 } from '../systems/movement/geometry';
import { facingFromIntent, moveWithCollision, normalize } from '../systems/movement/movement';
import { eventBus, type EventBus, type GameEvents } from './EventBus';
import { FixedStep } from './FixedStep';
import { gameState, type GameState } from './GameState';

/**
 * Corre a lógica do jogo em passo fixo. As cenas de jogo (Base, Zona) chamam
 * `update(delta)` uma vez por frame; os sistemas correm dentro de `tick()`.
 */
export class Simulation {
  private readonly clock = new FixedStep(FIXED_STEP_MS, MAX_STEPS_PER_FRAME);
  private readonly state: GameState;
  private readonly bus: EventBus<GameEvents>;
  private world: CollisionWorld | null = null;
  private intent: Vec2 = ZERO;
  private previous: Vec2 = ZERO;
  private moved = false;

  constructor(state: GameState, bus: EventBus<GameEvents>) {
    this.state = state;
    this.bus = bus;
  }

  /** Geometria da zona onde o jogador está (null = sem movimento, ex.: fora de uma cena de jogo). */
  setWorld(world: CollisionWorld | null): void {
    this.world = world;
  }

  /** Direção pedida pelo input (é normalizada: nunca anda mais depressa na diagonal). */
  setMoveIntent(intent: Vec2): void {
    this.intent = normalize(intent);
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

  /** Posição dos pés do jogador antes do último tick (render: interpolar até à atual). */
  get previousPlayerPosition(): Vec2 {
    return this.previous;
  }

  /** O jogador mudou de posição no último tick? (para a animação de andar). */
  get playerMoved(): boolean {
    return this.moved;
  }

  /** Descarta tempo acumulado e o movimento anterior (ex.: ao entrar numa cena de jogo). */
  reset(): void {
    this.clock.reset();
    this.intent = ZERO;
    this.moved = false;
    if (this.state.hasGame) {
      const { x, y } = this.state.data.player;
      this.previous = { x, y };
    }
  }

  private tick(): void {
    const world = this.state.data.world;
    world.tick += 1;
    this.movePlayer();
    this.bus.emit('world:tick', { tick: world.tick });
  }

  private movePlayer(): void {
    const player = this.state.data.player;
    this.previous = { x: player.x, y: player.y };
    this.moved = false;
    if (this.world === null || isZero(this.intent)) return;

    player.facing = facingFromIntent(this.intent, player.facing);
    const step = (BALANCE.playerSpeed * FIXED_STEP_MS) / 1000;
    const delta = { x: this.intent.x * step, y: this.intent.y * step };
    const next = moveWithCollision(player, PLAYER_FOOTPRINT, delta, this.world);
    this.moved = next.x !== player.x || next.y !== player.y;
    player.x = next.x;
    player.y = next.y;
  }
}

export const simulation = new Simulation(gameState, eventBus);

import type { EventBus, GameEvents } from './EventBus';
import type { GameState } from './GameState';

/**
 * Estatísticas do jogador (CLAUDE.md §10.5, Fase 11): contam-se a ouvir os eventos do jogo e
 * mostram-se no menu de pausa. `playTicks` conta o tempo de jogo passado dentro das zonas.
 */
export class Stats {
  private readonly state: GameState;

  constructor(state: GameState, bus: EventBus<GameEvents>) {
    this.state = state;
    const add = (key: keyof GameStatsCounters): void => {
      if (!state.hasGame) return;
      state.data.stats[key] += 1;
    };
    bus.on('enemy:killed', () => {
      add('kills');
    });
    bus.on('player:died', () => {
      add('deaths');
    });
    bus.on('craft:finished', () => {
      add('crafted');
    });
    bus.on('resource:hit', ({ hp }) => {
      if (hp === 0) add('gathered');
    });
    bus.on('loot:rolled', () => {
      add('looted');
    });
  }

  /** Um tick de jogo numa zona. */
  tick(): void {
    this.state.data.stats.playTicks += 1;
  }
}

export interface GameStatsCounters {
  kills: number;
  deaths: number;
  crafted: number;
  gathered: number;
  looted: number;
}

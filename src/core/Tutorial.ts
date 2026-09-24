import { BALANCE } from '../data/balance';
import type { EventBus, GameEvents } from './EventBus';
import { BASE_ZONE_ID, type GameState } from './GameState';

/**
 * Passos do tutorial (CLAUDE.md §11, Fase 11), pela ordem em que aparecem. Cada um mostra uma
 * dica curta e fica feito quando o jogador faz a coisa (ouve os eventos do jogo).
 */
export const TUTORIAL_STEPS = ['move', 'gather', 'craft', 'build', 'eat', 'travel'] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/**
 * Tutorial curto e contextual: primeira árvore, primeiro craft, primeira peça, comer quando a
 * fome desce e a primeira zona. O progresso fica no save (`tutorial`); pode desligar-se.
 */
export class Tutorial {
  private readonly state: GameState;

  constructor(state: GameState, bus: EventBus<GameEvents>) {
    this.state = state;
    bus.on('resource:hit', () => {
      this.complete('gather');
    });
    bus.on('craft:finished', () => {
      this.complete('craft');
    });
    bus.on('structure:placed', () => {
      this.complete('build');
    });
    bus.on('player:consumed', () => {
      this.complete('eat');
    });
    bus.on('zone:change', ({ to }) => {
      if (to !== BASE_ZONE_ID) this.complete('travel');
    });
  }

  /** Dica a mostrar agora (null = nenhuma: tudo feito, desligado, ou ainda não é altura). */
  current(): TutorialStep | null {
    if (!this.state.hasGame) return null;
    const { tutorial, player } = this.state.data;
    if (tutorial.off) return null;
    for (const step of TUTORIAL_STEPS) {
      if (tutorial.done.includes(step)) continue;
      // Comer só aparece quando a fome começa a descer.
      if (step === 'eat' && player.hunger > BALANCE.statMax * 0.7) continue;
      return step;
    }
    return null;
  }

  /** Desliga as dicas (botão × na dica). */
  dismiss(): void {
    if (!this.state.hasGame) return;
    this.state.data.tutorial.off = true;
    this.state.markDirty();
  }

  private complete(step: TutorialStep): void {
    if (!this.state.hasGame) return;
    const done = this.state.data.tutorial.done;
    if (done.includes(step)) return;
    done.push(step);
    this.state.markDirty();
  }

  /** O jogador andou (chamado pela Simulation). */
  playerMoved(): void {
    if (this.state.hasGame && !this.state.data.tutorial.done.includes('move')) this.complete('move');
  }
}

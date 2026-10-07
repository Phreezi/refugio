import { BALANCE } from '../data/balance';
import type { EventBus, GameEvents } from './EventBus';
import { BASE_ZONE_ID, type GameState } from './GameState';

/**
 * Passos do tutorial (CLAUDE.md §11, Fase 11), pela ordem em que aparecem. Cada um mostra uma
 * dica curta e fica feito quando o jogador faz a coisa (ouve os eventos do jogo). Depois de
 * construir, a dica leva ao primeiro NPC (`talk`): daí em diante as missões são o fio condutor.
 */
export const TUTORIAL_STEPS = ['move', 'gather', 'craft', 'build', 'eat', 'talk', 'travel'] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** O que as dicas pedem para fabricar e construir primeiro (a dica diz o que falta juntar). */
export const TUTORIAL_RECIPE = 'r_stone_axe';
export const TUTORIAL_STRUCTURE = 'campfire';

/** Os Caminhos do mundo contínuo não contam como "a primeira zona" (são só passagem). */
const ROUTE_PREFIX = 'zone_route_';

/**
 * Tutorial curto e contextual: primeira árvore, primeiro craft, primeira peça, comer quando a
 * fome desce, falar com o primeiro NPC e a primeira zona. O progresso fica no save (`tutorial`);
 * pode desligar-se.
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
    bus.on('quest:accepted', () => {
      this.complete('talk');
    });
    // A pé (mundo contínuo) passa-se a borda sem ecrã de viagem: conta também.
    bus.on('zone:change', ({ to }) => {
      this.visited(to);
    });
    bus.on('zone:cross', ({ to }) => {
      this.visited(to);
    });
  }

  /** Dica a mostrar agora (null = nenhuma: tudo feito, desligado, ou ainda não é altura). */
  current(): TutorialStep | null {
    if (!this.state.hasGame) return null;
    const { tutorial, player } = this.state.data;
    if (tutorial.off) return null;
    const hasQuests = player.quests.done.length > 0 || Object.keys(player.quests.active).length > 0;
    for (const step of TUTORIAL_STEPS) {
      if (tutorial.done.includes(step)) continue;
      // Comer só aparece quando a fome começa a descer.
      if (step === 'eat' && player.hunger > BALANCE.statMax * 0.7) continue;
      // Construir só se faz em casa: fora dela passa-se à dica seguinte.
      if (step === 'build' && player.zoneId !== BASE_ZONE_ID) continue;
      // Com missões, são elas que guiam (a seta e o registo no HUD): falar com o primeiro NPC já
      // está feito e a missão do Pinhal substitui a dica de viajar (não dar duas ordens).
      if ((step === 'talk' || step === 'travel') && hasQuests) continue;
      return step;
    }
    return null;
  }

  private visited(zoneId: string | null): void {
    if (zoneId && zoneId !== BASE_ZONE_ID && !zoneId.startsWith(ROUTE_PREFIX)) this.complete('travel');
  }

  /** Desliga as dicas (botão × na dica). */
  dismiss(): void {
    if (!this.state.hasGame) return;
    this.state.data.tutorial.off = true;
    this.state.markDirty();
  }

  private complete(step: TutorialStep): void {
    if (!this.state.hasGame || this.state.borrowed) return;
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

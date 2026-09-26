import type Phaser from 'phaser';
import { gameState } from '../core/GameState';
import { autosave } from '../save';

const RESUME_KEY = 'refugio.resume';

/**
 * O iPhone (e outros telemóveis com pouca memória) pode "perder" o contexto WebGL: a imagem
 * fica parada ou estragada e nada responde. Em vez de ficar assim, grava já (de forma
 * síncrona) e recarrega a página, que volta sozinha ao jogo (`consumeResume` no menu).
 */
export function installContextLossRecovery(game: Phaser.Game): void {
  game.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    autosave.flushSync();
    try {
      if (gameState.hasGame) window.sessionStorage.setItem(RESUME_KEY, '1');
    } catch {
      // Sem sessionStorage: recarrega na mesma (fica no menu).
    }
    window.setTimeout(() => {
      window.location.reload();
    }, 200);
  });
}

/** Voltar ao jogo depois de recarregar por perda do contexto? (lê e apaga o pedido). */
export function consumeResume(): boolean {
  try {
    const resume = window.sessionStorage.getItem(RESUME_KEY) === '1';
    window.sessionStorage.removeItem(RESUME_KEY);
    return resume;
  } catch {
    return false;
  }
}

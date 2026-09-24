import type Phaser from 'phaser';
import { moveInput } from '../input/moveInput';

/** Telemóveis/tablets (ponteiro "grosso") ao alto. Num PC com a janela estreita não aparece. */
const PORTRAIT_TOUCH_QUERY = '(orientation: portrait) and (pointer: coarse)';

/**
 * Aviso "roda o ecrã" (CLAUDE.md §3.1: o jogo é só landscape). Enquanto está visível o jogo
 * fica em pausa, para o jogador não ser surpreendido quando voltar a rodar.
 */
export function installOrientationNotice(
  game: Phaser.Game,
  element: HTMLElement,
  message: string,
): () => void {
  element.textContent = message;
  const query = window.matchMedia(PORTRAIT_TOUCH_QUERY);
  let pausedByUs = false;

  const update = (): void => {
    const portrait = query.matches;
    element.hidden = !portrait;
    if (portrait && !game.isPaused) {
      game.pause();
      moveInput.reset();
      pausedByUs = true;
    } else if (!portrait && pausedByUs) {
      game.resume();
      pausedByUs = false;
    }
  };

  query.addEventListener('change', update);
  update();
  return () => {
    query.removeEventListener('change', update);
  };
}

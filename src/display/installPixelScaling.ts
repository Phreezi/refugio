import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { computePixelScale, type PixelScale } from './pixelScale';

// Escala inteira em píxeis do dispositivo (CLAUDE.md §3.1). O Phaser 4 não tem um modo
// de escala inteira nem considera o devicePixelRatio, por isso usamos Scale.NONE e
// controlamos o tamanho CSS via `scale.setZoom(deviceZoom / dpr)` (aceita frações e
// atualiza o mapeamento do input) e a posição via left/top alinhados ao dispositivo.

export interface PixelScaling {
  /** Escala atualmente aplicada. */
  readonly current: PixelScale;
  readonly devicePixelRatio: number;
  dispose(): void;
}

export function installPixelScaling(game: Phaser.Game, host: HTMLElement): PixelScaling {
  let current = computePixelScale(GAME_WIDTH, GAME_HEIGHT, 1, GAME_WIDTH, GAME_HEIGHT);
  let dpr = 1;
  let applied: { zoom: number; dpr: number; x: number; y: number } | null = null;

  const apply = (): void => {
    const canvas = game.canvas as HTMLCanvasElement | null;
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    const rect = host.getBoundingClientRect();
    current = computePixelScale(rect.width, rect.height, dpr, GAME_WIDTH, GAME_HEIGHT);

    // Só mexe no canvas quando algo muda: setZoom/refresh emitem RESIZE a cada chamada.
    const zoomChanged = applied?.zoom !== current.deviceZoom || applied.dpr !== dpr;
    const moved = applied?.x !== current.offsetX || applied.y !== current.offsetY;
    if (!zoomChanged && !moved) return;
    applied = { zoom: current.deviceZoom, dpr, x: current.offsetX, y: current.offsetY };

    canvas.style.position = 'absolute';
    canvas.style.left = `${String(current.offsetX)}px`;
    canvas.style.top = `${String(current.offsetY)}px`;
    if (zoomChanged) game.scale.setZoom(current.deviceZoom / dpr);
    else game.scale.refresh(); // a posição mudou: atualizar os limites usados pelo input
  };

  // O devicePixelRatio muda com o zoom do browser ou ao mudar de monitor; nem sempre há 'resize'.
  let dprQuery: MediaQueryList | null = null;
  const onDprChange = (): void => {
    watchDpr();
    apply();
  };
  const watchDpr = (): void => {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${String(window.devicePixelRatio || 1)}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  };

  const resizeObserver = new ResizeObserver(apply);
  resizeObserver.observe(host);
  window.addEventListener('resize', apply);
  watchDpr();

  if (game.isBooted) apply();
  else game.events.once(Phaser.Core.Events.READY, apply);

  return {
    get current() {
      return current;
    },
    get devicePixelRatio() {
      return dpr;
    },
    dispose() {
      resizeObserver.disconnect();
      window.removeEventListener('resize', apply);
      dprQuery?.removeEventListener('change', onDprChange);
      game.events.off(Phaser.Core.Events.READY, apply);
    },
  };
}

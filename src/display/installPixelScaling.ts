import Phaser from 'phaser';
import { DISPLAY } from '../config';
import { computePixelScale, type PixelScale, type PixelScaleOptions } from './pixelScale';

// Resolução adaptável + escala inteira em píxeis do dispositivo (CLAUDE.md §3.1). O Phaser 4 não
// tem um modo de escala inteira nem considera o devicePixelRatio, por isso usamos Scale.NONE:
// `scale.resize(w, h)` muda a resolução interna, `scale.setZoom(deviceZoom / dpr)` o tamanho CSS
// (aceita frações e atualiza o mapeamento do input) e left/top alinham o canvas ao dispositivo.

export interface PixelScaling {
  /** Escala atualmente aplicada. */
  readonly current: PixelScale;
  readonly devicePixelRatio: number;
  dispose(): void;
}

function displayOptions(): PixelScaleOptions {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  return {
    targetHeight: touch ? DISPLAY.touchTargetHeight : DISPLAY.targetHeight,
    minHeight: DISPLAY.minHeight,
    minAspect: DISPLAY.minAspect,
    maxAspect: DISPLAY.maxAspect,
  };
}

/** Escala para o tamanho atual de `host` (usada também para criar o jogo já com o tamanho certo). */
export function measurePixelScale(host: HTMLElement): PixelScale {
  const rect = host.getBoundingClientRect();
  return computePixelScale(rect.width, rect.height, window.devicePixelRatio || 1, displayOptions());
}

export function installPixelScaling(game: Phaser.Game, host: HTMLElement): PixelScaling {
  let current = measurePixelScale(host);
  let dpr = window.devicePixelRatio || 1;
  let applied: (PixelScale & { dpr: number }) | null = null;

  const apply = (): void => {
    const canvas = game.canvas as HTMLCanvasElement | null;
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    current = measurePixelScale(host);

    // Só mexe no canvas quando algo muda: resize/setZoom/refresh emitem RESIZE a cada chamada.
    const sizeChanged = applied?.gameWidth !== current.gameWidth || applied.gameHeight !== current.gameHeight;
    const zoomChanged = applied?.deviceZoom !== current.deviceZoom || applied.dpr !== dpr;
    const moved = applied?.offsetX !== current.offsetX || applied.offsetY !== current.offsetY;
    if (!sizeChanged && !zoomChanged && !moved) return;
    applied = { ...current, dpr };

    canvas.style.position = 'absolute';
    canvas.style.left = `${String(current.offsetX)}px`;
    canvas.style.top = `${String(current.offsetY)}px`;
    if (sizeChanged) game.scale.resize(current.gameWidth, current.gameHeight);
    if (sizeChanged || zoomChanged) game.scale.setZoom(current.deviceZoom / dpr);
    else game.scale.refresh(); // só a posição mudou: atualizar os limites usados pelo input
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

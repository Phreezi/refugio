import Phaser from 'phaser';
import { DISPLAY } from '../config';
import { computePixelScale, type PixelScale, type PixelScaleOptions } from './pixelScale';
import { setView } from './view';
import { preferences, UI_SIZE_TARGET } from '../ui/preferences';

// Resolução adaptável + escala inteira em píxeis do dispositivo (CLAUDE.md §3.1). O Phaser 4 não
// tem um modo de escala inteira nem considera o devicePixelRatio, por isso usamos Scale.NONE:
// o canvas tem a resolução do DISPOSITIVO (`scale.resize`), `scale.setZoom(1 / dpr)` dá-lhe o
// tamanho CSS certo (e atualiza o mapeamento do input), left/top alinham-no ao dispositivo, e as
// câmaras ampliam o mundo por `deviceZoom` (ver view.ts).

export interface PixelScaling {
  /** Escala atualmente aplicada. */
  readonly current: PixelScale;
  readonly devicePixelRatio: number;
  dispose(): void;
}

function displayOptions(): PixelScaleOptions {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const base = touch ? DISPLAY.touchTargetHeight : DISPLAY.targetHeight;
  // Tamanho da interface (definições): menos píxeis de jogo no lado curto = tudo maior.
  const size = UI_SIZE_TARGET[preferences().uiSize] / UI_SIZE_TARGET.normal;
  return {
    targetHeight: Math.round(base * size),
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
  setView({ width: current.gameWidth, height: current.gameHeight, zoom: current.deviceZoom });
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
    // A vista muda antes do resize: quem ouve o RESIZE já lê os valores novos.
    setView({ width: current.gameWidth, height: current.gameHeight, zoom: current.deviceZoom });
    if (sizeChanged || zoomChanged) {
      game.scale.resize(current.canvasWidth, current.canvasHeight);
      game.scale.setZoom(1 / dpr);
    } else {
      game.scale.refresh(); // só a posição mudou: atualizar os limites usados pelo input
    }
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

import Phaser from 'phaser';
import { DISPLAY } from '../config';
import { computePixelScale, type PixelScale, type PixelScaleOptions } from './pixelScale';
import { preferences } from '../ui/preferences';
import { setView, uiZoomFor, type View } from './view';

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

/** Vista da interface (tamanho escolhido nas definições) para uma escala. */
function uiViewFor(scale: PixelScale): View {
  const zoom = uiZoomFor(
    scale.deviceZoom,
    preferences().uiSize,
    Math.min(scale.canvasWidth, scale.canvasHeight),
  );
  if (zoom === scale.deviceZoom) {
    return { width: scale.gameWidth, height: scale.gameHeight, zoom };
  }
  const even = (v: number): number => v - (v % 2);
  return {
    width: even(Math.floor(scale.canvasWidth / zoom)),
    height: even(Math.floor(scale.canvasHeight / zoom)),
    zoom,
  };
}

function applyView(scale: PixelScale): number {
  const ui = uiViewFor(scale);
  setView({ width: scale.gameWidth, height: scale.gameHeight, zoom: scale.deviceZoom }, ui);
  return ui.zoom;
}

let reapply: (() => boolean) | null = null;

/**
 * Volta a aplicar a vista (depois de mudar o tamanho da interface nas definições).
 * @returns true se a vista mudou (as cenas recebem RESIZE e refazem-se).
 */
export function applyUiSize(): boolean {
  return reapply?.() ?? false;
}

export function installPixelScaling(game: Phaser.Game, host: HTMLElement): PixelScaling {
  let current = measurePixelScale(host);
  applyView(current);
  let dpr = window.devicePixelRatio || 1;
  let applied: (PixelScale & { dpr: number; uiZoom: number }) | null = null;

  const apply = (): boolean => {
    const canvas = game.canvas as HTMLCanvasElement | null;
    if (!canvas) return false;
    // A escrever num campo de texto: o teclado do telemóvel encolhe a janela, e refazer a vista
    // reiniciava o menu (fechava o campo — "pisca e não deixa escrever"). Espera-se pelo fim.
    if (typingInField()) return false;
    dpr = window.devicePixelRatio || 1;
    current = measurePixelScale(host);

    // Só mexe no canvas quando algo muda: resize/setZoom/refresh emitem RESIZE a cada chamada.
    const sizeChanged = applied?.gameWidth !== current.gameWidth || applied.gameHeight !== current.gameHeight;
    const zoomChanged = applied?.deviceZoom !== current.deviceZoom || applied.dpr !== dpr;
    const moved = applied?.offsetX !== current.offsetX || applied.offsetY !== current.offsetY;
    const uiZoom = uiViewFor(current).zoom;
    const uiChanged = applied?.uiZoom !== uiZoom;
    if (!sizeChanged && !zoomChanged && !moved && !uiChanged) return false;
    applied = { ...current, dpr, uiZoom };

    canvas.style.position = 'absolute';
    canvas.style.left = `${String(current.offsetX)}px`;
    canvas.style.top = `${String(current.offsetY)}px`;
    // A vista muda antes do resize: quem ouve o RESIZE já lê os valores novos.
    applyView(current);
    if (sizeChanged || zoomChanged) {
      game.scale.resize(current.canvasWidth, current.canvasHeight);
      game.scale.setZoom(1 / dpr);
    } else {
      game.scale.refresh(); // só a posição (ou a interface) mudou: emite RESIZE
    }
    return true;
  };

  // O devicePixelRatio muda com o zoom do browser ou ao mudar de monitor; nem sempre há 'resize'.
  let dprQuery: MediaQueryList | null = null;
  const onDprChange = (): void => {
    watchDpr();
    apply();
  };
  const onResize = (): void => {
    apply();
  };
  const watchDpr = (): void => {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${String(window.devicePixelRatio || 1)}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  };

  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(host);
  window.addEventListener('resize', onResize);
  // Ao sair do campo de texto (teclado fechado), aplica o tamanho que ficou por aplicar.
  const onFocusOut = (): void => {
    setTimeout(onResize, 300); // depois do toque que tirou o foco (ex.: "Começar")
  };
  document.addEventListener('focusout', onFocusOut);
  watchDpr();
  reapply = apply;

  if (game.isBooted) apply();
  else game.events.once(Phaser.Core.Events.READY, onResize);

  return {
    get current() {
      return current;
    },
    get devicePixelRatio() {
      return dpr;
    },
    dispose() {
      if (reapply === apply) reapply = null;
      resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('focusout', onFocusOut);
      dprQuery?.removeEventListener('change', onDprChange);
      game.events.off(Phaser.Core.Events.READY, onResize);
    },
  };
}

/** Há um campo de texto do DOM com o foco (ver ui/textInput.ts)? */
function typingInField(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
}

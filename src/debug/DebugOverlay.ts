import { FIXED_STEP_MS, TILE_SIZE } from '../config';

// Overlay de debug (F3): FPS, tick, posição do jogador, cenas ativas e escala.
// É um elemento DOM por cima do canvas, e não um objeto do Phaser: fica nítido a
// qualquer escala e não interfere com o render nem com a UIScene.

export interface DebugInfo {
  fps: number;
  /** null quando ainda não há jogo (menu). */
  tick: number | null;
  player: { x: number; y: number } | null;
  scenes: readonly string[];
  /** Píxeis do dispositivo por píxel de jogo. */
  deviceZoom: number;
  devicePixelRatio: number;
}

const REFRESH_MS = 250;

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

export function formatDebugInfo(info: DebugInfo): string {
  const lines = [`FPS ${String(Math.round(info.fps))}`];
  if (info.tick === null) lines.push('tick —');
  else lines.push(`tick ${String(info.tick)} · ${round1((info.tick * FIXED_STEP_MS) / 1000)} s`);
  if (info.player === null) {
    lines.push('pos —');
  } else {
    const { x, y } = info.player;
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    lines.push(`pos ${round1(x)}, ${round1(y)} · tile ${String(tx)}, ${String(ty)}`);
  }
  lines.push(`cenas ${info.scenes.length > 0 ? info.scenes.join(' + ') : '—'}`);
  lines.push(`escala ×${round1(info.deviceZoom)} · dpr ${round1(info.devicePixelRatio)}`);
  return lines.join('\n');
}

export class DebugOverlay {
  private readonly element: HTMLDivElement;
  private readonly readInfo: () => DebugInfo;
  private timer: number | undefined;

  constructor(readInfo: () => DebugInfo, parent: HTMLElement = document.body) {
    this.readInfo = readInfo;
    this.element = document.createElement('div');
    this.element.id = 'debug-overlay';
    Object.assign(this.element.style, {
      position: 'fixed',
      top: 'max(4px, env(safe-area-inset-top))',
      left: 'max(4px, env(safe-area-inset-left))',
      zIndex: '10',
      padding: '4px 6px',
      font: '12px/1.35 ui-monospace, Consolas, monospace',
      color: '#fbf3de',
      background: 'rgba(28, 21, 33, 0.8)',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.element);
  }

  get visible(): boolean {
    return this.timer !== undefined;
  }

  show(): void {
    if (this.visible) return;
    this.element.style.display = 'block';
    this.refresh();
    this.timer = window.setInterval(() => {
      this.refresh();
    }, REFRESH_MS);
  }

  hide(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.element.style.display = 'none';
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  destroy(): void {
    this.hide();
    this.element.remove();
  }

  private refresh(): void {
    this.element.textContent = formatDebugInfo(this.readInfo());
  }
}

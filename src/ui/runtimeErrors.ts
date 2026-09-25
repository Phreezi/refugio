import Phaser from 'phaser';
import { PALETTE } from '../assets/palette';
import { EventBus } from '../core/EventBus';
import { t } from '../i18n';

/** Linhas da stack mostradas (o resto fica na consola). */
const STACK_LINES = 4;

let box: HTMLDivElement | null = null;
const seen = new Map<string, number>();

/**
 * Mostra um erro do jogo por cima do ecrã (em DOM: funciona mesmo que o Phaser esteja em
 * mau estado) e regista-o na consola. No telemóvel não há consola: assim o jogador pode
 * tirar uma captura e enviá-la. O mesmo erro só conta mais uma vez.
 */
export function reportError(error: unknown, where = ''): void {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  const key = `${where}|${message}`;
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  const stack = error instanceof Error ? (error.stack ?? '').split('\n').slice(0, STACK_LINES) : [];
  box ??= createBox();
  const text = [
    t('error.runtime'),
    `${where ? `[${where}] ` : ''}${message}${count > 1 ? ` (×${String(count)})` : ''}`,
    ...stack,
  ];
  const body = box.querySelector('pre');
  if (body) body.textContent = text.join('\n');
  box.style.display = 'block';
}

function createBox(): HTMLDivElement {
  const div = document.createElement('div');
  Object.assign(div.style, {
    position: 'fixed',
    left: '8px',
    right: '8px',
    bottom: '8px',
    zIndex: '1000',
    background: PALETTE.blood,
    color: PALETTE.cream,
    font: '20px "Jersey 10", monospace',
    padding: '8px 28px 8px 8px',
    borderRadius: '4px',
    maxHeight: '40vh',
    overflow: 'auto',
  });
  const pre = document.createElement('pre');
  Object.assign(pre.style, { margin: '0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' });
  const close = document.createElement('button');
  close.textContent = '×';
  Object.assign(close.style, {
    position: 'absolute',
    top: '4px',
    right: '4px',
    background: 'none',
    border: 'none',
    color: 'inherit',
    font: '18px monospace',
    cursor: 'pointer',
  });
  close.addEventListener('click', () => {
    div.style.display = 'none';
  });
  div.append(pre, close);
  document.body.append(div);
  return div;
}

/**
 * Um erro durante o jogo já não o congela: o passo do Phaser (atualizar + desenhar) é
 * protegido, os handlers do EventBus também, e o erro aparece no ecrã. Chamar antes de
 * criar o `Phaser.Game`.
 */
export function installRuntimeErrors(): void {
  const proto = Phaser.Game.prototype;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- chamado com call(this) abaixo
  const step = proto.step;
  proto.step = function (this: Phaser.Game, time: number, delta: number): void {
    try {
      step.call(this, time, delta);
    } catch (error) {
      reportError(error, 'step');
    }
  };
  EventBus.onListenerError = (error, event) => {
    reportError(error, event);
  };
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason);
  });
}

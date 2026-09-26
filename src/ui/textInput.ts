import { PALETTE } from '../assets/palette';
import { getView } from '../display/view';
import { UI_FONT } from './text';

export interface TextInputOptions {
  /** Retângulo em píxeis de jogo (câmara fixa: a vista do menu). */
  x: number;
  y: number;
  w: number;
  h: number;
  maxLength: number;
  placeholder?: string;
  value?: string;
  /** Maiúsculas (códigos). */
  uppercase?: boolean;
  /** Enter dentro do campo. */
  onEnter?: () => void;
}

export interface TextInput {
  readonly value: string;
  focus(): void;
  destroy(): void;
}

/**
 * Campo de texto com o aspeto do jogo, por cima do canvas: um `<input>` do DOM (teclado do
 * telemóvel, colar, acentos) posicionado e estilizado a partir de píxeis de jogo.
 */
export function createTextInput(canvas: HTMLCanvasElement, options: TextInputOptions): TextInput {
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = options.maxLength;
  input.value = options.value ?? '';
  input.placeholder = options.placeholder ?? '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (options.uppercase) input.autocapitalize = 'characters';
  const place = (): void => {
    const rect = canvas.getBoundingClientRect();
    // Píxeis CSS por píxel de jogo da interface (o canvas pode ter uns píxeis a mais à direita).
    const scale = canvas.width > 0 ? (rect.width / canvas.width) * getView().zoom : 1;
    Object.assign(input.style, {
      position: 'fixed',
      left: `${String(rect.left + options.x * scale)}px`,
      top: `${String(rect.top + options.y * scale)}px`,
      width: `${String(options.w * scale)}px`,
      height: `${String(options.h * scale)}px`,
      fontSize: `${String(Math.round(options.h * scale * 0.6))}px`,
    });
  };
  Object.assign(input.style, {
    boxSizing: 'border-box',
    zIndex: '500',
    padding: '0 0.4em',
    border: `2px solid ${PALETTE.bark_dark}`,
    outline: 'none',
    background: PALETTE.night,
    color: PALETTE.cream,
    fontFamily: UI_FONT,
    textTransform: options.uppercase ? 'uppercase' : 'none',
    userSelect: 'text',
    webkitUserSelect: 'text',
    touchAction: 'auto',
  });
  input.addEventListener('keydown', (event) => {
    // As teclas escritas não chegam ao jogo (WASD, Espaço…).
    event.stopPropagation();
    if (event.key === 'Enter') options.onEnter?.();
  });
  place();
  window.addEventListener('resize', place);
  document.body.append(input);
  return {
    get value() {
      return input.value;
    },
    focus() {
      input.focus();
    },
    destroy() {
      window.removeEventListener('resize', place);
      input.remove();
    },
  };
}

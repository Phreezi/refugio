import { t, type MessageKey } from '../i18n';

/** Ecrã tátil como entrada principal (telemóvel, tablet)? */
export function isTouchScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/** Texto de ajuda com a variante do PC (`<chave>.keys`: "clica", teclas) quando não há toque. */
export function tInput(touchKey: MessageKey, keysKey: MessageKey): string {
  return t(isTouchScreen() ? touchKey : keysKey);
}

// Preferências de quem joga (CLAUDE.md §11, Fase 11): pertencem ao dispositivo, não ao mundo,
// por isso ficam no browser (localStorage) e valem já no menu inicial. As hordas, que mudam o
// jogo, ficam no save (`settings.hordes`).

import { DEFAULT_LANGUAGE, isLanguage, type Language } from '../i18n';

export type UiSize = 'small' | 'normal' | 'large';
export const UI_SIZES: readonly UiSize[] = ['small', 'normal', 'large'];

export interface Preferences {
  language: Language;
  /** Tamanho da interface: muda o "zoom" (quantos píxeis de jogo cabem no lado curto do ecrã). */
  uiSize: UiSize;
  /** Números de dano a subir (nos inimigos e no jogador). */
  damageNumbers: boolean;
  /** Vibrar ao levar dano (telemóvel). */
  vibration: boolean;
  /** Modo daltónico: marcas de raridade nos slots, além da cor. */
  colorblind: boolean;
}

const STORAGE_KEY = 'refugio.prefs';

export const DEFAULT_PREFERENCES: Preferences = {
  language: DEFAULT_LANGUAGE,
  uiSize: 'normal',
  damageNumbers: true,
  vibration: true,
  colorblind: false,
};

/** Lado curto alvo (px de jogo) para cada tamanho: menos píxeis de jogo = tudo maior. */
export const UI_SIZE_TARGET: Readonly<Record<UiSize, number>> = { small: 320, normal: 270, large: 230 };

/** Lê preferências gravadas, ignorando valores estranhos (ficam os de omissão). */
export function parsePreferences(text: string | null): Preferences {
  const prefs = { ...DEFAULT_PREFERENCES };
  if (!text) return prefs;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return prefs;
  }
  if (typeof raw !== 'object' || raw === null) return prefs;
  const r = raw as Record<string, unknown>;
  if (typeof r.language === 'string' && isLanguage(r.language)) prefs.language = r.language;
  const size = UI_SIZES.find((s) => s === r.uiSize);
  if (size) prefs.uiSize = size;
  for (const key of ['damageNumbers', 'vibration', 'colorblind'] as const) {
    if (typeof r[key] === 'boolean') prefs[key] = r[key];
  }
  return prefs;
}

function read(): Preferences {
  try {
    return parsePreferences(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

let current: Preferences = typeof window === 'undefined' ? { ...DEFAULT_PREFERENCES } : read();

export function preferences(): Readonly<Preferences> {
  return current;
}

/** Muda uma preferência e grava-a (sem localStorage, dura só esta sessão). */
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  current = { ...current, [key]: value };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // sem localStorage: dura só esta sessão
  }
}

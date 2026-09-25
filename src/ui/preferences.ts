// Preferências de quem joga (CLAUDE.md §11, Fase 11): pertencem ao dispositivo, não ao mundo,
// por isso ficam no browser (localStorage) e valem já no menu inicial. As hordas, que mudam o
// jogo, ficam no save (`settings.hordes`).

import { DEFAULT_LANGUAGE, isLanguage, type Language } from '../i18n';

export interface Preferences {
  language: Language;
  /** Números de dano a subir (nos inimigos e no jogador). */
  damageNumbers: boolean;
  /** Vibrar ao levar dano (telemóvel). */
  vibration: boolean;
  /** Modo daltónico: marcas de raridade nos slots, além da cor. */
  colorblind: boolean;
  /** Volume dos sons (0–1; 0 = sem som). */
  volume: number;
  /** Ataque automático ligado (botão "Auto" do HUD). */
  autoAttack: boolean;
}

const STORAGE_KEY = 'refugio.prefs';

export const DEFAULT_PREFERENCES: Preferences = {
  language: DEFAULT_LANGUAGE,
  damageNumbers: true,
  vibration: true,
  colorblind: false,
  volume: 0.6,
  autoAttack: false,
};

/** Níveis de volume das definições (tocar muda para o seguinte). */
export const VOLUME_STEPS: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

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
  for (const key of ['damageNumbers', 'vibration', 'colorblind', 'autoAttack'] as const) {
    if (typeof r[key] === 'boolean') prefs[key] = r[key];
  }
  if (typeof r.volume === 'number' && r.volume >= 0 && r.volume <= 1) prefs.volume = r.volume;
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

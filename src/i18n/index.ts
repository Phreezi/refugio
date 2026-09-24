import en from './en.json';
import ptPT from './pt-PT.json';

export const LANGUAGES = ['pt-PT', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'pt-PT';

/** Chaves de texto: o pt-PT é a referência; o TypeScript obriga o en a ter as mesmas. */
export type MessageKey = keyof typeof ptPT;
export type Messages = Readonly<Record<MessageKey, string>>;

const dictionaries: Readonly<Record<Language, Messages>> = { 'pt-PT': ptPT, en };

let current: Language = DEFAULT_LANGUAGE;

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  current = language;
}

/**
 * Texto visível ao jogador. Substitui `{nome}` pelos valores de `params`;
 * marcadores sem valor ficam como estão, para o erro ser visível.
 */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const template = dictionaries[current][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

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

/**
 * Texto para chaves construídas em runtime (ex.: `item.${id}`). O `validate-data` garante que
 * existem; se faltar alguma, mostra a própria chave (erro visível, sem rebentar).
 */
export function tKey(key: string, params?: Readonly<Record<string, string | number>>): string {
  return key in dictionaries[current] ? t(key as MessageKey, params) : key;
}

/** Nome traduzido de um item. */
export function itemName(id: string): string {
  return tKey(`item.${id}`);
}

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

/** Textos criados em runtime (nomes das zonas selvagens, aldeias e missões geradas). */
const dynamic: Record<Language, Record<string, string>> = { 'pt-PT': {}, en: {} };

/** Junta textos gerados por código (por língua). */
export function defineTexts(texts: Readonly<Record<Language, Readonly<Record<string, string>>>>): void {
  for (const language of LANGUAGES) Object.assign(dynamic[language], texts[language]);
}

/** Texto de uma chave numa língua dada (para gerar textos nas duas línguas). */
export function textIn(language: Language, key: string): string {
  const dict: Readonly<Record<string, string>> = dictionaries[language];
  return dict[key] ?? dynamic[language][key] ?? key;
}

function fill(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

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
  return fill(dictionaries[current][key], params);
}

/**
 * Texto para chaves construídas em runtime (ex.: `item.${id}`). O `validate-data` garante que
 * existem; se faltar alguma, mostra a própria chave (erro visível, sem rebentar).
 */
export function tKey(key: string, params?: Readonly<Record<string, string | number>>): string {
  if (key in dictionaries[current]) return t(key as MessageKey, params);
  const generated = dynamic[current][key];
  return generated === undefined ? key : fill(generated, params);
}

/** Nome traduzido de um item. */
export function itemName(id: string): string {
  return tKey(`item.${id}`);
}

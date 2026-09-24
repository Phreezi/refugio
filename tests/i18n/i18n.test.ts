import { afterEach, describe, expect, it } from 'vitest';
import en from '../../src/i18n/en.json';
import ptPT from '../../src/i18n/pt-PT.json';
import { DEFAULT_LANGUAGE, isLanguage, setLanguage, t } from '../../src/i18n';

afterEach(() => {
  setLanguage(DEFAULT_LANGUAGE);
});

describe('i18n', () => {
  it('pt-PT é a língua por defeito', () => {
    expect(DEFAULT_LANGUAGE).toBe('pt-PT');
    expect(t('menu.new_game')).toBe('Novo jogo');
  });

  it('pt-PT e en têm exatamente as mesmas chaves', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ptPT).sort());
  });

  it('nenhum texto está vazio', () => {
    for (const dict of [ptPT, en]) {
      for (const value of Object.values(dict)) expect(value.trim()).not.toBe('');
    }
  });

  it('muda de língua', () => {
    setLanguage('en');
    expect(t('menu.new_game')).toBe('New game');
  });

  it('isLanguage só aceita línguas suportadas', () => {
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('pt-PT')).toBe(true);
    expect(isLanguage('fr')).toBe(false);
    expect(isLanguage('')).toBe(false);
  });
});

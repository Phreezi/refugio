import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, parsePreferences } from '../../src/ui/preferences';

describe('Preferências (Fase 11)', () => {
  it('lê as preferências gravadas e ignora valores estranhos', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('não é json')).toEqual(DEFAULT_PREFERENCES);
    expect(
      parsePreferences(
        JSON.stringify({
          language: 'en',
          uiSize: 'large',
          damageNumbers: false,
          colorblind: 'sim',
          extra: 1,
        }),
      ),
    ).toEqual({ ...DEFAULT_PREFERENCES, language: 'en', uiSize: 'large', damageNumbers: false });
    expect(parsePreferences(JSON.stringify({ language: 'fr', uiSize: 'enorme' }))).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it('volume entre 0 e 1 (Fase 12)', () => {
    expect(parsePreferences(JSON.stringify({ volume: 0.25 })).volume).toBe(0.25);
    expect(parsePreferences(JSON.stringify({ volume: 0 })).volume).toBe(0);
    expect(parsePreferences(JSON.stringify({ volume: 3 })).volume).toBe(DEFAULT_PREFERENCES.volume);
    expect(parsePreferences(JSON.stringify({ volume: 'alto' })).volume).toBe(DEFAULT_PREFERENCES.volume);
  });
});

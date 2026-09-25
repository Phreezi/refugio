import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  normalizeCode,
  parseGuestMessage,
  randomCode,
} from '../../src/net/protocol';

describe('Código do co-op', () => {
  it('tem 5 caracteres do alfabeto sem símbolos que se confundem', () => {
    for (const ch of '01OIL') expect(CODE_ALPHABET).not.toContain(ch);
    for (let i = 0; i < 50; i++) {
      const code = randomCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(normalizeCode(code)).toBe(code);
    }
  });

  it('normaliza o que se escreve e recusa códigos inválidos', () => {
    expect(normalizeCode(' k7q2m ')).toBe('K7Q2M');
    expect(normalizeCode('K7Q-2M')).toBe('K7Q2M');
    expect(normalizeCode('K7Q2')).toBeNull();
    expect(normalizeCode('K7Q2O')).toBeNull(); // O não existe (confunde-se com 0)
    expect(normalizeCode('K7Q2ç')).toBeNull();
  });
});

describe('Mensagens do convidado', () => {
  it('aceita mensagens válidas', () => {
    expect(parseGuestMessage({ t: 'act' })).toEqual({ t: 'act' });
    expect(parseGuestMessage({ t: 'join', weapon: 'machete' })).toEqual({ t: 'join', weapon: 'machete' });
    expect(parseGuestMessage({ t: 'join' })).toEqual({ t: 'join', weapon: null });
    expect(parseGuestMessage({ t: 'me', x: 1, y: 2, facing: 'up', moved: 1, sneak: 0 })).toEqual({
      t: 'me',
      x: 1,
      y: 2,
      facing: 'up',
      moved: 1,
      sneak: 0,
    });
  });

  it('recusa lixo vindo da rede', () => {
    expect(parseGuestMessage(null)).toBeNull();
    expect(parseGuestMessage('act')).toBeNull();
    expect(parseGuestMessage({ t: 'me', x: Number.NaN, y: 2, facing: 'up' })).toBeNull();
    expect(parseGuestMessage({ t: 'me', x: 1, y: 2, facing: 'north' })).toBeNull();
    expect(parseGuestMessage({ t: 'give', item: 'pistol' })).toBeNull();
  });
});

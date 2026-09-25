import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  isGuestCommand,
  normalizeCode,
  parseGuestMessage,
  randomCode,
} from '../../src/net/protocol';

describe('Código do co-op', () => {
  it('tem 5 caracteres do alfabeto sem símbolos que se confundem', () => {
    for (const ch of 'OIL') expect(CODE_ALPHABET).not.toContain(ch);
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
    // O conta como 0 e I/L como 1 (confundem-se).
    expect(normalizeCode('K7Q2O')).toBe('K7Q20');
    expect(normalizeCode('k7q2l')).toBe('K7Q21');
    expect(normalizeCode('K7Q2ç')).toBeNull();
  });
});

describe('Mensagens do convidado', () => {
  it('aceita mensagens válidas', () => {
    expect(parseGuestMessage({ t: 'act', held: 1, tick: 5 })).toEqual({ t: 'act', held: 1, tick: 5 });
    expect(parseGuestMessage({ t: 'away', on: 1 })).toEqual({ t: 'away', on: 1 });
    expect(
      parseGuestMessage({ t: 'me', x: 1, y: 2, facing: 'up', moved: 1, sneak: 0, zone: 'zone_base' }),
    ).toEqual({ t: 'me', x: 1, y: 2, facing: 'up', moved: 1, sneak: 0, zone: 'zone_base', auto: 0 });
    expect(
      parseGuestMessage({ t: 'cmd', seq: 3, sys: 'crafting', m: 'craft', args: ['r_stone_axe', 'hands'] }),
    ).toEqual({ t: 'cmd', seq: 3, sys: 'crafting', m: 'craft', args: ['r_stone_axe', 'hands'] });
  });

  it('só aceita comandos da lista (nada de chamar outros métodos)', () => {
    expect(isGuestCommand('actions', 'move')).toBe(true);
    expect(isGuestCommand('building', 'place')).toBe(true);
    expect(isGuestCommand('actions', 'constructor')).toBe(false);
    expect(isGuestCommand('combat', 'damagePlayer')).toBe(false);
    expect(parseGuestMessage({ t: 'cmd', seq: 1, sys: 'progression', m: 'gain', args: [9999] })).toBeNull();
  });

  it('recusa lixo vindo da rede', () => {
    expect(parseGuestMessage(null)).toBeNull();
    expect(parseGuestMessage('act')).toBeNull();
    expect(parseGuestMessage({ t: 'me', x: Number.NaN, y: 2, facing: 'up', zone: 'z' })).toBeNull();
    expect(parseGuestMessage({ t: 'me', x: 1, y: 2, facing: 'north', zone: 'z' })).toBeNull();
    expect(parseGuestMessage({ t: 'join' })).toBeNull();
    expect(parseGuestMessage({ t: 'give', item: 'pistol' })).toBeNull();
  });
});

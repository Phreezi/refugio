import { describe, expect, it } from 'vitest';
import { createNewGameState } from '../../src/core/GameState';
import { migrate } from '../../src/save/migrations';
import { checksum, parseSave, SAVE_VERSION, SaveError, serializeSave } from '../../src/save/schema';

const STATE = createNewGameState({ x: 392, y: 392 });

function problemOf(text: string, migrations?: Parameters<typeof parseSave>[1]): string {
  try {
    parseSave(text, migrations);
  } catch (error) {
    if (error instanceof SaveError) return error.problem;
    throw error;
  }
  return 'ok';
}

describe('save: formato', () => {
  it('gravar → ler devolve um estado idêntico', () => {
    const state = structuredClone(STATE);
    state.player.x = 307.13;
    state.player.hunger = 42;
    state.world.tick = 12345;
    const parsed = parseSave(serializeSave(state, 1_700_000_000_000));
    expect(parsed.state).toEqual(state);
    expect(parsed.timestamp).toBe(1_700_000_000_000);
    expect(parsed.version).toBe(SAVE_VERSION);
  });

  it('é compacto (sem espaços) e bem abaixo dos 100 KB', () => {
    const text = serializeSave(STATE, 1);
    expect(text).not.toMatch(/\s/);
    expect(text.length).toBeLessThan(1000);
  });

  it('deteta corrupção: JSON partido, checksum errado, campos em falta', () => {
    const text = serializeSave(STATE, 1);
    expect(problemOf(text.slice(0, -5))).toBe('json');
    expect(problemOf(text.replace('"hp":100', '"hp":999'))).toBe('checksum');
    expect(problemOf('{"version":1}')).toBe('format');
  });

  it('recusa saves de versões futuras', () => {
    const future = serializeSave(STATE, 1).replace(`"version":${String(SAVE_VERSION)}`, '"version":99');
    // o checksum inclui a versão: recalcular para testar só a regra da versão
    const json = JSON.parse(future) as { state: unknown; timestamp: number };
    const sum = checksum(`99|${String(json.timestamp)}|${JSON.stringify(json.state)}`);
    expect(problemOf(future.replace(/"checksum":"\w+"/, `"checksum":"${sum}"`))).toBe('future_version');
  });

  it('valida o estado: tipos e valores', () => {
    const bad = structuredClone(STATE) as unknown as { player: { facing: string } };
    bad.player.facing = 'diagonal';
    expect(problemOf(serializeSave(bad as unknown as typeof STATE, 1))).toBe('state');
  });

  it('checksum é estável e deteta 1 carácter diferente', () => {
    expect(checksum('abc')).toBe(checksum('abc'));
    expect(checksum('abc')).not.toBe(checksum('abd'));
    expect(checksum('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('save: migrações', () => {
  it('aplica as migrações em cadeia, da versão do save até à atual', () => {
    const table = {
      1: (s: Record<string, unknown>) => ({ ...s, a: 1 }),
      2: (s: Record<string, unknown>) => ({ ...s, b: (s.a as number) + 1 }),
    };
    expect(migrate({ x: 0 }, 1, 3, table)).toEqual({ x: 0, a: 1, b: 2 });
    expect(migrate({ x: 0 }, 3, 3, table)).toEqual({ x: 0 });
  });

  it('falha com mensagem clara se faltar um passo', () => {
    expect(() => migrate({}, 1, 3, { 1: (s) => s })).toThrow(/2 → 3/);
  });

  it('v1 → v2 (Fase 3): um save antigo ganha inventário, hotbar, baús, zonas e rng', () => {
    const v1State = {
      player: { x: 10, y: 20, facing: 'up', zoneId: 'zone_base', hp: 70, hunger: 60, thirst: 50 },
      world: { tick: 999 },
    };
    const stateJson = JSON.stringify(v1State);
    const sum = checksum(`1|5|${stateJson}`);
    const text = `{"version":1,"timestamp":5,"checksum":"${sum}","state":${stateJson}}`;
    const parsed = parseSave(text);
    expect(parsed.version).toBe(1);
    expect(parsed.state.player).toMatchObject({ x: 10, y: 20, hp: 70 });
    expect(parsed.state.player.inventory).toHaveLength(20);
    expect(parsed.state.player.hotbar).toEqual([null, null, null, null]);
    expect(parsed.state.world).toEqual({ tick: 999, rng: 1 });
    expect(parsed.state.base).toEqual({ chests: {} });
    expect(parsed.state.zones).toEqual({});
  });

  it('valida os slots do inventário', () => {
    const bad = structuredClone(STATE);
    (bad.player.inventory as unknown[])[0] = ['wood', 0];
    expect(problemOf(serializeSave(bad, 1))).toBe('state');
  });

  it('um save antigo sem migração disponível é recusado como formato inválido', () => {
    const v0 = serializeSave(STATE, 1).replace(`"version":${String(SAVE_VERSION)}`, '"version":0');
    const json = JSON.parse(v0) as { state: unknown };
    const sum = checksum(`0|1|${JSON.stringify(json.state)}`);
    expect(problemOf(v0.replace(/"checksum":"\w+"/, `"checksum":"${sum}"`), {})).toBe('format');
  });
});

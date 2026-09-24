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
    expect(parsed.state.base).toEqual({
      chests: {},
      structures: [
        [1, 'campfire', 28, 24, 0, 0],
        [2, 'wood_bench', 20, 15, 0, 0],
      ],
      nextStructureId: 3,
      crops: {},
      produce: {},
      damage: {},
    });
    expect(parsed.state.zones).toEqual({});
    expect(parsed.state.stations).toEqual({});
  });

  it('v2 → v3 (Fase 4): acrescenta as estações', () => {
    const v2 = structuredClone(STATE) as unknown as Record<string, unknown>;
    delete v2.stations;
    const stateJson = JSON.stringify(v2);
    const text = `{"version":2,"timestamp":7,"checksum":"${checksum(`2|7|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.stations).toEqual({});
  });

  it('v3 → v4 (Fase 5): a fogueira e a bancada do mapa passam a peças, com as suas filas', () => {
    const v3 = structuredClone(STATE) as unknown as { base: Record<string, unknown>; stations: unknown };
    delete v3.base.structures;
    delete v3.base.nextStructureId;
    v3.stations = {
      campfire_90: { queue: [['r_cooked_meat', 40]], output: [null] },
      wood_bench_91: { queue: [], output: [['wood_plank', 2]] },
    };
    const stateJson = JSON.stringify(v3);
    const text = `{"version":3,"timestamp":8,"checksum":"${checksum(`3|8|${stateJson}`)}","state":${stateJson}}`;
    const { state } = parseSave(text);
    expect(state.base.structures).toEqual([
      [1, 'campfire', 28, 24, 0, 0],
      [2, 'wood_bench', 20, 15, 0, 0],
    ]);
    expect(state.base.nextStructureId).toBe(3);
    expect(state.stations).toEqual({
      campfire_s1: { queue: [['r_cooked_meat', 40]], output: [null] },
      wood_bench_s2: { queue: [], output: [['wood_plank', 2]] },
    });
  });

  it('v4 → v5 (Fase 6): equipamento vazio e mochilas no chão por zona', () => {
    const v4 = structuredClone(STATE) as unknown as {
      player: Record<string, unknown>;
      zones: Record<string, unknown>;
    };
    delete v4.player.equipment;
    v4.zones = { zone_base: { depleted: { '7': 90 } } };
    const stateJson = JSON.stringify(v4);
    const text = `{"version":4,"timestamp":9,"checksum":"${checksum(`4|9|${stateJson}`)}","state":${stateJson}}`;
    const { state } = parseSave(text);
    expect(state.player.equipment).toEqual([null, null, null, null, null, null]);
    expect(state.zones).toEqual({ zone_base: { depleted: { '7': 90 }, bags: [], loot: {} } });
  });

  it('v5 → v6 (Fase 7): contentores com loot por zona', () => {
    const v5 = structuredClone(STATE) as unknown as { zones: Record<string, unknown> };
    v5.zones = { zone_pine_forest: { depleted: {}, bags: [] } };
    const stateJson = JSON.stringify(v5);
    const text = `{"version":5,"timestamp":3,"checksum":"${checksum(`5|3|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.zones).toEqual({ zone_pine_forest: { depleted: {}, bags: [], loot: {} } });
  });

  it('v6 → v7 (Fase 8): nível e XP (quem já jogava começa no nível 3), receitas aprendidas', () => {
    const v6 = structuredClone(STATE) as unknown as { player: Record<string, unknown>; unlocks?: unknown };
    delete v6.player.level;
    delete v6.player.xp;
    delete v6.unlocks;
    const stateJson = JSON.stringify(v6);
    const text = `{"version":6,"timestamp":4,"checksum":"${checksum(`6|4|${stateJson}`)}","state":${stateJson}}`;
    const { state } = parseSave(text);
    expect(state.player).toMatchObject({ level: 3, xp: 0 });
    expect(state.unlocks).toEqual({ recipes: [] });
  });

  it('v7 → v8 (Fase 9): horta e produção vazias', () => {
    const v7 = structuredClone(STATE) as unknown as { base: Record<string, unknown> };
    delete v7.base.crops;
    delete v7.base.produce;
    const stateJson = JSON.stringify(v7);
    const text = `{"version":7,"timestamp":5,"checksum":"${checksum(`7|5|${stateJson}`)}","state":${stateJson}}`;
    const { state } = parseSave(text);
    expect(state.base.crops).toEqual({});
    expect(state.base.produce).toEqual({});
  });

  it('v8 → v9 (Fase 9): hordas desligadas e peças sem dano', () => {
    const v8 = structuredClone(STATE) as unknown as Record<string, unknown> & {
      base: Record<string, unknown>;
    };
    delete v8.base.damage;
    delete v8.settings;
    delete v8.horde;
    const stateJson = JSON.stringify(v8);
    const text = `{"version":8,"timestamp":6,"checksum":"${checksum(`8|6|${stateJson}`)}","state":${stateJson}}`;
    const { state } = parseSave(text);
    expect(state.base.damage).toEqual({});
    expect(state.settings).toEqual({ hordes: false });
    expect(state.horde).toEqual({ at: 0, count: 0, active: false });
  });

  it('valida a horta', () => {
    const ok = structuredClone(STATE);
    ok.base.crops['3'] = ['carrot_seeds', null];
    ok.base.crops['4'] = ['carrot_seeds', 1200];
    expect(parseSave(serializeSave(ok, 1)).state.base.crops['3']).toEqual(['carrot_seeds', null]);
    const bad = structuredClone(STATE);
    (bad.base.crops as Record<string, unknown>)['3'] = ['carrot_seeds', -1];
    expect(problemOf(serializeSave(bad, 1))).toBe('state');
  });

  it('valida as peças construídas', () => {
    const bad = structuredClone(STATE);
    bad.base.structures.push([1, 'wall_wood', 3, 4, 2, 0]);
    expect(problemOf(serializeSave(bad, 1))).toBe('state');
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

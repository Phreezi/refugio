import { describe, expect, it } from 'vitest';
import { createNewGameState } from '../../src/core/GameState';
import { migrate } from '../../src/save/migrations';
import {
  checksum,
  parseSave,
  SAVE_VERSION,
  SaveError,
  serializeSave,
  validateState,
} from '../../src/save/schema';

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
    expect(text.length).toBeLessThan(1100);
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
    expect(state.zones).toEqual({ zone_base: { depleted: { '7': 90 }, bags: [], loot: {}, ground: [] } });
  });

  it('v5 → v6 (Fase 7): contentores com loot por zona', () => {
    const v5 = structuredClone(STATE) as unknown as { zones: Record<string, unknown> };
    v5.zones = { zone_pine_forest: { depleted: {}, bags: [] } };
    const stateJson = JSON.stringify(v5);
    const text = `{"version":5,"timestamp":3,"checksum":"${checksum(`5|3|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.zones).toEqual({
      zone_pine_forest: { depleted: {}, bags: [], loot: {}, ground: [] },
    });
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

  it('v9 → v10 (Fase 10): ninguém está a sangrar', () => {
    const v9 = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    delete v9.player.bleed;
    const stateJson = JSON.stringify(v9);
    const text = `{"version":9,"timestamp":6,"checksum":"${checksum(`9|6|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.player.bleed).toBe(0);
  });

  it('v10 → v11 (Fase 10): bunker e chefes vazios', () => {
    const v10 = structuredClone(STATE) as unknown as Record<string, unknown>;
    delete v10.dungeons;
    delete v10.bosses;
    const stateJson = JSON.stringify(v10);
    const text = `{"version":10,"timestamp":6,"checksum":"${checksum(`10|6|${stateJson}`)}","state":${stateJson}}`;
    const { state } = parseSave(text);
    expect(state.dungeons).toEqual({});
    expect(state.bosses).toEqual({});
  });

  it('v11 → v12 (Fase 11): estatísticas a zero', () => {
    const v11 = structuredClone(STATE) as unknown as Record<string, unknown>;
    delete v11.stats;
    const stateJson = JSON.stringify(v11);
    const text = `{"version":11,"timestamp":6,"checksum":"${checksum(`11|6|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.stats).toEqual({
      kills: 0,
      deaths: 0,
      crafted: 0,
      gathered: 0,
      looted: 0,
      playTicks: 0,
    });
  });

  it('v12 → v13 (Fase 11): quem já jogava fica sem dicas do tutorial', () => {
    const v12 = structuredClone(STATE) as unknown as Record<string, unknown>;
    delete v12.tutorial;
    const stateJson = JSON.stringify(v12);
    const text = `{"version":12,"timestamp":6,"checksum":"${checksum(`12|6|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.tutorial).toEqual({ done: [], off: true });
  });

  it('v13 → v14 (Fase 12): quem já jogava é o rapaz; o aspeto valida-se', () => {
    const v13 = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    delete v13.player.look;
    const stateJson = JSON.stringify(v13);
    const text = `{"version":13,"timestamp":6,"checksum":"${checksum(`13|6|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.player.look).toBe('boy');
    const bad = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    bad.player.look = 'dragon';
    expect(() => validateState(bad)).toThrow();
  });

  it('v21 → v22: missões vazias; validam-se', () => {
    const v21 = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    delete v21.player.quests;
    const stateJson = JSON.stringify(v21);
    const text = `{"version":21,"timestamp":9,"checksum":"${checksum(`21|9|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.player.quests).toEqual({ active: {}, done: [] });
    const bad = structuredClone(STATE) as unknown as { player: { quests: unknown } };
    bad.player.quests = { active: { q: [-1] }, done: [] };
    expect(() => validateState(bad)).toThrow();
  });

  it('v20 → v21: moedas dos slots e dos baús passam para o contador; buffs e postes vazios', () => {
    const v20 = structuredClone(STATE) as unknown as {
      player: Record<string, unknown> & { inventory: unknown[]; hotbar: unknown[] };
      base: { chests: Record<string, unknown[]> };
      waystones?: unknown;
    };
    delete v20.player.coins;
    delete v20.player.buffs;
    delete v20.waystones;
    v20.player.inventory[3] = ['coin', 40];
    v20.player.hotbar[2] = ['coin', 2];
    const chest = Object.values(v20.base.chests)[0];
    if (chest) chest[5] = ['coin', 100];
    const stateJson = JSON.stringify(v20);
    const text = `{"version":20,"timestamp":9,"checksum":"${checksum(`20|9|${stateJson}`)}","state":${stateJson}}`;
    const state = parseSave(text).state;
    expect(state.player.coins).toBe(142);
    expect(state.player.inventory[3]).toBeNull();
    expect(state.player.hotbar[2]).toBeNull();
    expect(state.player.buffs).toEqual([]);
    expect(state.waystones).toEqual([]);
    const bad = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    bad.player.buffs = [['flying', 5, 10]];
    expect(() => validateState(bad)).toThrow();
  });

  it('v19 → v20: pilhas no chão com corpo (id do inimigo) validam-se', () => {
    const v19 = structuredClone(STATE);
    const stateJson = JSON.stringify(v19);
    const text = `{"version":19,"timestamp":9,"checksum":"${checksum(`19|9|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.player.level).toBe(STATE.player.level);
    const ok = structuredClone(STATE) as unknown as { zones: Record<string, { bags: unknown[] }> };
    const zone = Object.values(ok.zones)[0];
    if (zone) {
      zone.bags = [{ x: 1, y: 2, items: [['coin', 3]], expiresAt: 5, death: false, corpse: 'wolf' }];
      expect(() => validateState(ok)).not.toThrow();
      zone.bags = [{ x: 1, y: 2, items: [], expiresAt: 5, death: false, corpse: 3 }];
      expect(() => validateState(ok)).toThrow();
    }
  });

  it('v18 → v19: slots com encantamento (4.º valor) validam-se', () => {
    const v18 = structuredClone(STATE);
    const stateJson = JSON.stringify(v18);
    const text = `{"version":18,"timestamp":9,"checksum":"${checksum(`18|9|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.player.level).toBe(STATE.player.level);
    const ok = structuredClone(STATE) as unknown as { player: { equipment: unknown[] } };
    ok.player.equipment[0] = ['machete', 1, 90, 2];
    expect(() => validateState(ok)).not.toThrow();
    ok.player.equipment[0] = ['machete', 1, 90, 0];
    expect(() => validateState(ok)).toThrow();
  });

  it('v17 → v18: talentos vazios; validam-se', () => {
    const v17 = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    delete v17.player.talents;
    const stateJson = JSON.stringify(v17);
    const text = `{"version":17,"timestamp":9,"checksum":"${checksum(`17|9|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.player.talents).toEqual({});
    const bad = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    bad.player.talents = { strong_arm: 0 };
    expect(() => validateState(bad)).toThrow();
  });

  it('v16 → v17: nome da personagem; valida-se', () => {
    const v16 = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    delete v16.player.name;
    const stateJson = JSON.stringify(v16);
    const text = `{"version":16,"timestamp":9,"checksum":"${checksum(`16|9|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.player.name).toBe('Sobrevivente');
    const bad = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    bad.player.name = '   ';
    expect(() => validateState(bad)).toThrow();
  });

  it('v15 → v16: aljava vazia; valida-se', () => {
    const v15 = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    delete v15.player.quiver;
    const stateJson = JSON.stringify(v15);
    const text = `{"version":15,"timestamp":8,"checksum":"${checksum(`15|8|${stateJson}`)}","state":${stateJson}}`;
    expect(parseSave(text).state.player.quiver).toEqual([]);
    const bad = structuredClone(STATE) as unknown as { player: Record<string, unknown> };
    bad.player.quiver = [['arrow', 0]];
    expect(() => validateState(bad)).toThrow();
  });

  it('v14 → v15: perícias a zero e chão vazio nas zonas; validam-se', () => {
    const v14 = structuredClone(STATE) as unknown as {
      player: Record<string, unknown>;
      zones: Record<string, unknown>;
    };
    delete v14.player.skills;
    v14.zones = { zone_lake: { depleted: {}, bags: [], loot: {} } };
    const stateJson = JSON.stringify(v14);
    const text = `{"version":14,"timestamp":7,"checksum":"${checksum(`14|7|${stateJson}`)}","state":${stateJson}}`;
    const { state } = parseSave(text);
    expect(state.player.skills).toEqual({});
    expect(state.zones.zone_lake?.ground).toEqual([]);
    const ok = structuredClone(STATE);
    ok.player.skills = { archery: 12 };
    ok.zones.zone_lake = { depleted: {}, bags: [], loot: {}, ground: [[10, 20, 'arrow', 3]] };
    expect(() => validateState(ok)).not.toThrow();
    const bad = structuredClone(ok) as unknown as { player: { skills: Record<string, number> } };
    bad.player.skills.magic = 3;
    expect(() => validateState(bad)).toThrow();
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

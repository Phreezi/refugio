import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { BASE_ZONE_ID, GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { TALENTS } from '../../src/data/talents';
import { content } from '../../src/world/content';
import { buildZoneContext } from '../../src/world/zoneContext';
import { checksum, parseSave, serializeSave } from '../../src/save/schema';
import { installGameContent } from '../helpers/gameContent';

/**
 * Teste de resistência da lógica (sem Phaser): um "bot" anda ao acaso, ataca e recolhe em
 * muitas zonas (selvagens, subúrbios, aldeias, Caminhos, cavernas), passa as bordas do mundo
 * contínuo e usa as saídas como a cena faria. Nada pode lançar exceções nem deixar o jogador
 * num sítio impossível (fora das zonas, NaN, zona desconhecida).
 */

beforeAll(() => {
  installGameContent();
});

function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function setup(start: string, seed: number) {
  const state = new GameState();
  state.newGame(content.zoneMap(BASE_ZONE_ID).playerSpawn, seed);
  const player = state.data.player;
  player.level = 60;
  player.coins = 9999;
  player.inventory[0] = ['machete', 1, 400];
  player.inventory[1] = ['canned_food', 10];
  player.inventory[2] = ['water_clean', 10];
  const bus = new EventBus<GameEvents>();
  const sim = new Simulation(state, bus);
  sim.setRespawnPoint(content.zoneMap(BASE_ZONE_ID).playerSpawn);
  const log: string[] = [];
  const enter = (zoneId: string, seamless = false) => {
    sim.setZone(buildZoneContext(zoneId), seamless);
    if (!seamless) sim.reset();
  };
  // O que a ZoneScene faz com os eventos de mudança de zona.
  bus.on('zone:cross', ({ to, x, y }) => {
    log.push(`cross:${to}`);
    sim.crossTo(to, content.zoneMap(to), x, y);
    enter(to, true);
  });
  bus.on('zone:change', ({ to }) => {
    log.push(`exit:${String(to)}`);
    const dest = to ?? BASE_ZONE_ID;
    if (to) sim.enterZone(dest, content.zoneMap(dest));
    else sim.teleport(BASE_ZONE_ID, content.zoneMap(BASE_ZONE_ID));
    enter(dest);
  });
  bus.on('home:recall', () => {
    sim.teleport(BASE_ZONE_ID, content.zoneMap(BASE_ZONE_ID));
    enter(BASE_ZONE_ID);
  });
  bus.on('player:died', () => {
    log.push('died');
    enter(BASE_ZONE_ID);
  });
  sim.enterZone(start, content.zoneMap(start));
  enter(start);
  return { state, sim, bus, log };
}

/**
 * Corre `ticks` ticks com input ao acaso; verifica o estado do jogador a cada tick e, de vez em
 * quando, que o estado se grava e volta a carregar (um estado que não passa na validação ao
 * carregar seria progresso perdido: o jogo voltava à cópia anterior).
 */
function wander(sim: Simulation, state: GameState, ticks: number, rnd: () => number): void {
  const player = state.data.player;
  for (let i = 0; i < ticks; i++) {
    if (i % 250 === 0) {
      const saved = serializeSave(state.data, 1);
      expect(() => parseSave(saved), `save em ${player.zoneId} (tick ${String(i)})`).not.toThrow();
    }
    if (i % 30 === 0) {
      const a = rnd() * Math.PI * 2;
      sim.setMoveIntent(
        rnd() < 0.15 ? { x: 0, y: 0 } : { x: Math.cos(a), y: Math.sin(a) },
        rnd() < 0.1,
        rnd() < 0.3,
      );
      sim.setActionHeld(rnd() < 0.4);
      sim.autoAttack = rnd() < 0.5;
    }
    sim.update(FIXED_STEP_MS);
    const map = content.zoneMap(player.zoneId);
    const where = `${player.zoneId} tick ${String(i)} (${String(player.x)}, ${String(player.y)})`;
    expect(Number.isFinite(player.x) && Number.isFinite(player.y), where).toBe(true);
    expect(content.zones[player.zoneId], where).toBeDefined();
    // Entre ticks, o jogador fica dentro do mapa da sua zona (a borda passa-o para a vizinha).
    const size = map.tileSize;
    expect(player.x >= -size && player.y >= -size, where).toBe(true);
    expect(player.x <= (map.width + 1) * size && player.y <= (map.height + 1) * size, where).toBe(true);
    // Mantém-no vivo e alimentado (morrer também se testa à parte).
    if (rnd() < 0.002) player.hp = 0;
    player.hunger = Math.max(player.hunger, 60);
    player.thirst = Math.max(player.thirst, 60);
  }
}

describe('Resistência da simulação', { timeout: 120_000 }, () => {
  it('zonas selvagens (normais, subúrbios e aldeias): muitos ticks sem exceções', () => {
    const rnd = lcg(11);
    const wild = Object.keys(content.zones).filter((id) => content.isWild(id));
    const urban = wild.filter((id) => content.wild(id)?.biome === 'urban');
    const villages = wild.filter((id) => content.wild(id)?.village);
    expect(urban.length).toBeGreaterThan(0);
    expect(villages.length).toBeGreaterThan(0);
    const pick = (list: string[]) => list[Math.floor(rnd() * list.length)] ?? BASE_ZONE_ID;
    const starts = [
      ...urban.slice(0, 4),
      ...villages.slice(0, 4),
      pick(wild),
      pick(wild),
      pick(wild),
      pick(wild),
    ];
    let crossed = 0;
    for (const [k, start] of starts.entries()) {
      const { sim, state, log } = setup(start, 100 + k);
      wander(sim, state, 1500, rnd);
      crossed += log.filter((e) => e.startsWith('cross:')).length;
    }
    expect(crossed).toBeGreaterThan(0);
  });

  it('zonas à mão (Caminhos, cavernas, masmorras, eventos) sem exceções', () => {
    const rnd = lcg(23);
    const hand = Object.keys(content.zones).filter((id) => !content.isWild(id));
    for (const [k, start] of hand.entries()) {
      const { sim, state } = setup(start, 300 + k);
      wander(sim, state, 400, rnd);
    }
  });

  it('a mesma seed e o mesmo input dão o mesmo resultado (determinismo)', () => {
    const run = () => {
      const { sim, state, log } = setup('zone_route_3', 5);
      wander(sim, state, 1200, lcg(99));
      const p = state.data.player;
      return { log, x: p.x, y: p.y, zone: p.zoneId, inv: JSON.stringify(p.inventory) };
    };
    expect(run()).toEqual(run());
  });

  it('saves antigos (v1) de várias zonas migram até à versão atual e o jogo corre', () => {
    for (const [k, zoneId] of ['zone_base', 'zone_pine_forest', 'zone_lake', 'zone_farm'].entries()) {
      const v1 = {
        player: { x: 300, y: 300, facing: 'left', zoneId, hp: 40, hunger: 20, thirst: 10 },
        world: { tick: 54321 },
      };
      const json = JSON.stringify(v1);
      const text = `{"version":1,"timestamp":7,"checksum":"${checksum(`1|7|${json}`)}","state":${json}}`;
      const state = new GameState();
      state.load(parseSave(text).state);
      const bus = new EventBus<GameEvents>();
      const sim = new Simulation(state, bus);
      sim.setRespawnPoint(content.zoneMap(BASE_ZONE_ID).playerSpawn);
      bus.on('zone:cross', ({ to, x, y }) => {
        sim.crossTo(to, content.zoneMap(to), x, y);
        sim.setZone(buildZoneContext(to), true);
      });
      bus.on('zone:change', ({ to }) => {
        const dest = to ?? BASE_ZONE_ID;
        sim.enterZone(dest, content.zoneMap(dest));
        sim.setZone(buildZoneContext(dest));
      });
      bus.on('player:died', () => {
        sim.setZone(buildZoneContext(BASE_ZONE_ID));
      });
      sim.setZone(buildZoneContext(zoneId));
      sim.reset();
      wander(sim, state, 800, lcg(40 + k));
    }
  });

  it('hordas na base durante vários dias, com paredes e armadilhas, sem exceções', () => {
    const { sim, state, bus, log } = setup(BASE_ZONE_ID, 77);
    let hordes = 0;
    bus.on('horde:started', () => hordes++);
    const data = state.data;
    data.settings.hordes = true;
    data.player.inventory[3] = ['stone', 50];
    data.player.inventory[4] = ['wood', 50];
    data.player.inventory[5] = ['fiber', 50];
    const spawn = content.zoneMap(BASE_ZONE_ID).playerSpawn;
    const tx = Math.floor(spawn.x / 16);
    const ty = Math.floor(spawn.y / 16);
    for (let i = -3; i <= 3; i++) {
      sim.building.place('wall_wood', tx + i, ty - 4, 0);
      sim.building.place('spike_trap', tx + i, ty + 4, 0);
    }
    const rnd = lcg(5);
    sim.update(FIXED_STEP_MS);
    for (let day = 0; day < 4; day++) {
      // Salta para perto da próxima horda e luta (ou foge) durante algum tempo.
      if (data.horde.at > data.world.tick) data.world.tick = data.horde.at - 5;
      wander(sim, state, 2500, rnd);
    }
    expect(hordes).toBeGreaterThan(1);
    expect(log).toContain('died');
  });

  it('ações ao acaso na mochila, fabrico, construção, missões e talentos: o save continua válido', () => {
    const { sim, state } = setup(BASE_ZONE_ID, 31);
    const rnd = lcg(77);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)] as T;
    const items = Object.keys(content.items);
    const recipes = content.recipes.map((r) => r.id);
    const structures = Object.keys(content.structures);
    const quests = content.quests.map((q) => q.id);
    const containers = ['inventory', 'hotbar', 'equipment'] as const;
    const slot = () => ({ container: pick(containers), index: Math.floor(rnd() * 24) });
    const player = state.data.player;
    const spawn = content.zoneMap(BASE_ZONE_ID).playerSpawn;
    for (let round = 0; round < 3000; round++) {
      const r = Math.floor(rnd() * 16);
      if (r === 0) sim.actions.give(pick(items), 1 + Math.floor(rnd() * 30));
      else if (r === 1) sim.actions.use(slot());
      else if (r === 2) sim.actions.move(slot(), slot());
      else if (r === 3) sim.actions.equip(slot());
      else if (r === 4) sim.actions.unequip(Math.floor(rnd() * 7));
      else if (r === 5) sim.actions.drop(slot());
      else if (r === 6) sim.actions.split(slot());
      else if (r === 7) sim.actions.sort(pick(containers));
      else if (r === 8) sim.actions.enchant(slot());
      else if (r === 9) sim.crafting.craft(pick(recipes), null);
      else if (r === 10) {
        const tx = Math.floor(spawn.x / 16) + Math.floor(rnd() * 12) - 6;
        const ty = Math.floor(spawn.y / 16) + Math.floor(rnd() * 12) - 6;
        if (rnd() < 0.7) sim.building.place(pick(structures), tx, ty, Math.floor(rnd() * 2));
        else sim.building.demolish(tx, ty);
      } else if (r === 11) sim.quests.accept(pick(quests));
      else if (r === 12) sim.quests.turnIn(pick(quests));
      else if (r === 13) sim.progression.learnTalent(pick(Object.keys(TALENTS)));
      else if (r === 14) sim.actions.destroy(slot());
      else player.coins += 50;
      if (round % 10 === 0) wander(sim, state, 20, rnd);
      for (const s of [...player.inventory, ...player.hotbar, ...player.equipment]) {
        if (!s) continue;
        expect(content.items[s[0]], s[0]).toBeDefined();
        expect(s[1], s[0]).toBeGreaterThan(0);
      }
    }
    const saved = serializeSave(state.data, 1);
    expect(() => parseSave(saved)).not.toThrow();
  });

  it('fora do mapa ao entrar numa zona (save antigo): passa para o ponto de chegada e não fica preso', () => {
    const { sim, state } = setup(BASE_ZONE_ID, 3);
    const player = state.data.player;
    for (const [zoneId, x, y] of [
      ['zone_route_1', -300, -300],
      [BASE_ZONE_ID, 5000, 5000],
      ['zone_pine_forest', 99999, 300],
    ] as const) {
      Object.assign(player, { zoneId, x, y });
      sim.setZone(buildZoneContext(zoneId));
      sim.reset();
      expect(player).toMatchObject(content.zoneMap(zoneId).playerSpawn);
      const start = { x: player.x, y: player.y };
      let moved = false;
      for (const intent of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        sim.setMoveIntent(intent);
        for (let i = 0; i < 10; i++) sim.update(FIXED_STEP_MS);
        moved ||= player.x !== start.x || player.y !== start.y;
      }
      expect(moved, zoneId).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, PLAYER_FOOTPRINT } from '../../src/config';
import { secondsToTicks } from '../../src/core/Clock';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { BASE_ZONE_ID, GameState } from '../../src/core/GameState';
import { hordeScale, nextHordeTick } from '../../src/core/Horde';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import { countItem } from '../../src/systems/inventory/inventory';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import type { ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = loadContent();
const SIZE = 16;
const N = 30;

/** Mapa aberto 30×30 com duas saídas (de onde vem a horda) a oeste e a leste. */
const MAP: ZoneMap = {
  width: N,
  height: N,
  tileSize: SIZE,
  solid: new Array<boolean>(N * N).fill(false),
  floor: new Array<boolean>(N * N).fill(false),
  playerSpawn: { x: 15 * SIZE + 8, y: 15 * SIZE + 12 },
  exits: [
    { x: 1 * SIZE + 8, y: 15 * SIZE + 8, to: null },
    { x: 28 * SIZE + 8, y: 15 * SIZE + 8, to: null },
  ],
  resources: [],
  props: [],
  chests: [],
  stations: [],
  containers: [],
  enemySpawns: [],
};

const feetAt = (tx: number, ty: number) => ({ x: tx * SIZE + 8, y: ty * SIZE + 12 });

function setup(hordes = true) {
  const state = new GameState();
  state.newGame(feetAt(15, 15), 3);
  state.data.player.level = 10;
  state.data.settings.hordes = hordes;
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('horde:started', ({ size }) => events.push(`started:${String(size)}`));
  bus.on('horde:ended', ({ won }) => events.push(won ? 'won' : 'lost'));
  bus.on('structure:destroyed', () => events.push('destroyed'));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
    () => content,
  );
  const enter = (zoneId = BASE_ZONE_ID) => {
    sim.setZone({
      zoneId,
      map: MAP,
      collision: CollisionWorld.fromZone(MAP, content.resources, content.props),
      ...content,
    });
    sim.reset();
  };
  enter();
  sim.setRespawnPoint(MAP.playerSpawn);
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < secondsToTicks(seconds); i++) {
      each?.();
      sim.update(FIXED_STEP_MS);
    }
  };
  /** Salta o relógio para a hora da horda. */
  const skipToHorde = () => {
    run(0.1); // marca a próxima horda
    state.data.world.tick = state.data.horde.at;
    run(0.1);
  };
  const give = (items: [string, number][]) => {
    const bag = state.data.player.inventory;
    bag.fill(null);
    items.forEach(([id, qty], i) => {
      bag[i] = [id, qty];
    });
  };
  /** Casa de pedra fechada 3×3 (por dentro) à volta do tile (15, 15). */
  const stoneHouse = () => {
    give([['stone', 200]]);
    for (let x = 13; x <= 17; x++) {
      for (const y of [13, 17]) expect(sim.building.place('wall_stone', x, y, 0)).toBeNull();
    }
    for (let y = 14; y <= 16; y++) {
      for (const x of [13, 17]) expect(sim.building.place('wall_stone', x, y, 0)).toBeNull();
    }
  };
  return { state, sim, events, enter, run, skipToHorde, give, stoneHouse };
}

describe('Hordas', () => {
  it('desligadas por defeito: nada acontece', () => {
    const { state, events, run } = setup(false);
    state.data.world.tick = nextHordeTick(0) + 10;
    run(1);
    expect(events).toEqual([]);
    expect(state.data.horde.at).toBe(0);
  });

  it('ligadas: marca a próxima (às 22 h, daqui a 3 dias) e chega com o jogador na base', () => {
    const { state, sim, events, run, skipToHorde } = setup();
    run(0.1);
    const dayTicks = secondsToTicks(BALANCE.dayLengthSec);
    expect(state.data.horde.at).toBe(nextHordeTick(0));
    expect(Math.floor(state.data.horde.at / dayTicks)).toBe(BALANCE.hordeEveryDays);
    skipToHorde();
    expect(events).toEqual(['started:8']);
    expect(state.data.horde.active).toBe(true);
    expect(sim.combat.list.filter((e) => e.horde)).toHaveLength(8);
    expect(hordeScale(4)).toBe(2);
    expect(hordeScale(9)).toBe(2);
  });

  it('com o jogador fora da base, a horda espera por ele (e volta se o jogo recarregar)', () => {
    const { state, sim, events, enter, run } = setup();
    run(0.1);
    enter('zone_pine_forest');
    state.data.world.tick = state.data.horde.at + 100;
    run(0.5);
    expect(events).toEqual([]);
    enter(BASE_ZONE_ID);
    run(0.1);
    expect(events).toEqual(['started:8']);
    // Recarregar a meio: a horda aparece outra vez ao entrar na base.
    enter(BASE_ZONE_ID);
    expect(sim.combat.hordeLeft).toBe(8);
  });

  it('presos contra as paredes, partem-nas; a casa de pedra aguenta um bocado', () => {
    const { state, sim, stoneHouse, skipToHorde, run } = setup();
    stoneHouse();
    skipToHorde();
    run(20);
    const damage = Object.values(state.data.base.damage);
    expect(damage.length).toBeGreaterThan(0);
    // Ninguém entrou nem partiu uma parede em 20 s.
    expect(state.data.base.structures).toHaveLength(16);
    expect(state.data.player.hp).toBe(BALANCE.statMax);
    expect(sim.combat.hordeLeft).toBe(8);
  });

  it('uma parede de madeira acaba partida (sem reembolso) e o caminho abre-se', () => {
    const { state, sim, events, give, skipToHorde, run } = setup();
    give([['wood', 60]]);
    for (let x = 13; x <= 17; x++) for (const y of [13, 17]) sim.building.place('wall_wood', x, y, 0);
    for (let y = 14; y <= 16; y++) for (const x of [13, 17]) sim.building.place('wall_wood', x, y, 0);
    skipToHorde();
    run(60);
    expect(events).toContain('destroyed');
    expect(state.data.base.structures.length).toBeLessThan(16);
  });

  it('as armadilhas de estacas ferem quem as pisa e gastam-se', () => {
    const { state, sim, give, skipToHorde, run } = setup();
    give([
      ['wood', 20],
      ['nails', 20],
    ]);
    // No caminho da saída oeste até ao jogador.
    for (const x of [8, 9, 10]) expect(sim.building.place('spike_trap', x, 15, 0)).toBeNull();
    skipToHorde();
    run(15);
    const hits = Object.values(state.data.base.damage).reduce((a, b) => a + b, 0);
    expect(hits).toBeGreaterThan(0);
    expect(sim.combat.list.some((e) => e.horde && e.hp < (content.enemies[e.id]?.hp ?? 0))).toBe(true);
  });

  it('vencer: mochila com prémio, a seguinte fica marcada e é maior', () => {
    const { state, sim, events, skipToHorde, run } = setup();
    skipToHorde();
    for (const enemy of [...sim.combat.list]) enemy.hp = 1;
    // Mata-os um a um (como se o jogador lhes batesse).
    for (const enemy of [...sim.combat.list]) sim.combat.attack(enemy.uid);
    run(3); // os inchados (se houver) rebentam
    expect(sim.combat.hordeLeft).toBe(0);
    expect(events).toContain('won');
    const bags = state.data.zones[BASE_ZONE_ID]?.bags ?? [];
    expect(bags.some((bag) => bag.items.length > 0)).toBe(true);
    expect(state.data.horde).toMatchObject({ active: false, count: 1 });
    expect(state.data.horde.at).toBeGreaterThan(state.data.world.tick);
  });

  it('morrer durante a horda: vai-se embora sem prémio (não conta para crescer)', () => {
    const { state, sim, events, skipToHorde, run } = setup();
    skipToHorde();
    state.data.player.hp = 0;
    run(0.1);
    expect(events).toContain('lost');
    expect(sim.combat.hordeLeft).toBe(0);
    expect(state.data.horde).toMatchObject({ active: false, count: 0 });
  });

  it('aceitação da Fase 9: casa de pedra com 2 armadilhas aguenta 8 zombies (jogador sem jogar perfeito)', () => {
    const { state, sim, events, stoneHouse, give, skipToHorde, run } = setup();
    stoneHouse();
    give([
      ['wood', 8],
      ['nails', 8],
    ]);
    // Uma armadilha em cada caminho (as duas saídas ficam a oeste e a leste).
    expect(sim.building.place('spike_trap', 11, 15, 0)).toBeNull();
    expect(sim.building.place('spike_trap', 19, 15, 0)).toBeNull();
    const player = state.data.player;
    player.equipment[0] = ['machete', 1, 180];
    skipToHorde();
    // "Bot" pouco esperto: vira-se para o zombie mais perto e bate sem parar; nunca recua.
    const face = () => {
      let best: { x: number; y: number } | null = null;
      for (const e of sim.combat.list) {
        if (
          !best ||
          Math.hypot(e.x - player.x, e.y - player.y) < Math.hypot(best.x - player.x, best.y - player.y)
        )
          best = e;
      }
      if (!best) return;
      const dx = best.x - player.x;
      const dy = best.y - player.y;
      player.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    };
    sim.setActionHeld(true);
    let seconds = 0;
    while (sim.combat.hordeLeft > 0 && seconds < 240 && player.hp > 0) {
      run(1, face);
      seconds++;
    }
    expect(events).toContain('won');
    expect(events).not.toContain('lost');
    expect(player.hp).toBeGreaterThan(0);
    // A casa aguentou: a maior parte das paredes continua de pé.
    const walls = state.data.base.structures.filter((r) => r[1] === 'wall_stone');
    expect(walls.length).toBeGreaterThanOrEqual(14);
  });

  it('reparar uma peça danificada custa 25% dos materiais (com a ação contextual)', () => {
    const { state, sim, give } = setup();
    give([['stone', 3]]);
    expect(sim.building.place('wall_stone', 15, 14, 0)).toBeNull();
    sim.building.damageStructure(1, 50);
    expect(sim.building.damageOf(1)).toBe(50);
    Object.assign(state.data.player, feetAt(15, 15), { facing: 'up' });
    expect(sim.interaction.currentTarget(PLAYER_FOOTPRINT)?.data.type).toBe('repair');
    // Sem pedra: diz o que falta.
    sim.setActionHeld(true);
    sim.setActionHeld(false);
    sim.update(FIXED_STEP_MS);
    expect(sim.building.damageOf(1)).toBe(50);
    give([['stone', 2]]);
    expect(sim.building.repairCost('wall_stone')).toEqual([{ item: 'stone', qty: 1 }]);
    for (let i = 0; i < 10; i++) sim.update(FIXED_STEP_MS);
    sim.setActionHeld(true);
    sim.setActionHeld(false);
    sim.update(FIXED_STEP_MS);
    expect(sim.building.damageOf(1)).toBe(0);
    expect(countItem([state.data.player.inventory], 'stone')).toBe(1);
  });
});

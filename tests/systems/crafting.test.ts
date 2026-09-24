import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { GameState } from '../../src/core/GameState';
import { advanceRespawns, offlineTicks } from '../../src/core/offline';
import { Simulation } from '../../src/core/Simulation';
import { DataError, parseRecipes } from '../../src/data/types';
import {
  advanceStation,
  cancelJob,
  collectOutput,
  craftInstant,
  createStationState,
  enqueue,
  missingInputs,
  repairCost,
} from '../../src/systems/crafting/crafting';
import { createContainer } from '../../src/systems/inventory/inventory';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import type { ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = loadContent();
const recipe = (id: string) => {
  const r = content.recipes.find((x) => x.id === id);
  if (!r) throw new Error(`falta ${id}`);
  return r;
};

describe('crafting (lógica pura)', () => {
  it('nas mãos: consome os ingredientes e dá o resultado', () => {
    const bag = createContainer(4);
    bag[0] = ['wood', 5];
    bag[1] = ['stone', 3];
    expect(craftInstant([bag], recipe('r_stone_axe'), content.items)).toBe('ok');
    expect(bag).toEqual([['wood', 2], ['stone_axe', 1, 120], null, null]);
  });

  it('diz o que falta e não gasta nada', () => {
    const bag = createContainer(2);
    bag[0] = ['wood', 1];
    expect(missingInputs([bag], recipe('r_stone_axe'))).toEqual([
      { item: 'wood', have: 1, need: 3 },
      { item: 'stone', have: 0, need: 3 },
    ]);
    expect(craftInstant([bag], recipe('r_stone_axe'), content.items)).toBe('missing');
    expect(bag[0]).toEqual(['wood', 1]);
  });

  it('sem espaço para o resultado, desfaz tudo', () => {
    const bag = createContainer(2);
    bag[0] = ['fiber', 3];
    bag[1] = ['stone', 50];
    // A corda caberia no slot libertado pela fibra: ok.
    expect(craftInstant([bag], recipe('r_rope'), content.items)).toBe('ok');
    const full = createContainer(1);
    full[0] = ['wood', 6];
    // Machado: tira madeira (fica 3 no slot) e não há onde pôr o machado → desfaz.
    const withStone = createContainer(1);
    withStone[0] = ['stone', 3];
    expect(craftInstant([full, withStone], recipe('r_stone_axe'), content.items)).toBe('ok');
  });

  it('estação: fila (máx.), só o primeiro avança, resultado na saída, recolher', () => {
    const station = createStationState();
    const bag = createContainer(4);
    bag[0] = ['wood', 8];
    for (let i = 0; i < 3; i++) expect(enqueue(station, [bag], recipe('r_wood_plank'), 3, 100)).toBe('ok');
    expect(enqueue(station, [bag], recipe('r_wood_plank'), 3, 100)).toBe('queue_full');
    expect(bag[0]).toEqual(['wood', 2]);
    expect(advanceStation(station, 150, content.recipes, content.items)).toEqual(['r_wood_plank']);
    expect(station.queue.map((j) => j[1])).toEqual([50, 100]);
    expect(advanceStation(station, 1000, content.recipes, content.items)).toHaveLength(2);
    expect(station.output[0]).toEqual(['wood_plank', 6]);
    expect(collectOutput(station, [bag], content.items)).toBe(6);
    expect(bag[1]).toEqual(['wood_plank', 6]);
  });

  it('cancelar devolve os ingredientes', () => {
    const station = createStationState();
    const bag = createContainer(2);
    bag[0] = ['raw_meat', 1];
    enqueue(station, [bag], recipe('r_cooked_meat'), 3, 200);
    expect(bag[0]).toBeNull();
    expect(cancelJob(station, 0, content.recipes, [bag], content.items)).toBe(true);
    expect(bag[0]).toEqual(['raw_meat', 1]);
    expect(station.queue).toEqual([]);
  });

  it('reparar custa uma fração dos ingredientes, proporcional ao desgaste (mín. 1)', () => {
    expect(repairCost('stone_axe', 60, 120, content.recipes, 50)).toEqual([
      { item: 'wood', qty: 1 },
      { item: 'stone', qty: 1 },
    ]);
    expect(repairCost('stone_axe', 0, 120, content.recipes, 50)).toEqual([
      { item: 'wood', qty: 2 },
      { item: 'stone', qty: 2 },
    ]);
    expect(repairCost('stone_axe', 120, 120, content.recipes, 50)).toBeNull();
  });
});

describe('tempo offline (§7.6)', () => {
  it('limitado a 8 h e nunca negativo', () => {
    expect(offlineTicks(0, 60_000, 8, 50)).toBe(1200);
    expect(offlineTicks(0, 100 * 3_600_000, 8, 50)).toBe((8 * 3_600_000) / 50);
    expect(offlineTicks(1000, 0, 8, 50)).toBe(0);
  });

  it('aproxima o reaparecimento dos recursos', () => {
    const state = new GameState();
    const data = state.newGame({ x: 0, y: 0 });
    data.zones.zone_base = { depleted: { '5': 1000, '6': 50 }, bags: [] };
    advanceRespawns(data, 100);
    expect(data.zones.zone_base.depleted).toEqual({ '5': 900, '6': 0 });
  });
});

describe('parseRecipes', () => {
  it('reporta estação, itens, tempos e ids inválidos', () => {
    try {
      parseRecipes(
        [
          {
            id: 'r_a',
            station: 'forge',
            category: 'tools',
            inputs: [['wood', 1]],
            output: 'stone_axe',
            qty: 1,
            timeSec: 5,
            unlockLevel: 1,
          },
          {
            id: 'r_a',
            station: 'hands',
            category: 'toys',
            inputs: [['gold', 1]],
            output: 'x',
            qty: 1,
            timeSec: 5,
            unlockLevel: 1,
          },
        ],
        Object.keys(content.items),
        Object.keys(content.stations),
      );
      expect.unreachable();
    } catch (error) {
      expect((error as DataError).problems).toEqual([
        expect.stringContaining('forge'),
        expect.stringContaining('repetido'),
        expect.stringContaining('category'),
        expect.stringContaining('output'),
        expect.stringContaining('timeSec'),
        expect.stringContaining('gold'),
      ]);
    }
  });
});

describe('Fase 4 — aceitação: madeira → machado → cortar mais depressa → tábuas → carne cozinhada', () => {
  it('cadeia completa com a bancada e a fogueira', () => {
    const map: ZoneMap = {
      width: 12,
      height: 12,
      tileSize: 16,
      solid: new Array<boolean>(144).fill(false),
      floor: new Array<boolean>(144).fill(false),
      playerSpawn: { x: 96, y: 96 },
      exits: [],
      resources: [
        { id: 'tree_small', x: 96, y: 108, objectId: 1 },
        { id: 'rock', x: 112, y: 98, objectId: 2 },
      ],
      props: [],
      chests: [],
      stations: [
        { id: 'wood_bench', x: 78, y: 98, objectId: 3 },
        { id: 'campfire', x: 96, y: 84, objectId: 4 },
      ],
      containers: [],
      enemySpawns: [],
    };
    const state = new GameState();
    state.newGame({ x: 96, y: 96 }, 9);
    const bus = new EventBus<GameEvents>();
    const opened: string[] = [];
    bus.on('station:open', ({ stationKey }) => opened.push(stationKey));
    const sim = new Simulation(
      state,
      bus,
      () => content.items,
      () => content,
      () => content,
    );
    const collision = CollisionWorld.fromZone(map, content.resources, content.props, content.stations);
    sim.setZone({ zoneId: 'z', map, collision, ...content });
    sim.reset();
    const player = state.data.player;
    const act = (facing: typeof player.facing) => {
      player.facing = facing;
      sim.setActionHeld(true);
      sim.setActionHeld(false);
      for (let i = 0; i < 10; i++) sim.update(FIXED_STEP_MS);
    };
    // Madeira e pedra à mão (e mais madeira da mochila inicial, para chegar ao machado).
    player.inventory[0] = ['wood', 3];
    player.inventory[1] = ['stone', 1]; // a pedra dá 2–3: garante as 3 do machado
    for (let i = 0; i < 6; i++) act('right'); // pedra
    expect(sim.crafting.craft('r_stone_axe', null)).toBe('ok');
    // Com o machado, a árvore cai em 3 golpes (em vez de 6).
    for (let i = 0; i < 3; i++) act('down');
    expect(sim.interaction.isDepleted(1)).toBe(true);
    // Tábuas na bancada.
    act('left');
    const bench = opened.at(-1) ?? '';
    expect(bench).toBe('wood_bench_3');
    expect(sim.crafting.craft('r_wood_plank', bench)).toBe('ok');
    for (let i = 0; i < 5 * 20; i++) sim.update(FIXED_STEP_MS);
    expect(sim.crafting.collect(bench)).toBe(2);
    // Carne cozinhada na fogueira (carne crua do baú inicial).
    player.inventory[5] = ['raw_meat', 1];
    act('up');
    const fire = opened.at(-1) ?? '';
    expect(fire).toBe('campfire_4');
    expect(sim.crafting.craft('r_cooked_meat', fire)).toBe('ok');
    for (let i = 0; i < 10 * 20; i++) sim.update(FIXED_STEP_MS);
    sim.crafting.collect(fire);
    const has = (id: string) => [...player.inventory, ...player.hotbar].some((s) => s?.[0] === id);
    expect(has('stone_axe') && has('wood_plank') && has('cooked_meat')).toBe(true);
  });
});

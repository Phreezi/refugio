import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { BASE_ZONE_ID, GameState } from '../../src/core/GameState';
import { hoursToTicks, producedUnits } from '../../src/core/Homestead';
import { advanceRespawns } from '../../src/core/offline';
import { Simulation } from '../../src/core/Simulation';
import { countItem, fitsAll } from '../../src/systems/inventory/inventory';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import type { ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = loadContent();
const SIZE = 16;
const N = 12;

const MAP: ZoneMap = {
  width: N,
  height: N,
  tileSize: SIZE,
  solid: new Array<boolean>(N * N).fill(false),
  floor: new Array<boolean>(N * N).fill(false),
  playerSpawn: { x: 10 * SIZE + 8, y: 10 * SIZE + 8 },
  exits: [],
  resources: [],
  props: [],
  chests: [],
  stations: [],
  containers: [],
  enemySpawns: [],
};

function setup() {
  const state = new GameState();
  state.newGame({ x: 5 * SIZE + 8, y: 6 * SIZE + 12 }, 7);
  const player = state.data.player;
  player.level = 10;
  player.facing = 'up';
  player.hotbar.fill(null);
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('action:blocked', ({ reason }) => events.push(`blocked:${reason}`));
  bus.on('crop:harvested', ({ crop }) => events.push(`harvested:${crop}`));
  bus.on('produce:collected', () => events.push('collected'));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
  const collision = CollisionWorld.fromZone(MAP, content.resources, content.props);
  sim.setZone({ zoneId: BASE_ZONE_ID, map: MAP, collision, ...content });
  sim.reset();
  const give = (items: [string, number][]) => {
    player.inventory.fill(null);
    items.forEach(([id, qty], i) => {
      player.inventory[i] = [id, qty];
    });
  };
  /** Ação contextual no tile (5, 5), à frente do jogador. */
  const press = () => {
    sim.setActionHeld(true);
    sim.setActionHeld(false);
    for (let i = 0; i < 10; i++) sim.update(FIXED_STEP_MS);
  };
  const wait = (hours: number) => {
    state.data.world.tick += hoursToTicks(hours);
  };
  const have = (item: string) => countItem([player.inventory, player.hotbar], item);
  return { state, sim, events, give, press, wait, have };
}

describe('Horta', () => {
  it('plantar → regar (devolve a garrafa) → crescer → colher fruto e sementes (com XP)', () => {
    const { state, sim, events, give, press, wait, have } = setup();
    give([
      ['wood', 4],
      ['fiber', 2],
    ]);
    expect(sim.building.place('garden_bed', 5, 5, 0)).toBeNull();
    const uid = 1;
    expect(sim.homestead.stage(uid)).toBe('empty');

    press();
    expect(events).toContain('blocked:needs_seeds');
    give([['carrot_seeds', 3]]);
    press();
    expect(sim.homestead.stage(uid)).toBe('dry');
    expect(have('carrot_seeds')).toBe(2);
    expect(state.data.base.crops['1']).toEqual(['carrot_seeds', null]);

    // Por regar não cresce, por mais tempo que passe.
    wait(48);
    expect(sim.homestead.stage(uid)).toBe('dry');
    press();
    expect(events).toContain('blocked:needs_water');
    state.data.player.inventory[1] = ['water_dirty', 1];
    press();
    expect(sim.homestead.stage(uid)).toBe('growing');
    expect(have('water_dirty')).toBe(0);
    expect(have('empty_bottle')).toBe(1);
    const growHours = content.items.carrot_seeds?.plant?.growHours ?? 0;
    expect(sim.homestead.hoursLeft(uid)).toBe(growHours);

    press();
    expect(events).toContain('blocked:crop_growing');
    wait(growHours);
    expect(sim.homestead.stage(uid)).toBe('ready');
    const xp = state.data.player.xp;
    press();
    expect(events).toContain('harvested:carrot');
    expect(have('carrot')).toBeGreaterThanOrEqual(2);
    expect(have('carrot_seeds')).toBeGreaterThanOrEqual(3);
    expect(sim.homestead.stage(uid)).toBe('empty');
    expect(state.data.player.xp).toBeGreaterThan(xp);
  });

  it('um canteiro com planta não se demole (nada se perde)', () => {
    const { sim, give, press } = setup();
    give([
      ['wood', 4],
      ['fiber', 2],
    ]);
    sim.building.place('garden_bed', 5, 5, 0);
    give([['tomato_seeds', 1]]);
    press();
    expect(sim.building.demolish(5, 5)).toBe('plot_busy');
  });

  it('com a mochila cheia, não colhe', () => {
    const { state, sim, events, give, press, wait } = setup();
    give([
      ['wood', 4],
      ['fiber', 2],
    ]);
    sim.building.place('garden_bed', 5, 5, 0);
    state.data.base.crops['1'] = ['carrot_seeds', state.data.world.tick];
    wait(1);
    const inventory = state.data.player.inventory;
    inventory.fill(['stone', 50]);
    state.data.player.hotbar.fill(['stone', 50]);
    press();
    expect(events).toContain('blocked:inventory_full');
    expect(sim.homestead.stage(1)).toBe('ready');
  });
});

describe('Peças que produzem', () => {
  it('coletor de água: enche com o tempo (até ao máximo) e precisa de garrafas vazias', () => {
    const { state, sim, events, give, press, wait, have } = setup();
    give([
      ['wood_plank', 4],
      ['cloth', 3],
      ['rope', 1],
    ]);
    expect(sim.building.place('rain_collector', 5, 5, 0)).toBeNull();
    const produce = content.structures.rain_collector?.produce;
    if (!produce) throw new Error('sem produce');
    press();
    expect(events).toContain('blocked:nothing_yet');
    wait(produce.everyHours * 10);
    expect(sim.homestead.produced(1)).toBe(produce.max);
    press();
    expect(events).toContain('blocked:needs_item');
    give([['empty_bottle', 3]]);
    press();
    expect(events).toContain('collected');
    expect(have('water_clean')).toBe(3);
    expect(have('empty_bottle')).toBe(0);
    expect(sim.homestead.produced(1)).toBe(produce.max - 3);
    // Ao colher, o resto não se perde e volta a contar a partir daí.
    const since = state.data.base.produce['1'] ?? 0;
    expect(producedUnits(produce, since, state.data.world.tick)).toBe(produce.max - 3);
  });

  it('armadilha de caça dá carne; tempo offline também conta', () => {
    const { state, sim, give, press, have } = setup();
    give([
      ['wood', 2],
      ['rope', 2],
    ]);
    expect(sim.building.place('snare', 5, 5, 0)).toBeNull();
    const every = content.structures.snare?.produce?.everyHours ?? 0;
    advanceRespawns(state.data, hoursToTicks(every));
    expect(sim.homestead.produced(1)).toBe(1);
    press();
    expect(have('raw_meat')).toBeGreaterThanOrEqual(1);
    expect(sim.homestead.produced(1)).toBe(0);
  });

  it('offline: a horta cresce enquanto o jogo está fechado', () => {
    const { state } = setup();
    state.data.base.crops['9'] = ['carrot_seeds', hoursToTicks(5)];
    state.data.base.crops['8'] = ['carrot_seeds', null];
    advanceRespawns(state.data, hoursToTicks(8));
    expect(state.data.base.crops['9']).toEqual(['carrot_seeds', 0]);
    expect(state.data.base.crops['8']).toEqual(['carrot_seeds', null]);
  });
});

describe('fitsAll', () => {
  it('conta com o espaço partilhado entre itens diferentes', () => {
    const bag: ([string, number] | null)[] = [null, ['stone', 50]];
    expect(fitsAll([bag], [{ item: 'carrot', qty: 3 }], content.items)).toBe(true);
    expect(
      fitsAll(
        [bag],
        [
          { item: 'carrot', qty: 3 },
          { item: 'carrot_seeds', qty: 1 },
        ],
        content.items,
      ),
    ).toBe(false);
    expect(bag).toEqual([null, ['stone', 50]]);
  });
});

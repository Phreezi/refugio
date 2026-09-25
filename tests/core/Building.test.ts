import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, PLAYER_FOOTPRINT } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { BASE_ZONE_ID, GameState, type GameStateData } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { secondsToTicks } from '../../src/core/Clock';
import { BALANCE } from '../../src/data/balance';
import { parseSave, serializeSave } from '../../src/save/schema';
import { countItem } from '../../src/systems/inventory/inventory';
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

/** Pés do jogador no tile (tx, ty), perto da base do tile. */
const feetAt = (tx: number, ty: number) => ({ x: tx * SIZE + 8, y: ty * SIZE + 12 });

function setup(data?: GameStateData, map: ZoneMap = MAP) {
  const state = new GameState();
  if (data) state.load(data);
  else state.newGame(feetAt(9, 9), 7);
  state.data.player.level = 10; // peças desbloqueadas (os bloqueios têm teste próprio)
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('structure:placed', ({ uid }) => events.push(`placed:${String(uid)}`));
  bus.on('structure:removed', ({ uid }) => events.push(`removed:${String(uid)}`));
  bus.on('station:open', ({ stationKey }) => events.push(`station:${stationKey}`));
  bus.on('container:open', ({ container }) => events.push(container));
  bus.on('action:blocked', ({ reason }) => events.push(`blocked:${reason}`));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
  const collision = CollisionWorld.fromZone(map, content.resources, content.props);
  sim.setZone({ zoneId: BASE_ZONE_ID, map, collision, ...content });
  sim.reset();
  const give = (items: [string, number][]) => {
    const bag = state.data.player.inventory;
    bag.fill(null);
    items.forEach(([id, qty], i) => {
      bag[i] = [id, qty];
    });
  };
  const moveTo = (tx: number, ty: number, facing: 'up' | 'down' | 'left' | 'right') => {
    Object.assign(state.data.player, feetAt(tx, ty), { facing });
  };
  const press = () => {
    sim.setActionHeld(true);
    sim.setActionHeld(false);
    for (let i = 0; i < 10; i++) sim.update(FIXED_STEP_MS);
  };
  const tileBlocked = (tx: number, ty: number) =>
    collision.blocks({ x: tx * SIZE + 3, y: ty * SIZE + 5, w: 10, h: 6 });
  return { state, sim, bus, events, collision, give, moveTo, press, tileBlocked };
}

describe('Building (construção da base)', () => {
  it('colocar gasta os materiais, bloqueia o tile e fica no save', () => {
    const { state, sim, events, give, tileBlocked } = setup();
    give([['wood', 5]]);
    expect(sim.building.place('wall_wood', 2, 2, 0)).toBeNull();
    expect(countItem([state.data.player.inventory], 'wood')).toBe(3);
    expect(tileBlocked(2, 2)).toBe(true);
    expect(state.data.base.structures).toEqual([[1, 'wall_wood', 2, 2, 0, 0]]);
    expect(state.data.base.nextStructureId).toBe(2);
    expect(events).toEqual(['placed:1']);
  });

  it('vedações em fila vertical viram-se sozinhas (e a vizinha também)', () => {
    const { state, sim, give } = setup();
    give([['wood', 10]]);
    expect(sim.building.place('fence_wood', 2, 2, 0)).toBeNull();
    expect(sim.building.place('fence_wood', 2, 3, 0)).toBeNull();
    expect(sim.building.place('fence_wood', 2, 4, 0)).toBeNull();
    expect(state.data.base.structures.map((r) => r[4])).toEqual([1, 1, 1]);
    // Uma ao lado da de baixo: essa passa a ligar na horizontal.
    expect(sim.building.place('fence_wood', 3, 4, 0)).toBeNull();
    expect(state.data.base.structures.map((r) => r[4])).toEqual([1, 1, 0, 0]);
  });

  it('sem materiais não coloca nada', () => {
    const { state, sim, give } = setup();
    give([['wood', 1]]);
    expect(sim.building.check('wall_wood', 2, 2)).toBe('no_materials');
    expect(sim.building.place('wall_wood', 2, 2, 0)).toBe('no_materials');
    expect(state.data.base.structures).toEqual([]);
    expect(countItem([state.data.player.inventory], 'wood')).toBe(1);
  });

  it('desfazer nos primeiros segundos devolve tudo; depois, demolir devolve metade', () => {
    const { state, sim, give, tileBlocked, events } = setup();
    give([['stone', 12]]);
    sim.building.place('wall_stone', 2, 2, 0);
    sim.building.place('wall_stone', 3, 2, 0);
    expect(countItem([state.data.player.inventory], 'stone')).toBe(6);
    expect(sim.building.undoable()?.[0]).toBe(2);
    expect(sim.building.undo()).toBeNull();
    expect(countItem([state.data.player.inventory], 'stone')).toBe(9);
    expect(tileBlocked(3, 2)).toBe(false);

    // Passa a janela do Desfazer (tempo de jogo).
    for (let i = 0; i < (BALANCE.undoWindowSec * 1000) / FIXED_STEP_MS + 5; i++) sim.update(FIXED_STEP_MS);
    expect(sim.building.undoable()).toBeNull();
    expect(sim.building.demolish(2, 2)).toBeNull();
    expect(countItem([state.data.player.inventory], 'stone')).toBe(10); // 50% de 3 → 1
    expect(state.data.base.structures).toEqual([]);
    expect(events).toEqual(['placed:1', 'placed:2', 'removed:2', 'removed:1']);
  });

  it('onde um recurso foi apanhado pode-se construir; só reaparece quando o sítio ficar livre', () => {
    const map = { ...MAP, resources: [{ id: 'tall_grass', x: 3 * SIZE + 8, y: 3 * SIZE + 12, objectId: 5 }] };
    const { state, sim, give } = setup(undefined, map);
    give([['wood', 5]]);
    expect(sim.building.check('foundation_wood', 3, 3)).toBe('blocked');
    const depleted = state.data.zones[BASE_ZONE_ID]?.depleted ?? {};
    state.data.zones[BASE_ZONE_ID] = {
      depleted: { ...depleted, '5': state.data.world.tick + 20 },
      bags: [],
      loot: {},
      ground: [],
    };
    expect(sim.building.place('foundation_wood', 3, 3, 0)).toBeNull();
    for (let i = 0; i < 60; i++) sim.update(FIXED_STEP_MS);
    expect(sim.interaction.isDepleted(5)).toBe(true); // a fundação está por cima
    for (let i = 0; i < (BALANCE.undoWindowSec * 1000) / FIXED_STEP_MS; i++) sim.update(FIXED_STEP_MS);
    expect(sim.building.demolish(3, 3)).toBeNull();
    for (let i = 0; i < 30; i++) sim.update(FIXED_STEP_MS);
    expect(sim.interaction.isDepleted(5)).toBe(false);
  });

  it('não demole se o reembolso não couber na mochila', () => {
    const { state, sim, give } = setup();
    give([['wood', 2]]);
    sim.building.place('wall_wood', 2, 2, 0);
    // Enche a mochila e a hotbar com outra coisa.
    state.data.player.inventory.fill(['stone', 50]);
    state.data.player.hotbar.fill(['stone', 50]);
    expect(sim.building.demolish(2, 2)).toBe('inventory_full');
    expect(state.data.base.structures).toHaveLength(1);
  });

  it('estações precisam de fundação; abrem-se com a ação e têm fila própria', () => {
    const { state, sim, events, give, moveTo, press } = setup();
    give([
      ['wood', 20],
      ['stone', 10],
      ['raw_meat', 1],
    ]);
    expect(sim.building.place('campfire', 4, 4, 0)).toBe('needs_foundation');
    expect(sim.building.place('foundation_wood', 4, 4, 0)).toBeNull();
    expect(sim.building.place('campfire', 4, 4, 0)).toBeNull();
    moveTo(4, 5, 'up');
    expect(sim.interaction.currentTarget(PLAYER_FOOTPRINT)?.data.type).toBe('station');
    press();
    expect(events).toContain('station:campfire_s2');
    expect(sim.crafting.craft('r_cooked_meat', 'campfire_s2')).toBe('ok');
    expect(state.data.stations.campfire_s2?.queue).toHaveLength(1);
    // Com trabalho em fila não se demole (nada se perde).
    expect(sim.building.demolish(4, 4)).toBe('station_busy');
    // A fundação por baixo também não, enquanto a fogueira lá estiver.
    const foundation = sim.building.get(1);
    if (!foundation) throw new Error('falta a fundação');
    expect(sim.building.demolishProblem(foundation)).toBe('supports');
  });

  it('baús construídos abrem pelo id s<uid> e só se demolem vazios', () => {
    const { state, sim, events, give, moveTo, press } = setup();
    give([
      ['wood', 10],
      ['wood_plank', 10],
    ]);
    sim.building.place('foundation_wood', 6, 3, 0);
    expect(sim.building.place('storage_chest', 6, 3, 0)).toBeNull();
    moveTo(6, 4, 'up');
    press();
    expect(events).toContain('chest:s2');
    state.data.base.chests.s2 = [['wood', 1], null];
    expect(sim.building.demolish(6, 3)).toBe('chest_not_empty');
    state.data.base.chests.s2 = [null, null];
    expect(sim.building.demolish(6, 3)).toBeNull();
    expect(state.data.base.chests.s2).toBeUndefined();
  });

  it('portas abrem e fecham com a ação; não fecham com o jogador lá dentro', () => {
    const { state, sim, events, give, moveTo, press, tileBlocked } = setup();
    give([
      ['wood_plank', 4],
      ['rope', 2],
    ]);
    expect(sim.building.place('door_wood', 5, 5, 0)).toBeNull();
    expect(tileBlocked(5, 5)).toBe(true);
    moveTo(5, 6, 'up');
    press();
    expect(tileBlocked(5, 5)).toBe(false);
    expect(state.data.base.structures[0]?.[5]).toBe(1);
    // Dentro da porta aberta não se consegue fechar.
    moveTo(5, 5, 'up');
    const door = sim.building.get(1);
    if (!door) throw new Error('falta a porta');
    expect(sim.building.toggleDoor(1)).toBe('door_blocked');
    moveTo(5, 6, 'up');
    press();
    expect(tileBlocked(5, 5)).toBe(true);
    expect(events.filter((e) => e.startsWith('blocked:'))).toEqual([]);
  });

  it('aceitação da Fase 5: casa 6×6 fechada com porta, baú, fogueira e bancada, e tudo volta depois de gravar', () => {
    const { state, sim, give, moveTo, tileBlocked } = setup();
    give([
      ['wood', 50],
      ['wood', 50],
      ['stone', 20],
      ['wood_plank', 20],
      ['rope', 2],
    ]);
    moveTo(9, 10, 'up');
    const place = (id: string, tx: number, ty: number) => {
      expect(sim.building.place(id, tx, ty, 0), `${id} em (${String(tx)}, ${String(ty)})`).toBeNull();
    };
    // Paredes à volta de (1..6, 1..6), com a porta a sul em (3, 6).
    for (let i = 1; i <= 6; i++) {
      for (const [tx, ty] of [
        [i, 1],
        [1, i],
        [6, i],
        [i, 6],
      ] as const) {
        if (sim.building.structures().some(([, , x, y]) => x === tx && y === ty)) continue;
        if (tx === 3 && ty === 6) place('door_wood', tx, ty);
        else place('wall_wood', tx, ty);
      }
    }
    for (let ty = 2; ty <= 5; ty++) for (let tx = 2; tx <= 5; tx++) place('foundation_wood', tx, ty);
    place('storage_chest', 2, 2);
    place('campfire', 5, 2);
    place('wood_bench', 2, 4);
    expect(sim.building.structures()).toHaveLength(20 + 16 + 3);

    // Fechada: as paredes e a porta bloqueiam; lá dentro anda-se.
    expect(tileBlocked(1, 3)).toBe(true);
    expect(tileBlocked(3, 6)).toBe(true);
    expect(tileBlocked(4, 3)).toBe(false);

    // Gravar → ler → tudo reaparece (peças, colisões, estações).
    const loaded = parseSave(serializeSave(state.data, Date.now())).state;
    const again = setup(loaded);
    expect(again.sim.building.structures()).toHaveLength(39);
    expect(again.tileBlocked(1, 3)).toBe(true);
    expect(again.tileBlocked(3, 6)).toBe(true);
    again.moveTo(5, 3, 'up');
    again.give([['raw_meat', 1]]);
    const campfire = again.sim.building.structures().find(([, id]) => id === 'campfire');
    expect(campfire).toBeDefined();
    expect(again.sim.crafting.craft('r_cooked_meat', `campfire_s${String(campfire?.[0])}`)).toBe('ok');
  });

  it('Fase 8: fornalha → lingotes de ferro → machado de ferro (mais forte que o de pedra)', () => {
    const { state, sim, give } = setup();
    give([
      ['stone', 30],
      ['clay', 10],
      ['iron_ore', 6],
      ['wood', 30],
    ]);
    sim.building.place('foundation_wood', 2, 2, 0);
    sim.building.place('foundation_wood', 4, 2, 0);
    sim.building.place('foundation_wood', 5, 2, 0);
    expect(sim.building.place('furnace', 2, 2, 0)).toBeNull();
    expect(sim.building.place('wood_bench', 4, 2, 0)).toBeNull();
    const furnace = sim.building.structures().find(([, id]) => id === 'furnace');
    const bench = sim.building.structures().find(([, id]) => id === 'wood_bench');
    if (!furnace || !bench) throw new Error('faltam estações');
    const furnaceKey = `furnace_s${String(furnace[0])}`;
    for (let i = 0; i < 3; i++) expect(sim.crafting.craft('r_iron_ingot', furnaceKey)).toBe('ok');
    sim.crafting.advance(secondsToTicks(20) * 3);
    expect(sim.crafting.collect(furnaceKey)).toBe(3);
    expect(sim.crafting.craft('r_iron_axe', `wood_bench_s${String(bench[0])}`)).toBe('ok');
    sim.crafting.advance(secondsToTicks(25));
    sim.crafting.collect(`wood_bench_s${String(bench[0])}`);
    const axe = state.data.player.inventory.find((slot) => slot?.[0] === 'iron_axe');
    expect(axe).toEqual(['iron_axe', 1, 220]);
    expect(content.items.iron_axe?.gatherPower).toBeGreaterThan(content.items.stone_axe?.gatherPower ?? 0);
  });
});

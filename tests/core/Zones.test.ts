import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, PLAYER_FOOTPRINT } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { BASE_ZONE_ID, GameState } from '../../src/core/GameState';
import { fishingMarker } from '../../src/core/Fishing';
import { advanceRespawns } from '../../src/core/offline';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import zonesJson from '../../src/data/zones.json';
import { HANDS, parseZones } from '../../src/data/types';
import { missingInputs } from '../../src/systems/crafting/crafting';
import { countItem } from '../../src/systems/inventory/inventory';
import { rollLoot } from '../../src/systems/loot/loot';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import { arrivalPoint, canTravel } from '../../src/systems/travel/travel';
import { BASE_FLOOR_TILES, BASE_TILES, BASE_TILESET_NAME, baseTileIndex } from '../../src/world/tileset';
import { parseZoneMap, type ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = loadContent();
const zones = parseZones(zonesJson);

function realMap(zoneId: string): ZoneMap {
  const zone = zones[zoneId];
  if (!zone) throw new Error(zoneId);
  const url = new URL(`../../public/assets/${zone.map}`, import.meta.url);
  return parseZoneMap(
    JSON.parse(readFileSync(url, 'utf8')),
    {
      tileSize: 16,
      tilesets: { [BASE_TILESET_NAME]: BASE_TILES.length },
      resourceIds: Object.keys(content.resources),
      propIds: Object.keys(content.props),
      stationIds: Object.keys(content.stations),
      floorTiles: { [BASE_TILESET_NAME]: BASE_FLOOR_TILES.map(baseTileIndex) },
      lootTableIds: Object.keys(content.lootTables),
    },
    zone.map,
  );
}

function setup(seed = 7) {
  const state = new GameState();
  state.newGame(realMap(BASE_ZONE_ID).playerSpawn, seed);
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('container:open', ({ container }) => events.push(container));
  bus.on('fishing:result', ({ caught }) => events.push(caught ? 'caught' : 'missed'));
  bus.on('fishing:filled', () => events.push('filled'));
  bus.on('action:blocked', ({ reason }) => events.push(`blocked:${reason}`));
  bus.on('zone:change', ({ to }) => events.push(`exit:${String(to)}`));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
  const enter = (zoneId: string, map = realMap(zoneId)) => {
    sim.setZone({
      zoneId,
      map,
      collision: CollisionWorld.fromZone(
        map,
        content.resources,
        content.props,
        content.stations,
        content.lootTables,
      ),
      ...content,
      respawnDays: zones[zoneId]?.respawnDays ?? 1,
    });
    sim.reset();
    return map;
  };
  const press = () => {
    sim.setActionHeld(true);
    sim.setActionHeld(false);
    for (let i = 0; i < 10; i++) sim.update(FIXED_STEP_MS);
  };
  /** Põe o jogador a sul de um ponto, virado para ele. */
  const faceFromSouth = (p: { x: number; y: number }) => {
    Object.assign(state.data.player, { x: p.x, y: p.y + 9, facing: 'up' });
  };
  return { state, sim, events, enter, press, faceFromSouth };
}

describe('Loot', () => {
  it('rollLoot: respeita tiragens e slots, e é reproduzível com a mesma seed', () => {
    const table = content.lootTables.crate;
    if (!table) throw new Error('sem crate');
    const a = rollLoot(table, content.items, { rng: 5 });
    const b = rollLoot(table, content.items, { rng: 5 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(table.slots);
    const filled = a.filter((slot) => slot !== null).length;
    expect(filled).toBeGreaterThanOrEqual(1);
    expect(filled).toBeLessThanOrEqual(table.rolls.max);
  });

  it('"pity": o armário dá sempre pelo menos um item incomum ou melhor', () => {
    const table = content.lootTables.cabinet;
    if (!table) throw new Error('sem cabinet');
    for (let seed = 1; seed <= 200; seed++) {
      const loot = rollLoot(table, content.items, { rng: seed });
      expect(loot.some((slot) => slot && content.items[slot[0]]?.rarity !== 'common')).toBe(true);
    }
  });

  it('um contentor abre com loot, "Apanhar tudo" esvazia-o e só volta a encher com o tempo', () => {
    const { state, sim, events, enter, press, faceFromSouth } = setup();
    const pine = enter('zone_pine_forest');
    const crate = pine.containers.find((c) => c.id === 'crate');
    if (!crate) throw new Error('o Pinhal não tem caixotes');
    faceFromSouth(crate);
    expect(sim.interaction.currentTarget(PLAYER_FOOTPRINT)?.data.type).toBe('loot');
    press();
    const ref = `loot:zone_pine_forest:${String(crate.objectId)}` as const;
    expect(events).toContain(ref);
    const loot = sim.actions.container(ref);
    const before = loot.filter((s) => s !== null).length;
    expect(before).toBeGreaterThan(0);
    expect(sim.actions.takeAll(ref)).toBe(true);
    expect(sim.interaction.isLooted(crate.objectId)).toBe(true);
    // Abrir de novo: continua vazio.
    press();
    expect(sim.actions.container(ref).every((s) => s === null)).toBe(true);
    // Ao fim de um dia de jogo (aqui: tempo offline), volta a encher.
    advanceRespawns(state.data, (BALANCE.dayLengthSec * 1000) / FIXED_STEP_MS);
    press();
    expect(sim.actions.container(ref).some((s) => s !== null)).toBe(true);
  });
});

describe('Mapa-mundo e viagens', () => {
  it('as saídas sem destino abrem o mapa-mundo; custo em fome/sede; nunca deixa a 0', () => {
    const { state, sim, events, enter } = setup();
    const base = enter(BASE_ZONE_ID);
    const exit = base.exits[0];
    if (!exit) throw new Error('a base não tem saídas');
    const at = arrivalPoint(base, null, exit);
    Object.assign(state.data.player, at);
    sim.setMoveIntent({ x: exit.x - at.x, y: exit.y - at.y });
    for (let i = 0; i < 40; i++) sim.update(FIXED_STEP_MS);
    expect(events).toContain('exit:null');

    const farm = zones.zone_farm;
    if (!farm) throw new Error('sem quinta');
    expect(canTravel({ hunger: 3, thirst: 50 }, farm.travelCost)).toBe(false);
    state.data.player.hunger = 50;
    state.data.player.thirst = 50;
    expect(sim.travel('zone_farm', realMap('zone_farm'), farm.travelCost)).toBe(true);
    expect(state.data.player).toMatchObject({ zoneId: 'zone_farm', hunger: 47, thirst: 47 });
  });

  it('aceitação da Fase 7: base → Pinhal (grátis) → lootear → voltar → fazer algo novo', () => {
    const { state, sim, enter, press, faceFromSouth } = setup(11);
    const player = state.data.player;
    player.hotbar.fill(null);
    player.inventory[0] = ['wood', 10];
    player.level = 3; // ao fim dos primeiros minutos de jogo
    const craftable = () =>
      new Set(
        content.recipes
          .filter(
            (r) =>
              r.station === HANDS &&
              sim.progression.isRecipeUnlocked(r) &&
              missingInputs(sim.actions.pickupContainers(), r).length === 0,
          )
          .map((r) => r.id),
      );
    const before = craftable();

    const pineDef = zones.zone_pine_forest;
    if (!pineDef) throw new Error('sem pinhal');
    expect(pineDef.travelCost).toEqual({ hunger: 0, thirst: 0 });
    expect(sim.travel('zone_pine_forest', realMap('zone_pine_forest'), pineDef.travelCost)).toBe(true);
    const pine = enter('zone_pine_forest');
    for (const container of pine.containers) {
      faceFromSouth(container);
      press();
      sim.actions.takeAll(`loot:zone_pine_forest:${String(container.objectId)}`);
    }
    // Volta pelo mapa-mundo (grátis para a base: não custa nada voltar a casa).
    const base = realMap(BASE_ZONE_ID);
    sim.enterZone(BASE_ZONE_ID, base, base.exits[0]);
    enter(BASE_ZONE_ID, base);
    expect(player.zoneId).toBe(BASE_ZONE_ID);

    const fresh = [...craftable()].filter((id) => !before.has(id));
    expect(fresh.length).toBeGreaterThan(0);
    const recipe = fresh[0] ?? '';
    const output = content.recipes.find((r) => r.id === recipe)?.output ?? '';
    const had = countItem(sim.actions.pickupContainers(), output);
    expect(sim.crafting.craft(recipe, null)).toBe('ok');
    expect(countItem(sim.actions.pickupContainers(), output)).toBe(had + 1);
  });
});

describe('Pesca e água do lago', () => {
  it('o marcador vai e volta', () => {
    expect(fishingMarker(0, 10)).toBe(0);
    expect(fishingMarker(5, 10)).toBe(0.5);
    expect(fishingMarker(10, 10)).toBe(1);
    expect(fishingMarker(15, 10)).toBe(0.5);
    expect(fishingMarker(20, 10)).toBe(0);
  });

  it('no cais: com cana, apanha o peixe se carregar na zona verde (e falha fora dela)', () => {
    const { state, sim, events, enter, faceFromSouth } = setup();
    const lake = enter('zone_lake');
    const dock = lake.props.find((p) => p.id === 'dock');
    if (!dock) throw new Error('o lago não tem cais');
    state.data.player.inventory[0] = ['fishing_rod', 1, 60];
    faceFromSouth({ x: dock.x, y: dock.y - 4 });
    expect(sim.interaction.currentTarget(PLAYER_FOOTPRINT)?.data.type).toBe('fish');

    const tryOnce = (hit: boolean) => {
      sim.setActionHeld(true);
      sim.setActionHeld(false);
      sim.update(FIXED_STEP_MS);
      const session = sim.fishing.session;
      if (!session) throw new Error('não começou a pescar');
      // Espera até o marcador estar (ou não) na zona verde e carrega.
      for (let i = 0; i < 200; i++) {
        const inZone = Math.abs(sim.fishing.marker - session.zone) <= session.width / 2 - 0.05;
        const outZone = Math.abs(sim.fishing.marker - session.zone) > session.width / 2 + 0.1;
        if ((hit && inZone) || (!hit && outZone)) break;
        sim.update(FIXED_STEP_MS);
      }
      sim.fishing.strike();
      for (let i = 0; i < 10; i++) sim.update(FIXED_STEP_MS);
    };
    tryOnce(true);
    tryOnce(false);
    expect(events.filter((e) => e === 'caught' || e === 'missed')).toEqual(['caught', 'missed']);
    expect(countItem([state.data.player.inventory], 'fish')).toBe(1);
    expect(state.data.player.inventory[0]).toEqual(['fishing_rod', 1, 58]);
  });

  it('sem cana: enche uma garrafa vazia com água suja; sem nada, avisa', () => {
    const { state, events, enter, press, faceFromSouth, sim } = setup();
    const lake = enter('zone_lake');
    const dock = lake.props.find((p) => p.id === 'dock');
    if (!dock) throw new Error('o lago não tem cais');
    state.data.player.hotbar.fill(null);
    state.data.player.inventory[0] = ['empty_bottle', 1];
    faceFromSouth({ x: dock.x, y: dock.y - 4 });
    press();
    expect(events).toContain('filled');
    expect(state.data.player.inventory[0]).toEqual(['water_dirty', 1]);
    press();
    expect(events).toContain('blocked:needs_rod');
    expect(sim.fishing.active).toBe(false);
  });
});

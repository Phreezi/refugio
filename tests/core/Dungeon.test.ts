import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../src/config';
import { secondsToTicks } from '../../src/core/Clock';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import zonesJson from '../../src/data/zones.json';
import { parseZones } from '../../src/data/types';
import { countItem } from '../../src/systems/inventory/inventory';
import { rollLoot } from '../../src/systems/loot/loot';
import { discountedCost, eventActive, eventTicksLeft } from '../../src/systems/travel/events';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import {
  BASE_FLOOR_TILES,
  BASE_LEDGE_TILES,
  BASE_TILES,
  BASE_TILESET_NAME,
  baseTileIndex,
} from '../../src/world/tileset';
import { parseZoneMap, type ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = { ...loadContent(), zones: parseZones(zonesJson) };

function realMap(zoneId: string): ZoneMap {
  const zone = content.zones[zoneId];
  if (!zone) throw new Error(zoneId);
  return parseZoneMap(
    JSON.parse(readFileSync(new URL(`../../public/assets/${zone.map}`, import.meta.url), 'utf8')),
    {
      tileSize: 16,
      tilesets: { [BASE_TILESET_NAME]: BASE_TILES.length },
      resourceIds: Object.keys(content.resources),
      propIds: Object.keys(content.props),
      stationIds: Object.keys(content.stations),
      floorTiles: { [BASE_TILESET_NAME]: BASE_FLOOR_TILES.map(baseTileIndex) },
      ledgeTiles: { [BASE_TILESET_NAME]: BASE_LEDGE_TILES.map(baseTileIndex) },
      lootTableIds: Object.keys(content.lootTables),
    },
    zone.map,
  );
}

function setup() {
  const state = new GameState();
  state.newGame({ x: 40, y: 40 }, 5);
  state.data.player.level = 20;
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('boss:defeated', ({ enemy }) => events.push(`boss:${enemy}`));
  bus.on('dungeon:checkpoint', ({ floor }) => events.push(`floor:${String(floor)}`));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
    () => content,
  );
  const enter = (zoneId: string) => {
    const map = realMap(zoneId);
    const zone = content.zones[zoneId];
    state.data.player.zoneId = zoneId;
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
      respawnDays: zone?.respawnDays ?? 1,
    });
    sim.reset();
    return map;
  };
  return { state, sim, events, enter };
}

describe('Bunker (Fase 10)', () => {
  it('só o piso 1 aparece no mapa-mundo; os pisos ligam-se por escadas', () => {
    expect(content.zones.zone_bunker?.hidden).toBe(false);
    for (const n of [2, 3, 4]) expect(content.zones[`zone_bunker_${String(n)}`]?.hidden).toBe(true);
    const first = realMap('zone_bunker').exits.map((e) => e.to);
    expect(first).toEqual(expect.arrayContaining([null, 'zone_bunker_2']));
    const third = realMap('zone_bunker_3').exits.map((e) => e.to);
    expect(third).toEqual(expect.arrayContaining(['zone_bunker_2', 'zone_bunker_4']));
    // O piso 4 tem o elevador (mapa-mundo) depois do chefe.
    expect(realMap('zone_bunker_4').exits.map((e) => e.to)).toEqual(
      expect.arrayContaining(['zone_bunker_3', null]),
    );
  });

  it('a chave do bunker está no cofre da Zona Industrial e é precisa para viajar', () => {
    const { state, sim } = setup();
    expect(sim.progression.missingItem('zone_bunker')).toBe('bunker_key');
    const safe = realMap('zone_industrial').containers.filter((c) => c.id === 'safe');
    expect(safe).toHaveLength(1);
    const table = content.lootTables.safe;
    if (!table) throw new Error('sem cofre');
    expect(countItem([rollLoot(table, content.items, { rng: 9 })], 'bunker_key')).toBe(1);
    state.data.player.inventory[0] = ['bunker_key', 1];
    expect(sim.progression.missingItem('zone_bunker')).toBeNull();
  });

  it('checkpoint: viajar leva ao piso mais fundo já alcançado (nunca volta para trás)', () => {
    const { state, sim, events, enter } = setup();
    expect(sim.progression.dungeonEntry('zone_bunker')).toBe('zone_bunker');
    enter('zone_bunker');
    enter('zone_bunker_2');
    enter('zone_bunker_3');
    expect(state.data.dungeons).toEqual({ bunker: 3 });
    expect(events).toEqual(['floor:2', 'floor:3']);
    enter('zone_bunker_2');
    expect(state.data.dungeons).toEqual({ bunker: 3 });
    expect(sim.progression.dungeonEntry('zone_bunker')).toBe('zone_bunker_3');
    // Outras zonas não mudam.
    expect(sim.progression.dungeonEntry('zone_farm')).toBe('zone_farm');
  });

  it('o chefe dá o cartão militar e só volta uma semana depois', () => {
    const { state, sim, events, enter } = setup();
    enter('zone_bunker_4');
    const boss = sim.combat.list.find((e) => e.id === 'boss_warden');
    if (!boss) throw new Error('sem chefe');
    boss.hp = 1;
    sim.combat.roll = () => 0.99; // não falha
    sim.combat.attack(boss.uid);
    expect(events).toContain('boss:boss_warden');
    // O cartão fica no corpo: abre-se e apanha-se.
    sim.combat.takeBag(sim.combat.bags().findIndex((b) => b.corpse === 'boss_warden'));
    sim.update(FIXED_STEP_MS);
    expect(countItem([state.data.player.inventory, state.data.player.hotbar], 'military_keycard')).toBe(1);
    enter('zone_bunker_4');
    expect(sim.combat.list.some((e) => e.id === 'boss_warden')).toBe(false);
    state.data.world.tick += secondsToTicks(7 * BALANCE.dayLengthSec);
    enter('zone_bunker_4');
    expect(sim.combat.list.some((e) => e.id === 'boss_warden')).toBe(true);
    sim.update(FIXED_STEP_MS);
  });
});

describe('Zonas T4 (Fase 10)', () => {
  it('a Base Militar pede o cartão do chefe; a Cidade é a zona final', () => {
    const { state, sim } = setup();
    expect(sim.progression.missingItem('zone_military')).toBe('military_keycard');
    state.data.player.hotbar[3] = ['military_keycard', 1];
    expect(sim.progression.missingItem('zone_military')).toBeNull();
    expect(content.zones.zone_city?.unlockLevel).toBe(25);
    const military = realMap('zone_military');
    expect(military.containers.filter((c) => c.id === 'armory').length).toBeGreaterThanOrEqual(6);
    const city = realMap('zone_city');
    // 16 nas lojas dos prédios e mais algumas na área de combate a leste (Etapa E).
    expect(city.containers.filter((c) => c.id === 'city_store').length).toBeGreaterThanOrEqual(16);
    expect(city.enemySpawns.length).toBeGreaterThanOrEqual(10);
  });
});

describe('Eventos, comerciante e moto (Fase 10)', () => {
  const dayTicks = secondsToTicks(BALANCE.dayLengthSec);

  it('as zonas-evento só existem nos seus dias', () => {
    const camp = content.zones.zone_camp?.event;
    if (!camp) throw new Error('sem acampamento');
    const active = (day: number) => eventActive(camp, day * dayTicks + 10, dayTicks);
    // offset 1, a cada 6 dias, dura 2: dias 1–2, 7–8, 13–14…
    expect([0, 1, 2, 3, 6, 7, 8, 9].map(active)).toEqual([
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
    ]);
    expect(eventTicksLeft(camp, 1 * dayTicks, dayTicks)).toBe(2 * dayTicks);
    const { state, sim } = setup();
    state.data.world.tick = 1 * dayTicks + 5;
    expect(sim.progression.isZoneAvailable('zone_camp')).toBe(true);
    expect(sim.progression.isZoneAvailable('zone_farm')).toBe(true);
    state.data.world.tick = 4 * dayTicks;
    expect(sim.progression.isZoneAvailable('zone_camp')).toBe(false);
  });

  it('o comerciante troca na hora (sem fila e sem XP)', () => {
    const { state, sim, enter } = setup();
    const map = enter('zone_camp');
    const trader = map.stations.find((s) => s.id === 'trader');
    if (!trader) throw new Error('sem comerciante');
    const key = `trader_${String(trader.objectId)}`;
    const player = state.data.player;
    player.inventory.fill(null);
    player.hotbar.fill(null);
    player.inventory[0] = ['scrap_metal', 6];
    const xp = player.xp;
    expect(sim.crafting.craft('t_nails', key)).toBe('ok');
    expect(countItem([player.inventory], 'nails')).toBe(10);
    expect(countItem([player.inventory], 'scrap_metal')).toBe(0);
    expect(player.xp).toBe(xp);
    // Longe dele não se troca.
    player.inventory[0] = ['scrap_metal', 6];
    expect(sim.crafting.craft('t_nails', null)).toBe('missing');
  });

  it('a moto na base corta para metade o custo das viagens', () => {
    const { state, sim } = setup();
    expect(sim.progression.travelCost('zone_city')).toEqual({ hunger: 10, thirst: 12 });
    state.data.base.structures.push([1, 'motorcycle', 5, 5, 0, 0]);
    expect(sim.progression.travelDiscount()).toBe(50);
    expect(sim.progression.travelCost('zone_city')).toEqual({ hunger: 5, thirst: 6 });
    expect(discountedCost({ hunger: 5, thirst: 3 }, 50)).toEqual({ hunger: 2, thirst: 1 });
  });
});

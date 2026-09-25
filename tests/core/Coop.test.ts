import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { BASE_ZONE_ID, createNewGameState, GameState } from '../../src/core/GameState';
import type { ZoneContext } from '../../src/core/Interaction';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import { countItem } from '../../src/systems/inventory/inventory';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import type { ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = loadContent();
const N = 40;
const ZONE = 'zone_pine_forest';

function map(spawns: { id: string; x: number; y: number }[]): ZoneMap {
  return {
    width: N,
    height: N,
    tileSize: 16,
    solid: new Array<boolean>(N * N).fill(false),
    floor: new Array<boolean>(N * N).fill(false),
    playerSpawn: { x: 40, y: 40 },
    exits: [],
    resources: [],
    props: [],
    chests: [{ id: 'base_1', x: 62, y: 78, objectId: 9 }],
    stations: [],
    containers: [],
    enemySpawns: spawns,
  };
}

function context(zoneId: string, zone: ZoneMap): ZoneContext {
  return {
    zoneId,
    map: zone,
    collision: CollisionWorld.fromZone(zone, content.resources, content.props),
    ...content,
  };
}

function simFor(state: GameState, bus: EventBus<GameEvents>): Simulation {
  return new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
}

/**
 * Anfitrião em (100, 240) e convidado em (400, 240), no Pinhal. O convidado é uma segunda
 * Simulation sobre o mesmo mundo (como o co-op faz no anfitrião).
 */
function setup(spawns: { id: string; x: number; y: number }[]) {
  const host = new GameState();
  host.newGame({ x: 100, y: 240 }, 42);
  host.data.player.zoneId = ZONE;
  const mine = createNewGameState({ x: 400, y: 240 }, 7);
  const guest = new GameState();
  guest.load({
    ...host.data,
    player: { ...mine.player, zoneId: ZONE },
    unlocks: mine.unlocks,
    stats: mine.stats,
    tutorial: mine.tutorial,
  });
  const hostBus = new EventBus<GameEvents>();
  const guestBus = new EventBus<GameEvents>();
  const events: string[] = [];
  hostBus.on('player:damaged', () => events.push('host:hurt'));
  guestBus.on('player:damaged', () => events.push('guest:hurt'));
  hostBus.on('enemy:killed', () => events.push('host:killed'));
  guestBus.on('enemy:killed', () => events.push('guest:killed'));
  guestBus.on('player:died', () => events.push('guest:died'));
  const hostSim = simFor(host, hostBus);
  const guestSim = simFor(guest, guestBus);
  const zone = map(spawns);
  hostSim.setZone(context(ZONE, zone));
  hostSim.contextFor = (zoneId) => context(zoneId, map([]));
  hostSim.setRespawnPoint({ x: 40, y: 40 });
  guestSim.setRespawnPoint({ x: 40, y: 40 });
  hostSim.reset();
  hostSim.attach(guestSim);
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < (seconds * 1000) / FIXED_STEP_MS; i++) {
      each?.();
      hostSim.update(FIXED_STEP_MS);
    }
  };
  return { host, guest, hostSim, guestSim, events, run };
}

describe('Co-op: dois jogadores no mesmo mundo', () => {
  it('na mesma zona veem os mesmos inimigos, que atacam quem estiver mais perto', () => {
    const { hostSim, guestSim, events, run } = setup([{ id: 'walker', x: 440, y: 240 }]);
    expect(guestSim.combat.list).toBe(hostSim.combat.list);
    expect(hostSim.combat.list.length).toBeGreaterThan(0);
    run(6);
    expect(events).toContain('guest:hurt');
    expect(events).not.toContain('host:hurt');
  });

  it('quem derrota o inimigo fica com os drops e a XP', () => {
    const { host, guest, hostSim, guestSim, events, run } = setup([{ id: 'walker', x: 414, y: 240 }]);
    for (const enemy of hostSim.combat.list) enemy.hp = 1;
    guestSim.setRemotePlayer(400, 240, 'right', false, false);
    guestSim.setActionHeld(true);
    run(0.2);
    expect(events).toContain('guest:killed');
    expect(events).not.toContain('host:killed');
    expect(guest.data.player.xp).toBeGreaterThan(0);
    expect(host.data.player.xp).toBe(0);
  });

  it('o tempo e o mundo são um só: os baús são partilhados', () => {
    const { host, guest, guestSim, run } = setup([]);
    const tick = host.data.world.tick;
    run(1);
    expect(host.data.world.tick).toBe(tick + 20);
    expect(guest.data.world.tick).toBe(host.data.world.tick);
    guest.data.player.inventory[0] = ['wood', 10];
    host.data.base.chests.base_1 = new Array<null>(BALANCE.chestSlots).fill(null);
    guestSim.actions.move({ container: 'inventory', index: 0 }, { container: 'chest:base_1', index: 0 });
    expect(host.data.base.chests.base_1[0]).toEqual(['wood', 10]);
  });

  it('cada um tem a sua mochila, vida, fome e sede', () => {
    const { host, guest, run } = setup([]);
    guest.data.player.inventory[0] = ['stone', 3];
    expect(countItem([host.data.player.inventory], 'stone')).toBe(0);
    run(BALANCE.hungerDecaySec + 1);
    expect(guest.data.player.hunger).toBeLessThan(BALANCE.statMax);
    expect(host.data.player.hunger).toBeLessThan(BALANCE.statMax);
  });

  it('em co-op os inimigos têm 1,5× vida e dano', () => {
    const { guest, hostSim } = setup([{ id: 'walker', x: 440, y: 240 }]);
    hostSim.setDifficulty(BALANCE.coopEnemyMultiplier);
    const walker = hostSim.combat.list[0];
    const def = content.enemies.zombie_walker;
    expect(walker && def).toBeTruthy();
    if (!walker || !def) return;
    expect(walker.maxHp).toBe(Math.round(def.hp * 1.5));
    expect(walker.hp).toBe(walker.maxHp);
    for (let i = 0; i < 400 && guest.data.player.hp === BALANCE.statMax; i++) hostSim.update(FIXED_STEP_MS);
    expect(BALANCE.statMax - guest.data.player.hp).toBe(Math.round(def.damage * 1.5));
  });

  it('o anfitrião sai da zona: o convidado fica com os inimigos que lá estavam', () => {
    const { hostSim, guestSim, events, run } = setup([{ id: 'walker', x: 440, y: 240 }]);
    const count = hostSim.combat.list.length;
    hostSim.setZone(null);
    expect(hostSim.combat.list.length).toBe(0);
    expect(guestSim.combat.list.length).toBe(count);
    run(6);
    expect(events).toContain('guest:hurt');
  });

  it('o convidado que morre reaparece na base e deixa a mochila onde caiu', () => {
    const { host, guest, run } = setup([{ id: 'walker', x: 420, y: 240 }]);
    guest.data.player.hp = 1;
    guest.data.player.inventory[0] = ['wood', 5];
    run(6);
    expect(guest.data.player.zoneId).toBe(BASE_ZONE_ID);
    expect(host.data.zones[ZONE]?.bags.some((bag) => bag.death)).toBe(true);
    expect(host.data.player.zoneId).toBe(ZONE);
  });

  it('um estado emprestado (o do convidado, no ecrã dele) nunca fica por gravar nem ganha XP', () => {
    const host = new GameState();
    host.newGame({ x: 10, y: 10 }, 1);
    const borrowed = new GameState();
    borrowed.load(structuredClone(host.data), true);
    borrowed.markDirty();
    expect(borrowed.dirty).toBe(false);
    const sim = simFor(borrowed, new EventBus<GameEvents>());
    sim.progression.gain(100);
    expect(borrowed.data.player.xp).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, PLAYER_FOOTPRINT } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import type { ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = loadContent();

/** Zona 10×10 vazia com uma árvore pequena a sul do jogador, um baú a oeste e o poço a leste. */
function setup() {
  const map: ZoneMap = {
    width: 10,
    height: 10,
    tileSize: 16,
    solid: new Array<boolean>(100).fill(false),
    floor: new Array<boolean>(100).fill(false),
    playerSpawn: { x: 80, y: 80 },
    exits: [],
    resources: [{ id: 'tree_small', x: 80, y: 92, objectId: 7 }],
    props: [{ id: 'well', x: 104, y: 78, objectId: 8 }],
    chests: [{ id: 'base_1', x: 62, y: 78, objectId: 9 }],
    stations: [],
    containers: [],
    enemySpawns: [],
  };
  const state = new GameState();
  state.newGame({ x: 80, y: 80 }, 123);
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('resource:hit', ({ hp }) => events.push(`hit:${String(hp)}`));
  bus.on('item:gained', ({ item, qty }) => events.push(`+${String(qty)} ${item}`));
  bus.on('action:blocked', ({ reason }) => events.push(`blocked:${reason}`));
  bus.on('container:open', ({ container }) => events.push(`open:${container.replace('chest:', '')}`));
  bus.on('resource:respawned', () => events.push('respawned'));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
  );
  const collision = CollisionWorld.fromZone(map, content.resources, content.props);
  sim.setZone({ zoneId: 'zone_test', map, collision, ...content });
  sim.reset();
  const face = (facing: 'down' | 'left' | 'right' | 'up') => {
    state.data.player.facing = facing;
  };
  /** Carrega na ação uma vez e deixa passar o tempo de espera entre golpes. */
  const press = () => {
    sim.setActionHeld(true);
    sim.setActionHeld(false);
    for (let i = 0; i < 10; i++) sim.update(FIXED_STEP_MS);
  };
  return { state, sim, events, collision, face, press };
}

describe('Interaction (ação contextual e recolha)', () => {
  it('corta a árvore à mão em 6 golpes, ganha madeira e a árvore deixa de bloquear', () => {
    const { state, sim, events, collision, face, press } = setup();
    face('down');
    expect(sim.interaction.currentTarget(PLAYER_FOOTPRINT)?.data.type).toBe('resource');
    for (let i = 0; i < 6; i++) press();
    expect(events.slice(0, 6)).toEqual(['hit:5', 'hit:4', 'hit:3', 'hit:2', 'hit:1', 'hit:0']);
    const wood = state.data.player.inventory.find((slot) => slot?.[0] === 'wood');
    expect(wood?.[1]).toBeGreaterThanOrEqual(2);
    expect(events[6]).toMatch(/^\+\d wood$/);
    expect(sim.interaction.isDepleted(7)).toBe(true);
    expect(collision.blocks({ x: 79, y: 89, w: 1, h: 1 })).toBe(false);
    expect(state.data.zones.zone_test?.depleted['7']).toBeGreaterThan(state.data.world.tick);
  });

  it('com machado bastam 3 golpes e o machado gasta-se', () => {
    const { state, events, face, press } = setup();
    state.data.player.inventory[0] = ['stone_axe', 1, 120];
    face('down');
    for (let i = 0; i < 3; i++) press();
    expect(events.filter((e) => e.startsWith('hit:'))).toEqual(['hit:4', 'hit:2', 'hit:0']);
    expect(state.data.player.inventory[0]).toEqual(['stone_axe', 1, 117]);
  });

  it('com a mochila cheia o último golpe não acontece (nada se perde)', () => {
    const { state, events, face, press } = setup();
    const { inventory, hotbar } = state.data.player;
    inventory.fill(['stone', 50]);
    hotbar.fill(['stone', 50]);
    face('down');
    for (let i = 0; i < 6; i++) press();
    expect(events.at(-1)).toBe('blocked:inventory_full');
  });

  it('a árvore reaparece depois de respawnSec de jogo', () => {
    const { sim, events, face, press, collision } = setup();
    face('down');
    for (let i = 0; i < 6; i++) press();
    const ticks = (content.resources.tree_small?.respawnSec ?? 0) * 20;
    for (let i = 0; i < ticks + 40; i++) sim.update(FIXED_STEP_MS);
    expect(events).toContain('respawned');
    expect(sim.interaction.isDepleted(7)).toBe(false);
    expect(collision.blocks({ x: 79, y: 89, w: 1, h: 1 })).toBe(true);
  });

  it('virado para o baú abre-o; virado para o poço bebe', () => {
    const { state, events, face, press } = setup();
    face('left');
    press();
    expect(events).toContain('open:base_1');
    state.data.player.thirst = 10;
    face('right');
    press();
    expect(state.data.player.thirst).toBe(10 + BALANCE.wellThirst);
  });

  it('manter a ação premida repete golpes ao ritmo do cooldown', () => {
    const { sim, events, face } = setup();
    face('down');
    sim.setActionHeld(true);
    for (let i = 0; i < 20; i++) sim.update(FIXED_STEP_MS); // 1 s ≈ 3 golpes (0,4 s)
    expect(events.filter((e) => e.startsWith('hit:')).length).toBe(3);
  });
});

describe('PlayerActions', () => {
  it('comer bagas sobe a fome; beber água devolve a garrafa ao mesmo slot', () => {
    const { state, sim } = setup();
    const player = state.data.player;
    player.hunger = 50;
    player.thirst = 50;
    expect(sim.actions.use({ container: 'hotbar', index: 0 })).toBe(true); // bagas
    expect(player.hunger).toBe(58);
    expect(player.hotbar[0]).toEqual(['berries', 4]);
    player.hotbar[1] = ['water_clean', 1];
    sim.actions.use({ container: 'hotbar', index: 1 });
    expect(player.thirst).toBe(85 + 2);
    expect(player.hotbar[1]).toEqual(['empty_bottle', 1]);
    expect(sim.actions.use({ container: 'hotbar', index: 1 })).toBe(false); // garrafa vazia não se come
  });

  it('comida estragada tira vida mas nunca mata', () => {
    const { state, sim } = setup();
    state.data.player.hp = 2;
    state.data.player.inventory[0] = ['raw_meat', 1];
    sim.actions.use({ container: 'inventory', index: 0 });
    expect(state.data.player.hp).toBe(1);
  });

  it('mover entre mochila e baú, e guardar semelhantes', () => {
    const { state, sim } = setup();
    state.data.player.inventory[0] = ['wood', 10];
    state.data.player.inventory[1] = ['wood', 5];
    state.data.base.chests.base_1 = new Array<null>(BALANCE.chestSlots).fill(null);
    sim.actions.move({ container: 'inventory', index: 0 }, { container: 'chest:base_1', index: 3 });
    expect(state.data.base.chests.base_1[3]).toEqual(['wood', 10]);
    expect(sim.actions.storeSimilar('chest:base_1')).toBe(5);
    expect(state.data.base.chests.base_1[3]).toEqual(['wood', 15]);
    expect(state.data.base.chests.base_1).toHaveLength(BALANCE.chestSlots);
  });
});

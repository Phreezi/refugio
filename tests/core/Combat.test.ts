import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, PLAYER_FOOTPRINT } from '../../src/config';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { BASE_ZONE_ID, GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import { countItem } from '../../src/systems/inventory/inventory';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import type { ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = loadContent();
const N = 30;
const SIZE = 16;
const ZONE = 'zone_pine_forest';

function map(spawns: { id: string; x: number; y: number }[], exits: ZoneMap['exits'] = []): ZoneMap {
  return {
    width: N,
    height: N,
    tileSize: SIZE,
    solid: new Array<boolean>(N * N).fill(false),
    floor: new Array<boolean>(N * N).fill(false),
    playerSpawn: { x: 40, y: 40 },
    exits,
    resources: [],
    props: [],
    chests: [],
    stations: [],
    containers: [],
    enemySpawns: spawns,
  };
}

function setup(zone: ZoneMap, player = { x: 240, y: 240 }) {
  const state = new GameState();
  state.newGame(player, 42);
  state.data.player.zoneId = ZONE;
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('player:damaged', ({ amount }) => events.push(`hurt:${String(amount)}`));
  bus.on('enemy:killed', ({ enemy }) => events.push(`killed:${enemy}`));
  bus.on('player:died', ({ zoneId, bag }) => events.push(`died:${zoneId}:${String(bag)}`));
  bus.on('zone:change', ({ to }) => events.push(`zone:${to}`));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
  sim.setZone({
    zoneId: ZONE,
    map: zone,
    collision: CollisionWorld.fromZone(zone, content.resources, content.props),
    ...content,
  });
  sim.setRespawnPoint({ x: 100, y: 100 });
  sim.reset();
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < (seconds * 1000) / FIXED_STEP_MS; i++) {
      each?.();
      sim.update(FIXED_STEP_MS);
    }
  };
  return { state, sim, events, run };
}

describe('Combate', () => {
  it('um arrastado vê o jogador, aproxima-se, avisa e só depois acerta', () => {
    const { state, sim, events, run } = setup(map([{ id: 'walker', x: 290, y: 240 }]));
    const [walker] = sim.combat.list;
    expect(walker).toBeDefined();
    run(0.1);
    expect(walker?.state).toBe('chase');
    // Chega ao jogador e começa o aviso (ainda sem dano).
    for (let i = 0; i < 400 && walker?.state !== 'windup'; i++) sim.update(FIXED_STEP_MS);
    expect(walker?.state).toBe('windup');
    expect(events).toEqual([]);
    run(BALANCE.enemyWindupSec + 0.1);
    expect(events).toEqual(['hurt:6']);
    expect(state.data.player.hp).toBe(94);
  });

  it('recuar durante o aviso evita o golpe; a armadura reduz o dano', () => {
    const { state, sim, events, run } = setup(map([{ id: 'walker', x: 290, y: 240 }]));
    const walker = sim.combat.list[0];
    for (let i = 0; i < 400 && walker?.state !== 'windup'; i++) sim.update(FIXED_STEP_MS);
    sim.setMoveIntent({ x: -1, y: 0 });
    run(BALANCE.enemyWindupSec + 0.05);
    sim.setMoveIntent({ x: 0, y: 0 });
    expect(events).toEqual([]);
    // Com camisa (10%) e chapéu (5%): 6 → 5.
    state.data.player.equipment[1] = ['cloth_hat', 1, 100];
    state.data.player.equipment[2] = ['cloth_shirt', 1, 150];
    for (let i = 0; i < 600 && events.length === 0; i++) sim.update(FIXED_STEP_MS);
    expect(events).toEqual(['hurt:5']);
    expect(state.data.player.equipment[2]).toEqual(['cloth_shirt', 1, 149]);
  });

  it('agachado, os inimigos só o veem a metade da distância', () => {
    const { sim, run } = setup(map([{ id: 'walker', x: 290, y: 240 }]));
    sim.setMoveIntent({ x: 0, y: 0 }, true);
    run(0.1);
    expect(sim.combat.list[0]?.state).not.toBe('chase');
  });

  it('desistem fora do raio (leash), voltam a casa e recuperam a vida', () => {
    const { state, sim, run } = setup(map([{ id: 'walker', x: 290, y: 240 }]));
    const walker = sim.combat.list[0];
    if (!walker) throw new Error('sem inimigo');
    run(0.5);
    walker.hp = 10;
    // O jogador foge para longe (teleporte: mais do que o leash).
    state.data.player.x = 40;
    state.data.player.y = 40;
    run(12);
    expect(walker.hp).toBe(40);
    expect(Math.hypot(walker.x - walker.home.x, walker.y - walker.home.y)).toBeLessThanOrEqual(50); // em casa (a passear perto)
  });

  it('aceitação da Fase 6: com a moca, vence 3 arrastados sem morrer se recuar entre ataques', () => {
    const { state, sim, events } = setup(
      map([
        { id: 'walker', x: 300, y: 230 },
        { id: 'walker', x: 310, y: 250 },
        { id: 'walker', x: 300, y: 270 },
      ]),
    );
    state.data.player.equipment[0] = ['wooden_club', 1, 100];
    const player = state.data.player;
    for (let tick = 0; tick < 20 * 90 && sim.combat.list.length > 0; tick++) {
      const enemies = sim.combat.list;
      const near = (e: { x: number; y: number }) => Math.hypot(e.x - player.x, e.y - player.y);
      const threat = enemies.find((e) => e.state === 'windup' && near(e) < 24);
      const target = [...enemies].sort((a, b) => near(a) - near(b))[0];
      if (threat) {
        // Recua do ataque anunciado.
        sim.setActionHeld(false);
        sim.setMoveIntent({ x: player.x - threat.x, y: player.y - threat.y });
      } else if (target) {
        const inFront = sim.interaction.currentTarget(PLAYER_FOOTPRINT)?.data.type === 'enemy';
        if (inFront) {
          sim.setMoveIntent({ x: 0, y: 0 });
          sim.setActionHeld(true);
        } else {
          sim.setActionHeld(false);
          sim.setMoveIntent({ x: target.x - player.x, y: target.y - player.y });
        }
      }
      sim.update(FIXED_STEP_MS);
    }
    expect(sim.combat.list).toHaveLength(0);
    expect(events.filter((e) => e === 'killed:zombie_walker')).toHaveLength(3);
    expect(events.some((e) => e.startsWith('died'))).toBe(false);
    expect(player.hp).toBeGreaterThan(50);
    expect(player.equipment[0]?.[2]).toBeLessThan(100); // a moca gastou-se
  });

  it('matar dá os drops (veado: carne e couro)', () => {
    const { state, sim, events } = setup(map([{ id: 'deer', x: 250, y: 240 }]));
    const deer = sim.combat.list[0];
    if (!deer) throw new Error('sem veado');
    deer.hp = 1;
    expect(sim.combat.attack(deer.uid)).toBe(true);
    expect(events).toContain('killed:deer');
    expect(countItem([state.data.player.inventory], 'raw_meat')).toBeGreaterThanOrEqual(2);
    expect(countItem([state.data.player.inventory], 'leather')).toBe(1);
  });

  it('ao morrer: a mochila fica no chão, hotbar e equipamento ficam, e volta à base', () => {
    const { state, sim, events, run } = setup(map([]));
    const player = state.data.player;
    player.inventory[0] = ['wood', 12];
    player.inventory[3] = ['stone_axe', 1, 50];
    player.equipment[0] = ['wooden_club', 1, 80];
    player.hp = 1;
    sim.combat.damagePlayer(10, { x: player.x + 5, y: player.y });
    run(0.1);
    expect(events).toContain(`died:${ZONE}:true`);
    expect(player.zoneId).toBe(BASE_ZONE_ID);
    expect(player.inventory.every((slot) => slot === null)).toBe(true);
    expect(player.hotbar[0]).toEqual(['berries', 5]);
    expect(player.equipment[0]).toEqual(['wooden_club', 1, 80]);
    const bags = state.data.zones[ZONE]?.bags ?? [];
    expect(bags).toHaveLength(1);
    expect(bags[0]?.items).toEqual([
      ['wood', 12],
      ['stone_axe', 1, 50],
    ]);
    expect(bags[0]?.expiresAt).toBeGreaterThan(Date.now() + 47 * 3_600_000);

    // Volta à zona e apanha a mochila com a ação contextual.
    player.zoneId = ZONE;
    const bag = bags[0];
    if (!bag) throw new Error('sem mochila');
    Object.assign(player, { x: bag.x, y: bag.y + 8, facing: 'up' });
    expect(sim.interaction.currentTarget(PLAYER_FOOTPRINT)?.data.type).toBe('bag');
    sim.setActionHeld(true);
    sim.setActionHeld(false);
    run(0.1);
    expect(state.data.zones[ZONE]?.bags).toEqual([]);
    expect(countItem([player.inventory], 'wood')).toBe(12);
    expect(player.inventory.find((slot) => slot?.[0] === 'stone_axe')).toEqual(['stone_axe', 1, 50]);
  });

  it('mochilas expiradas desaparecem ao entrar na zona', () => {
    const { state, sim } = setup(map([]));
    state.data.zones[ZONE] = {
      depleted: {},
      bags: [{ x: 1, y: 1, items: [['wood', 1]], expiresAt: Date.now() - 1, death: true }],
      loot: {},
    };
    const zone = map([]);
    sim.setZone({
      zoneId: ZONE,
      map: zone,
      collision: CollisionWorld.fromZone(zone, content.resources, content.props),
      ...content,
    });
    expect(state.data.zones[ZONE].bags).toEqual([]);
  });

  it('pisar uma saída pede a mudança de zona; ao entrar fica junto à saída de volta', () => {
    const exits = [{ x: 8, y: 240, to: BASE_ZONE_ID }];
    const { state, sim, events, run } = setup(map([], exits), { x: 40, y: 240 });
    sim.setMoveIntent({ x: -1, y: 0 });
    run(1);
    expect(events).toEqual([`zone:${BASE_ZONE_ID}`]);
    const base = map([], [{ x: 472, y: 240, to: ZONE }]);
    sim.enterZone(BASE_ZONE_ID, base);
    expect(state.data.player).toMatchObject({ zoneId: BASE_ZONE_ID, x: 444, y: 240 });
  });
});

describe('Equipamento', () => {
  it('equipar troca com o que estava; só entra o que é desse slot', () => {
    const { state, sim } = setup(map([]));
    const { player } = state.data;
    player.inventory[0] = ['wooden_club', 1, 90];
    player.inventory[1] = ['cloth_shirt', 1, 150];
    player.inventory[2] = ['machete', 1, 180];
    expect(sim.actions.equip({ container: 'inventory', index: 0 })).toBe(true);
    expect(player.equipment[0]).toEqual(['wooden_club', 1, 90]);
    expect(sim.actions.move({ container: 'inventory', index: 1 }, { container: 'equipment', index: 0 })).toBe(
      false,
    );
    expect(sim.actions.equip({ container: 'inventory', index: 1 })).toBe(true);
    expect(player.equipment[2]).toEqual(['cloth_shirt', 1, 150]);
    expect(sim.actions.equip({ container: 'inventory', index: 2 })).toBe(true);
    expect(player.equipment[0]?.[0]).toBe('machete');
    expect(player.inventory[2]).toEqual(['wooden_club', 1, 90]);
    expect(sim.combat.weapon()).toMatchObject({ damage: 20, reach: 16 });
    expect(sim.actions.unequip(0)).toBe(true);
    expect(player.equipment[0]).toBeNull();
    expect(sim.combat.weapon().damage).toBe(BALANCE.fistDamage);
  });
});

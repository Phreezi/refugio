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

function setup() {
  const map: ZoneMap = {
    width: 20,
    height: 20,
    tileSize: 16,
    solid: new Array<boolean>(400).fill(false),
    floor: new Array<boolean>(400).fill(false),
    playerSpawn: { x: 80, y: 80 },
    exits: [],
    resources: [{ id: 'tree_small', x: 80, y: 92, objectId: 7 }],
    props: [],
    chests: [],
    stations: [],
    containers: [],
    enemySpawns: [],
  };
  const state = new GameState();
  state.newGame({ x: 80, y: 80 }, 7);
  const bus = new EventBus<GameEvents>();
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
  sim.setZone({
    zoneId: 'zone_test',
    map,
    collision: CollisionWorld.fromZone(map, content.resources, content.props),
    ...content,
  });
  sim.reset();
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) sim.update(FIXED_STEP_MS);
  };
  return { state, sim, bus, tick };
}

describe('Mochilas (§7.3)', () => {
  it('equipar uma mochila dá espaços; tirá-la passa o que lá estava para espaços livres ou para o chão', () => {
    const { state, sim, tick } = setup();
    state.data.player.level = 20; // sem limite de nível para equipar (§7.16)
    const player = state.data.player;
    expect(player.inventory.length).toBe(BALANCE.inventorySlots);
    player.inventory[0] = ['small_backpack', 1];
    expect(sim.actions.equip({ container: 'inventory', index: 0 })).toBe(true);
    tick();
    expect(player.inventory.length).toBe(BALANCE.inventorySlots + 10);
    // Enche tudo, incluindo os espaços da mochila.
    for (let i = 0; i < player.inventory.length; i++) player.inventory[i] = ['stone_axe', 1, 50];
    player.equipment[5] = null;
    tick();
    expect(player.inventory.length).toBe(BALANCE.inventorySlots);
    // Os 10 machados que não cabem ficam numa pilha no chão (nada se perde).
    const bag = state.data.zones.zone_test?.bags[0];
    expect(bag?.items.filter(Boolean).length).toBe(10);
  });

  it('as mochilas evoluem: bolsa → pequena → grande → militar', () => {
    const chain = ['pouch', 'small_backpack', 'large_backpack', 'military_backpack'];
    const slots = chain.map((id) => content.items[id]?.slots ?? 0);
    expect(slots).toEqual([5, 10, 20, 30]);
    for (let i = 1; i < chain.length; i++) {
      const recipe = content.recipes.find((r) => r.output === chain[i] && r.station !== 'trader');
      expect(recipe?.inputs.some((input) => input.item === chain[i - 1])).toBe(true);
    }
  });
});

describe('Talentos e perícia de recolha (§7.15)', () => {
  it('recolher treina a perícia de recolha; o lenhador dá mais força por golpe', () => {
    const { state, sim, tick } = setup();
    const player = state.data.player;
    player.level = 5;
    expect(sim.progression.learnTalent('lumberjack')).toBe('ok');
    player.facing = 'down';
    // À mão (6 de vida): força 1 + 1 do talento → 3 golpes.
    for (let i = 0; i < 3; i++) {
      sim.setActionHeld(true);
      sim.setActionHeld(false);
      tick(10);
    }
    expect(sim.interaction.isDepleted(7)).toBe(true);
    expect(player.skills.gathering).toBe(3);
    expect(sim.interaction.currentTarget(PLAYER_FOOTPRINT)).toBeNull();
  });

  it('correr: mais depressa, mas gasta muito mais fome e sede (menos com o Fôlego)', () => {
    const drain = (fôlego: boolean) => {
      const { state, sim, tick } = setup();
      const player = state.data.player;
      if (fôlego) {
        player.level = 20;
        for (const id of ['light_eater', 'fast_healer', 'sprint', 'sprint']) sim.progression.learnTalent(id);
        player.talents.light_eater = 0;
      }
      // Anda para um lado e para o outro (sem sair do mapa).
      const x0 = player.x;
      sim.setMoveIntent({ x: 1, y: 0 }, false, true);
      tick(20);
      const fast = player.x - x0;
      for (let i = 0; i < 60; i++) {
        sim.setMoveIntent({ x: i % 2 ? 1 : -1, y: 0 }, false, true);
        tick(20 * 2);
      }
      return { fast, used: 200 - player.hunger - player.thirst };
    };
    const run = drain(false);
    expect(run.fast).toBeGreaterThan(BALANCE.playerSpeed * 1.2);
    const calm = (() => {
      const { state, sim, tick } = setup();
      for (let i = 0; i < 60; i++) {
        sim.setMoveIntent({ x: i % 2 ? 1 : -1, y: 0 });
        tick(20 * 2);
      }
      return 200 - state.data.player.hunger - state.data.player.thirst;
    })();
    expect(run.used).toBeGreaterThan(calm * 3);
    expect(drain(true).used).toBeLessThan(run.used);
  });

  it('a fome desce mais devagar com o talento', () => {
    const { state, sim, tick } = setup();
    const player = state.data.player;
    tick(20 * 60 * 3);
    const normal = 100 - player.hunger;
    player.hunger = 100;
    player.thirst = 100;
    player.level = 5;
    sim.progression.learnTalent('light_eater');
    sim.progression.learnTalent('light_eater');
    tick(20 * 60 * 3);
    expect(100 - player.hunger).toBeLessThan(normal);
  });
});

import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../src/config';
import { darknessAt, isNight } from '../../src/core/DayNight';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { BASE_ZONE_ID, GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import { addXp, totalXpForLevel, xpToNext } from '../../src/systems/progression/progression';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import type { ZoneMap } from '../../src/world/zoneMap';
import { loadContent } from '../helpers/content';

const content = loadContent();
const curve = BALANCE.xpCurve;
const TICKS_PER_HOUR = (BALANCE.dayLengthSec * 1000) / FIXED_STEP_MS / 24;
/** Tick a uma dada hora do dia 1 (o jogo começa às dayStartHour). */
const tickAtHour = (hour: number): number =>
  Math.round(((hour - BALANCE.dayStartHour + 24) % 24) * TICKS_PER_HOUR);

function map(spawns: ZoneMap['enemySpawns'] = []): ZoneMap {
  const n = 20;
  return {
    width: n,
    height: n,
    tileSize: 16,
    solid: new Array<boolean>(n * n).fill(false),
    floor: new Array<boolean>(n * n).fill(false),
    playerSpawn: { x: 40, y: 40 },
    exits: [],
    resources: [{ id: 'tree_small', x: 40, y: 52, objectId: 3 }],
    props: [],
    chests: [],
    stations: [],
    containers: [],
    enemySpawns: spawns,
  };
}

function setup(zoneId = BASE_ZONE_ID, zone = map()) {
  const state = new GameState();
  state.newGame({ x: 40, y: 40 }, 3);
  const bus = new EventBus<GameEvents>();
  const levelUps: { level: number; unlocked: GameEvents['player:levelUp']['unlocked'] }[] = [];
  bus.on('player:levelUp', (e) => levelUps.push(e));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
  const enter = (at = zone) => {
    sim.setZone({
      zoneId,
      map: at,
      collision: CollisionWorld.fromZone(at, content.resources, content.props),
      ...content,
      nightEnemyMultiplier: 2,
    });
    sim.reset();
  };
  enter();
  return { state, sim, levelUps, enter };
}

describe('XP e níveis', () => {
  it('curva geométrica e subidas de vários níveis de uma vez', () => {
    expect(xpToNext(1, curve)).toBe(50);
    expect(xpToNext(2, curve)).toBe(63);
    const p = { level: 1, xp: 0 };
    expect(addXp(p, 120, curve, 30)).toEqual([2, 3]);
    expect(p).toEqual({ level: 3, xp: 7 });
    const max = { level: 29, xp: 0 };
    addXp(max, 1e9, curve, 30);
    expect(max).toEqual({ level: 30, xp: 0 });
    // Nível 10 ≈ 1300 XP: com ~7 XP por minuto, cerca de 3 h (§11, aceitação da Fase 8).
    expect(totalXpForLevel(10, curve)).toBeGreaterThan(1000);
    expect(totalXpForLevel(10, curve)).toBeLessThan(1600);
  });

  it('recolher dá XP e, ao subir de nível, diz o que ficou desbloqueado', () => {
    const { state, sim, levelUps } = setup();
    state.data.player.xp = 49;
    state.data.player.facing = 'down';
    for (let i = 0; i < 6; i++) {
      sim.setActionHeld(true);
      sim.setActionHeld(false);
      for (let t = 0; t < 10; t++) sim.update(FIXED_STEP_MS);
    }
    expect(state.data.player.level).toBe(2);
    expect(levelUps[0]?.level).toBe(2);
    expect(levelUps[0]?.unlocked.recipes).toContain('r_cloth_shirt');
    expect(levelUps[0]?.unlocked.structures).toEqual(expect.arrayContaining(['door_wood', 'torch']));
    expect(levelUps[0]?.unlocked.zones).toEqual(['zone_farm']);
  });

  it('receitas, peças e zonas acima do nível estão bloqueadas', () => {
    const { state, sim } = setup();
    state.data.player.inventory[0] = ['cloth', 10];
    state.data.player.inventory[1] = ['rope', 2];
    expect(sim.crafting.craft('r_cloth_shirt', null)).toBe('locked');
    expect(sim.progression.isZoneUnlocked('zone_farm')).toBe(false);
    expect(sim.progression.isZoneUnlocked('zone_pine_forest')).toBe(true);
    state.data.player.inventory[2] = ['wood_plank', 5];
    expect(sim.building.check('door_wood', 5, 5)).toBe('locked');
    state.data.player.level = 2;
    expect(sim.crafting.craft('r_cloth_shirt', null)).toBe('ok');
    expect(sim.building.check('door_wood', 5, 5)).not.toBe('locked');
  });

  it('uma nota ensina a receita antes do nível; lida outra vez, fica na mochila', () => {
    const { state, sim } = setup();
    const player = state.data.player;
    player.inventory[0] = ['note_machete', 1];
    player.inventory[1] = ['note_machete', 1];
    expect(sim.actions.use({ container: 'inventory', index: 0 })).toBe(true);
    expect(player.inventory[0]).toBeNull();
    expect(state.data.unlocks.recipes).toEqual(['r_machete']);
    const machete = content.recipes.find((r) => r.id === 'r_machete');
    if (!machete) throw new Error('sem machete');
    expect(sim.progression.isRecipeUnlocked(machete)).toBe(true);
    expect(sim.actions.use({ container: 'inventory', index: 1 })).toBe(false);
    expect(player.inventory[1]).toEqual(['note_machete', 1]);
  });
});

describe('Dia e noite', () => {
  it('escuro à meia-noite e às 4h, claro ao meio-dia, crepúsculo às 19h30', () => {
    expect(darknessAt(tickAtHour(12), BALANCE)).toBe(0);
    expect(darknessAt(tickAtHour(0), BALANCE)).toBe(BALANCE.nightDarkness);
    expect(darknessAt(tickAtHour(22), BALANCE)).toBe(BALANCE.nightDarkness);
    expect(darknessAt(tickAtHour(4), BALANCE)).toBe(BALANCE.nightDarkness);
    const dusk = darknessAt(tickAtHour(19.5), BALANCE);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(BALANCE.nightDarkness);
    expect(isNight(tickAtHour(6), BALANCE)).toBe(false);
    expect(isNight(tickAtHour(2), BALANCE)).toBe(true);
  });

  it('à noite há mais inimigos e aparecem os grupos só de noite', () => {
    const spawns = [
      { id: 'walker', x: 250, y: 250 },
      { id: 'wolf_night', x: 280, y: 280 },
    ];
    const day = setup('zone_lake', map(spawns));
    expect(day.sim.combat.list.map((e) => e.id)).toEqual(['zombie_walker']);
    const night = setup('zone_lake', map(spawns));
    night.state.data.world.tick = tickAtHour(0);
    night.enter(map(spawns));
    const ids = night.sim.combat.list.map((e) => e.id);
    expect(ids.filter((id) => id === 'zombie_walker')).toHaveLength(2); // 1 × 2
    expect(ids.filter((id) => id === 'wolf').length).toBeGreaterThanOrEqual(2);
  });
});

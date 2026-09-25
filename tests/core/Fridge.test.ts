import { describe, expect, it } from 'vitest';
import { gameHoursToTicks } from '../../src/core/Clock';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { BASE_ZONE_ID, GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import { talentOf } from '../../src/data/talents';
import { BUFF_EFFECTS } from '../../src/data/types';
import { TALENT_EFFECTS } from '../../src/systems/progression/talents';
import { loadContent } from '../helpers/content';

const content = loadContent();

function setup() {
  const state = new GameState();
  state.newGame({ x: 80, y: 80 }, 3);
  const bus = new EventBus<GameEvents>();
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
  sim.setRespawnPoint({ x: 100, y: 200 });
  return { state, sim, bus };
}

describe('Frigorífico e take-away (§7.17)', () => {
  it('os efeitos da comida são efeitos dos talentos', () => {
    for (const effect of BUFF_EFFECTS) expect(TALENT_EFFECTS).toContain(effect);
    expect(content.structures.fridge?.unlockLevel).toBe(15);
    expect(content.structures.fridge?.chestSlots).toBe(60);
  });

  it('encomendar paga em moedas e chega à porta de casa ao fim de 1 hora de jogo', () => {
    const { state, sim, bus } = setup();
    const player = state.data.player;
    player.level = 15;
    player.coins = 100;
    const arrived: string[] = [];
    bus.on('order:arrived', ({ item }) => arrived.push(item));
    const recipe = content.recipes.find((r) => r.id === 'order_pizza');
    if (!recipe) throw new Error('falta a receita');
    expect(sim.crafting.craft(recipe.id, 'takeaway_s7')).toBe('ok');
    expect(player.coins).toBe(100 - (recipe.inputs[0]?.qty ?? 0));
    const ticks = gameHoursToTicks(BALANCE.orderHours);
    sim.crafting.advance(ticks - 1);
    expect(arrived).toEqual([]);
    sim.crafting.advance(1);
    expect(arrived).toEqual(['pizza']);
    const bag = state.data.zones[BASE_ZONE_ID]?.bags[0];
    expect(bag?.items).toEqual([['pizza', 1]]);
    expect(bag?.x).toBe(100 + BALANCE.deliveryOffsetPx);
    expect(state.data.stations.takeaway_s7?.output.every((slot) => slot === null)).toBe(true);
    // Cancelar devolve as moedas.
    expect(sim.crafting.craft(recipe.id, 'takeaway_s7')).toBe('ok');
    expect(sim.crafting.cancel('takeaway_s7', 0)).toBe(true);
    expect(player.coins).toBe(100 - (recipe.inputs[0]?.qty ?? 0));
  });

  it('comida com efeito dá um bónus temporário (renova-se, não se acumula)', () => {
    const { state, sim } = setup();
    const player = state.data.player;
    const buff = content.items.pizza?.buff;
    if (!buff) throw new Error('a pizza devia ter efeito');
    const before = talentOf(player, buff.effect);
    player.inventory[0] = ['pizza', 2];
    expect(sim.actions.use({ container: 'inventory', index: 0 })).toBe(true);
    expect(sim.actions.use({ container: 'inventory', index: 0 })).toBe(true);
    expect(player.buffs).toHaveLength(1);
    expect(talentOf(player, buff.effect)).toBe(before + buff.value);
    state.data.world.tick += gameHoursToTicks(buff.hours) + 1;
    sim.actions.tickBuffs(state.data.world.tick);
    expect(player.buffs).toEqual([]);
    expect(talentOf(player, buff.effect)).toBe(before);
  });

  it('o frigorífico só aceita comida e bebida', () => {
    const { state, sim } = setup();
    sim.actions.chestRules = () => ({ slots: 60, foodOnly: true });
    const player = state.data.player;
    player.inventory[0] = ['stone', 5];
    player.inventory[1] = ['berries', 3];
    expect(sim.actions.container('chest:s1')).toHaveLength(60);
    expect(sim.actions.move({ container: 'inventory', index: 0 }, { container: 'chest:s1', index: 0 })).toBe(
      false,
    );
    expect(sim.actions.move({ container: 'inventory', index: 1 }, { container: 'chest:s1', index: 0 })).toBe(
      true,
    );
  });
});

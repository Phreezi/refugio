import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { BALANCE } from '../../src/data/balance';
import { weaponStats, armorPct } from '../../src/systems/combat/combat';
import { loadContent } from '../helpers/content';

const content = loadContent();

function setup() {
  const state = new GameState();
  state.newGame({ x: 80, y: 80 }, 3);
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('action:blocked', ({ reason, level }) => events.push(`${reason}:${String(level)}`));
  const sim = new Simulation(
    state,
    bus,
    () => content.items,
    () => content,
    () => content,
    () => content,
  );
  return { state, sim, events };
}

describe('Economia (§7.16)', () => {
  it('nível mínimo para equipar', () => {
    const { state, sim, events } = setup();
    const player = state.data.player;
    player.inventory[0] = ['machete', 1, 100];
    expect(sim.actions.equip({ container: 'inventory', index: 0 })).toBe(false);
    expect(events).toEqual([`needs_level:${String(content.items.machete?.level)}`]);
    player.level = 10;
    expect(sim.actions.equip({ container: 'inventory', index: 0 })).toBe(true);
  });

  it('encantar custa moedas (o dobro a cada nível) e dá mais dano e defesa', () => {
    const { state, sim } = setup();
    const player = state.data.player;
    player.level = 10;
    player.equipment[0] = ['machete', 1, 100];
    player.equipment[2] = ['cloth_shirt', 1, 150];
    player.coins = 100;
    const weapon = { container: 'equipment' as const, index: 0 };
    const base = weaponStats(player.equipment, content.items, BALANCE).damage;
    expect(sim.actions.enchantCost(weapon)).toBe(BALANCE.enchantCostBase);
    expect(sim.actions.enchant(weapon)).toBe('ok');
    expect(sim.actions.enchant(weapon)).toBe('ok');
    expect(player.equipment[0]).toEqual(['machete', 1, 100, 2]);
    expect(player.coins).toBe(100 - BALANCE.enchantCostBase * 3);
    expect(weaponStats(player.equipment, content.items, BALANCE).damage).toBeGreaterThan(base);
    const armorBefore = armorPct(player.equipment, content.items, 100, BALANCE.enchantArmor);
    expect(sim.actions.enchant({ container: 'equipment', index: 2 })).toBe('ok');
    expect(armorPct(player.equipment, content.items, 100, BALANCE.enchantArmor)).toBe(
      armorBefore + BALANCE.enchantArmor,
    );
    player.inventory[0] = null;
    expect(sim.actions.enchant(weapon)).toBe('no_coins');
    expect(sim.actions.enchant({ container: 'inventory', index: 1 })).toBe('invalid');
  });

  it('repor os talentos devolve os pontos e custa moedas', () => {
    const { state, sim } = setup();
    const player = state.data.player;
    player.level = 5;
    sim.progression.learnTalent('strong_arm');
    sim.progression.learnTalent('strong_arm');
    const cost = sim.progression.talentResetCost();
    expect(cost).toBe(2 * BALANCE.talentResetCostPerPoint);
    expect(sim.progression.resetTalents()).toBe('no_coins');
    player.coins = cost;
    expect(sim.progression.resetTalents()).toBe('ok');
    expect(player.talents).toEqual({});
    expect(player.coins).toBe(0);
  });

  it('a banca de comércio compra e vende por moedas', () => {
    const buy = content.recipes.find((r) => r.id === 'buy_health_potion');
    const sell = content.recipes.find((r) => r.id === 'sell_wood');
    expect(buy?.station).toBe('market_stall');
    expect(buy?.inputs[0]?.item).toBe('coin');
    expect(sell?.output).toBe('coin');
    // Os inimigos dão moedas.
    expect(content.enemies.zombie_walker?.drops.some((d) => d.item === 'coin')).toBe(true);
  });

  it('moedas são um contador: apanhar, vender e comprar sem ocupar slots', () => {
    const { state, sim } = setup();
    const player = state.data.player;
    player.inventory.fill(['stone', 50]); // mochila cheia: as moedas entram na mesma
    player.hotbar.fill(['stone', 50]);
    expect(sim.actions.give('coin', 7)).toBe(0);
    expect(player.coins).toBe(7);
    // Moedas arrastadas para um slot passam para o contador no tick seguinte.
    player.inventory[0] = ['coin', 3];
    sim.actions.sweepCoins();
    expect(player.inventory[0]).toBeNull();
    expect(player.coins).toBe(10);
    // Vender dá moedas ao contador; comprar tira de lá.
    player.inventory[0] = ['wood', 50];
    const sell = content.recipes.find((r) => r.id === 'sell_wood');
    const buy = content.recipes.find((r) => r.id === 'buy_health_potion');
    if (!sell || !buy) throw new Error('faltam receitas');
    player.level = 50;
    expect(sim.crafting.craft(sell.id, 'market_stall_s1')).toBe('ok');
    expect(player.coins).toBe(10 + sell.qty);
    player.inventory[1] = null;
    player.coins = 1000;
    expect(sim.crafting.craft(buy.id, 'market_stall_s1')).toBe('ok');
    expect(player.coins).toBe(1000 - (buy.inputs[0]?.qty ?? 0));
  });
});

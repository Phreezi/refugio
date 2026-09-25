import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import { GameState } from '../../src/core/GameState';
import { Simulation } from '../../src/core/Simulation';
import { countItem } from '../../src/systems/inventory/inventory';
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
    () => content,
    () => content,
  );
  return { state, sim, bus };
}

describe('Missões e NPCs (§7.18)', () => {
  it('a cadeia começa no Sr. Tomé e cada missão só abre depois da anterior', () => {
    const { sim } = setup();
    expect(sim.quests.offers('old_man').map((q) => q.id)).toEqual(['q_welcome']);
    expect(sim.quests.offers('farmer')).toEqual([]);
    // Todos os NPCs com missões têm algo a dizer (e as missões apontam para NPCs nos mapas).
    for (const quest of content.quests) expect(content.npcs[quest.giver]).toBeDefined();
  });

  it('falar, recolher, derrotar e ir a: progresso, entrega e recompensa', () => {
    const { state, sim, bus } = setup();
    const player = state.data.player;
    // Falar com o mercador.
    expect(sim.quests.accept('q_welcome')).toBe(true);
    expect(sim.quests.turnIn('q_welcome')).toBe('not_ready');
    bus.emit('npc:talk', { npc: 'merchant' });
    expect(sim.quests.ready('q_welcome')).toBe(true);
    const coins = player.coins;
    expect(sim.quests.turnIn('q_welcome')).toBe('ok');
    expect(player.coins).toBe(coins + (content.quests[0]?.reward.coins ?? 0));
    expect(player.quests.done).toEqual(['q_welcome']);
    // Recolher: os itens saem da mochila ao entregar; a recompensa entra.
    expect(sim.quests.accept('q_supplies')).toBe(true);
    player.inventory[0] = ['wood', 20];
    player.inventory[1] = ['stone', 10];
    expect(sim.quests.progress('q_supplies')).toEqual([
      [15, 15],
      [10, 10],
    ]);
    expect(sim.quests.turnIn('q_supplies')).toBe('ok');
    expect(countItem([player.inventory], 'wood')).toBe(5);
    expect(countItem([player.inventory, player.hotbar], 'travel_scroll')).toBe(1);
    // Ir a uma zona e derrotar inimigos (os eventos contam).
    expect(sim.quests.accept('q_pine')).toBe(true);
    sim.quests.visit('zone_pine_forest');
    for (let i = 0; i < 4; i++) bus.emit('enemy:killed', { uid: i, enemy: 'zombie_walker', x: 0, y: 0 });
    bus.emit('enemy:killed', { uid: 9, enemy: 'wolf', x: 0, y: 0 });
    expect(sim.quests.progress('q_pine')).toEqual([
      [1, 1],
      [4, 5],
    ]);
    bus.emit('enemy:killed', { uid: 5, enemy: 'zombie_walker', x: 0, y: 0 });
    expect(sim.quests.ready('q_pine')).toBe(true);
    const level = player.level;
    expect(sim.quests.turnIn('q_pine')).toBe('ok');
    expect(player.level >= level).toBe(true);
    // A seguinte entrega-se a outra pessoa (a agricultora) e pede nível 2.
    player.level = 2;
    expect(sim.quests.offers('old_man').map((q) => q.id)).toEqual(['q_find_farmer']);
    expect(sim.quests.accept('q_find_farmer')).toBe(true);
    expect(sim.quests.handIns('farmer').map((q) => q.id)).toEqual(['q_find_farmer']);
  });

  it('o mercador vende pergaminhos de viagem', () => {
    const { state, sim } = setup();
    state.data.player.coins = 100;
    expect(sim.crafting.craft('m_buy_travel_scroll', 'merchant_npc')).toBe('ok');
    expect(countItem([state.data.player.inventory, state.data.player.hotbar], 'travel_scroll')).toBe(1);
  });
});

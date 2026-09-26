import { gameState } from '../core/GameState';
import type { Simulation } from '../core/Simulation';
import { HANDS, isTradeCategory, type Recipe } from '../data/types';
import { itemName, t, tKey } from '../i18n';
import { stationType } from '../core/Crafting';
import { missingInputs } from '../systems/crafting/crafting';
import { content } from '../world/content';
import { ownedCount } from './itemInfo';

// Ajuda sobre um material (pedido do jogador): tocar num ingrediente em falta faz-o ali mesmo,
// se der (nas mãos ou na estação aberta), ou diz onde se arranja — receitas, inimigos que o
// deixam cair, recursos, contentores e lojas.

/** Linhas de texto com as formas de arranjar `item`. */
export function sourcesOf(item: string): string[] {
  const lines: string[] = [];
  const list = (names: string[]): string => [...new Set(names)].slice(0, 4).join(', ');

  const crafts = content.recipes.filter(
    (r) => r.output === item && !isTradeCategory(r.category) && r.station !== 'takeaway',
  );
  for (const recipe of crafts.slice(0, 2)) {
    const place = recipe.station === HANDS ? t('src.hands') : tKey(`station.${recipe.station}`);
    const inputs = recipe.inputs.map((i) => `${String(i.qty)} ${itemName(i.item)}`).join(', ');
    lines.push(t('src.craft', { place, inputs }));
  }
  const drops = Object.entries(content.enemies)
    .filter(([, def]) => def.drops.some((d) => d.item === item))
    .map(([id]) => tKey(`enemy.${id}`));
  if (drops.length > 0) lines.push(t('src.drop', { list: list(drops) }));
  const resources = Object.entries(content.resources)
    .filter(([, def]) => def.drops.some((d) => d.item === item) || def.bonus?.some((b) => b.item === item))
    .map(([id]) => tKey(`src.res.${id}`));
  if (resources.length > 0) lines.push(t('src.gather', { list: list(resources) }));
  const loot = Object.entries(content.lootTables)
    .filter(([id, def]) => id !== 'horde_reward' && def.entries.some((e) => e.item === item))
    .map(([id]) => tKey(`src.loot.${id}`));
  if (loot.length > 0) lines.push(t('src.loot', { list: list(loot) }));
  const shops = content.recipes
    .filter((r) => r.output === item && r.category === 'buy')
    .map((r) => tKey(`station.${r.station}`));
  if (shops.length > 0) lines.push(t('src.buy', { list: list(shops) }));
  if (lines.length === 0) lines.push(t('src.none'));
  return lines;
}

/** Receita que faz `item` aqui (nas mãos ou na estação `stationKey`), desbloqueada e com tudo. */
export function craftableHere(sim: Simulation, item: string, stationKey: string | null): Recipe | null {
  const here = stationKey ? stationType(stationKey) : null;
  const containers = sim.actions.pickupContainers();
  return (
    content.recipes.find(
      (r) =>
        r.output === item &&
        !isTradeCategory(r.category) &&
        (r.station === HANDS || r.station === here) &&
        sim.progression.isRecipeUnlocked(r) &&
        missingInputs(containers, r, gameState.data.player).length === 0,
    ) ?? null
  );
}

/**
 * Tocar num material: se der para o fazer aqui, faz 1 (nas mãos é logo; numa estação vai para a
 * fila); senão, diz onde se arranja. @returns o texto a mostrar.
 */
export function tapMaterial(sim: Simulation, item: string, stationKey: string | null): string {
  const recipe = craftableHere(sim, item, stationKey);
  if (recipe) {
    const result = sim.crafting.craft(recipe.id, recipe.station === HANDS ? null : stationKey);
    if (result === 'ok')
      return t('src.made', {
        qty: recipe.qty,
        item: itemName(item),
        total: ownedCount(gameState.data.player, item),
      });
    if (result === 'no_space') return t('msg.inventory_full');
  }
  return [`${itemName(item)} · ${t('src.title')}`, ...sourcesOf(item)].join('\n');
}

import { BALANCE } from '../data/balance';
import { talentOf } from '../data/talents';
import { gameState, type PlayerState } from '../core/GameState';
import { skillOf, type ItemDef } from '../data/types';
import { itemName, t, tKey, type MessageKey } from '../i18n';
import { missPct, skillLevel } from '../systems/combat/skills';

/**
 * O que um item faz, em linhas curtas (tocar no desenho ou no nome, no fabrico e na mochila):
 * dano e rapidez das armas, alcance, defesa, efeitos ao comer/beber, durabilidade, espaço…
 */
export function describeItem(id: string, def: ItemDef | undefined): string[] {
  if (!def) return [itemName(id)];
  const lines: string[] = [];
  const add = (key: MessageKey, vars: Record<string, string | number> = {}): void => {
    lines.push(t(key, vars));
  };
  if (def.damage !== undefined) {
    add('info.damage', { n: def.damage });
    const sec = def.attackSec ?? BALANCE.weaponAttackSec;
    add('info.speed', { n: (Math.round((1 / sec) * 10) / 10).toFixed(1) });
    if (def.ranged)
      add('info.range', { n: Math.round(def.ranged.range / 16), ammo: itemName(def.ranged.ammo) });

    const skill = skillOf(def);
    const level = gameState.hasGame ? skillLevel(gameState.data.player.skills[skill] ?? 0, BALANCE) : 1;
    add('info.skill', {
      skill: tKey(`skill.${skill}`),
      level,
      miss: Math.round(
        Math.max(
          BALANCE.missPctMin,
          missPct(level, def.ranged !== undefined, BALANCE) -
            (gameState.hasGame ? talentOf(gameState.data.player, 'missPts') : 0),
        ),
      ),
    });
  }
  if (def.toolKind && def.gatherPower !== undefined)
    add(def.toolKind === 'axe' ? 'info.axe' : 'info.pickaxe', { n: def.gatherPower });
  if (def.armor !== undefined) add('info.armor', { n: def.armor });
  if (def.slots !== undefined) add('info.slots', { n: def.slots });
  const effects = def.effects;
  if (effects?.hp) add('info.hp', { n: effects.hp });
  if (effects?.hunger) add('info.hunger', { n: effects.hunger });
  if (effects?.thirst) add('info.thirst', { n: effects.thirst });
  if (def.stopsBleeding) add('info.bleed');
  if (def.plant) add('info.plant', { item: itemName(def.plant.crop), h: def.plant.growHours });
  if (def.waters) add('info.waters');
  if (def.teaches) add('info.note');
  if (def.type === 'ammo') {
    add('info.ammo');
    if (def.ammoDamage) add('info.ammo_damage', { n: def.ammoDamage });
    if (def.breakPct !== undefined) add('info.break', { n: def.breakPct });
  }
  if (def.durability !== undefined) add('info.durability', { n: def.durability });
  if (lines.length === 0) add(def.type === 'resource' ? 'info.material' : 'info.none');
  return lines;
}

/** Quantos `item` o jogador tem (mochila, hotbar e aljava). */
export function ownedCount(player: PlayerState, item: string): number {
  let total = 0;
  for (const container of [player.inventory, player.hotbar])
    for (const slot of container) if (slot?.[0] === item) total += slot[1];
  for (const [id, qty] of player.quiver) if (id === item) total += qty;
  return total;
}

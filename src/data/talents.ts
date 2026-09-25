import {
  parseTalents,
  talentValue,
  type TalentDefs,
  type TalentEffect,
  type Talents,
} from '../systems/progression/talents';
import talentsJson from './talents.json';

/** Talentos (validados ao importar: um erro nos dados impede o arranque com uma mensagem clara). */
export const TALENTS: TalentDefs = parseTalents(talentsJson);

/**
 * Soma de um efeito nos talentos do jogador e nos efeitos temporários da comida (§7.17; os que
 * acabaram saem a cada tick).
 */
export function talentOf(
  player: { talents: Talents; buffs?: readonly (readonly [TalentEffect, number, number])[] },
  effect: TalentEffect,
): number {
  let total = talentValue(player.talents, effect, TALENTS);
  for (const [buffEffect, value] of player.buffs ?? []) if (buffEffect === effect) total += value;
  return total;
}

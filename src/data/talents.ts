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

/** Soma de um efeito nos talentos do jogador. */
export function talentOf(player: { talents: Talents }, effect: TalentEffect): number {
  return talentValue(player.talents, effect, TALENTS);
}

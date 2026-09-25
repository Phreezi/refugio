import type { WeaponSkill } from '../../data/types';
import { totalXpForLevel, type XpCurve } from '../progression/progression';

// Perícias de combate (CLAUDE.md §7.8), lógica pura: cada golpe ou tiro com uma arma dá 1 de
// experiência à sua perícia (punhos, impacto, lâminas, arco, armas de fogo); quanto mais alta,
// menos se falha.

export interface SkillBalance {
  skillCurve: XpCurve;
  skillMaxLevel: number;
  missPctMelee: number;
  missPctRanged: number;
  missPctPerLevel: number;
  /** À distância desce mais depressa (começa muito mais alto). */
  missPctPerLevelRanged: number;
  missPctMin: number;
}

/** Experiência total de cada perícia (as que nunca se usaram não aparecem). */
export type Skills = Partial<Record<WeaponSkill, number>>;

/** Nível (1 … máximo) a partir da experiência total. */
export function skillLevel(xp: number, balance: SkillBalance): number {
  let level = 1;
  while (level < balance.skillMaxLevel && xp >= totalXpForLevel(level + 1, balance.skillCurve)) level++;
  return level;
}

/** % de falhar um golpe ou tiro com esta perícia neste nível. */
export function missPct(level: number, ranged: boolean, balance: SkillBalance): number {
  const base = ranged ? balance.missPctRanged : balance.missPctMelee;
  const perLevel = ranged ? balance.missPctPerLevelRanged : balance.missPctPerLevel;
  return Math.max(balance.missPctMin, base - (level - 1) * perLevel);
}

/**
 * Soma 1 de experiência à perícia.
 * @returns o nível novo, se subiu (senão null).
 */
export function trainSkill(skills: Skills, skill: WeaponSkill, balance: SkillBalance): number | null {
  const before = skills[skill] ?? 0;
  const level = skillLevel(before, balance);
  if (level >= balance.skillMaxLevel) return null;
  skills[skill] = before + 1;
  const after = skillLevel(before + 1, balance);
  return after > level ? after : null;
}

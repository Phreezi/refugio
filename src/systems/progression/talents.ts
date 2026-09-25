// Árvore de talentos (CLAUDE.md §7.15), lógica pura: cada nível do jogador dá 1 ponto, que se
// gasta em talentos passivos (mais dano, menos fome…) ou ativos (correr). Os dados vêm de
// `talents.json`; aqui só se valida, se somam os efeitos e se decide se um talento se aprende.

export const TALENT_BRANCHES = ['combat', 'survival', 'crafts'] as const;
export type TalentBranch = (typeof TALENT_BRANCHES)[number];

export const TALENT_EFFECTS = [
  'meleeDamagePct',
  'missPts',
  'armorPct',
  'hungerSlowPct',
  'thirstSlowPct',
  'regenPct',
  'sprint',
  'gatherPower',
  'extraDropPct',
  'wearSavePct',
  'craftSpeedPct',
] as const;
export type TalentEffect = (typeof TALENT_EFFECTS)[number];

export interface TalentDef {
  branch: TalentBranch;
  effect: TalentEffect;
  /** Valor do efeito por ponto. */
  perRank: number;
  maxRank: number;
  /** Nível mínimo do jogador. */
  level: number;
  /** Outro talento com pelo menos estes pontos. */
  requires?: readonly [string, number];
}

export type TalentDefs = Readonly<Record<string, TalentDef>>;
/** Pontos gastos em cada talento (save `player.talents`). */
export type Talents = Record<string, number>;

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valida `talents.json` (lança um erro com todos os problemas). */
export function parseTalents(input: unknown): TalentDefs {
  if (!isObject(input)) throw new Error('talents.json inválido: tem de ser um objeto id → talento');
  const problems: string[] = [];
  const defs: Record<string, TalentDef> = {};
  for (const [id, raw] of Object.entries(input)) {
    if (id === '$comment') continue;
    if (!ID_PATTERN.test(id)) problems.push(`"${id}": o id tem de estar em snake_case`);
    if (!isObject(raw)) {
      problems.push(`"${id}": tem de ser um objeto`);
      continue;
    }
    const branch = TALENT_BRANCHES.find((b) => b === raw.branch);
    const effect = TALENT_EFFECTS.find((e) => e === raw.effect);
    if (!branch) problems.push(`"${id}": branch desconhecido (${TALENT_BRANCHES.join(', ')})`);
    if (!effect) problems.push(`"${id}": effect desconhecido (${TALENT_EFFECTS.join(', ')})`);
    for (const key of ['perRank', 'maxRank', 'level'] as const)
      if (!isPositiveInt(raw[key])) problems.push(`"${id}": ${key} tem de ser um inteiro > 0`);
    let requires: [string, number] | undefined;
    if (raw.requires !== undefined) {
      const [other, rank] = Array.isArray(raw.requires) ? (raw.requires as unknown[]) : [];
      if (typeof other !== 'string' || !isPositiveInt(rank))
        problems.push(`"${id}": requires = [talento, pontos]`);
      else requires = [other, rank];
    }
    if (!branch || !effect) continue;
    defs[id] = {
      branch,
      effect,
      perRank: isPositiveInt(raw.perRank) ? raw.perRank : 1,
      maxRank: isPositiveInt(raw.maxRank) ? raw.maxRank : 1,
      level: isPositiveInt(raw.level) ? raw.level : 1,
      ...(requires ? { requires } : {}),
    };
  }
  for (const [id, def] of Object.entries(defs)) {
    if (!def.requires) continue;
    const other = defs[def.requires[0]];
    if (!other) problems.push(`"${id}": requires um talento que não existe ("${def.requires[0]}")`);
    else if (def.requires[1] > other.maxRank) problems.push(`"${id}": requires mais pontos do que o máximo`);
    else if (other.branch !== def.branch) problems.push(`"${id}": requires um talento de outro ramo`);
  }
  if (problems.length > 0) throw new Error(`talents.json inválido:\n- ${problems.join('\n- ')}`);
  return defs;
}

/** Soma do efeito em todos os talentos aprendidos. */
export function talentValue(talents: Talents, effect: TalentEffect, defs: TalentDefs): number {
  let total = 0;
  for (const [id, rank] of Object.entries(talents)) {
    const def = defs[id];
    if (def?.effect === effect) total += def.perRank * Math.min(rank, def.maxRank);
  }
  return total;
}

/** Pontos por gastar: 1 por nível acima do 1, menos os gastos. */
export function talentPoints(level: number, talents: Talents): number {
  const spent = Object.values(talents).reduce((sum, rank) => sum + rank, 0);
  return Math.max(0, level - 1 - spent);
}

export type LearnCheck = 'ok' | 'unknown' | 'max' | 'no_points' | 'level' | 'requires';

/** Pode aprender mais 1 ponto no talento `id`? */
export function canLearn(id: string, level: number, talents: Talents, defs: TalentDefs): LearnCheck {
  const def = defs[id];
  if (!def) return 'unknown';
  if ((talents[id] ?? 0) >= def.maxRank) return 'max';
  if (talentPoints(level, talents) <= 0) return 'no_points';
  if (level < def.level) return 'level';
  if (def.requires && (talents[def.requires[0]] ?? 0) < def.requires[1]) return 'requires';
  return 'ok';
}

/** Aprende 1 ponto (se puder). */
export function learnTalent(id: string, level: number, talents: Talents, defs: TalentDefs): LearnCheck {
  const check = canLearn(id, level, talents, defs);
  if (check === 'ok') talents[id] = (talents[id] ?? 0) + 1;
  return check;
}

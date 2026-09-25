// NPCs, missões e postes a reparar (CLAUDE.md §7.18), lógica pura: tipos, validação dos dados
// (`npcs.json`, `quests.json`, `waystones.json`) e o progresso dos objetivos. O estado (missões
// ativas e feitas) está no save (`quests`); a classe core/Quests.ts liga isto aos eventos.

export type NpcRole = 'quests' | 'shop' | 'waystone';

/** Caixa sólida dos pés de um NPC (px). */
export const NPC_FOOTPRINT = { width: 10, height: 6 } as const;

export interface NpcDef {
  /** Textura (16×32, pés ao meio da base). */
  sprite: string;
  role: NpcRole;
  /** Loja (papel `shop`): estação com as trocas (receitas `buy`/`sell`). */
  shop?: string;
}
export type NpcDefs = Readonly<Record<string, NpcDef>>;

/** Objetivos: recolher (entrega-se ao fim), ir a uma zona, falar com alguém, derrotar inimigos. */
export type QuestGoal =
  | { type: 'collect'; item: string; qty: number }
  | { type: 'reach'; zone: string }
  | { type: 'talk'; npc: string }
  | { type: 'kill'; enemy: string; qty: number };

export interface QuestReward {
  xp: number;
  coins: number;
  items: readonly [string, number][];
}

export interface QuestDef {
  id: string;
  /** Quem dá a missão (e a quem se entrega, se não houver `turnIn`). */
  giver: string;
  turnIn: string;
  /** Nível mínimo e missão anterior (a cadeia principal). */
  level: number;
  after?: string;
  goals: readonly QuestGoal[];
  reward: QuestReward;
}

/** Reparar o poste de uma zona: o que o técnico pede. */
export interface WaystoneCost {
  items: readonly [string, number][];
  coins: number;
}

/** Save: missões ativas (progresso de cada objetivo: contagem ou 1/0) e feitas. */
export interface QuestState {
  active: Record<string, number[]>;
  done: string[];
}

export class QuestDataError extends Error {
  readonly problems: readonly string[];
  constructor(file: string, problems: readonly string[]) {
    super(`${file} inválido:\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

const ID = /^[a-z][a-z0-9_]*$/;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function itemList(
  raw: unknown,
  items: ReadonlySet<string>,
  where: string,
  problems: string[],
): [string, number][] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push(`${where}: tem de ser [[item, qtd], …]`);
    return [];
  }
  const out: [string, number][] = [];
  for (const entry of raw as unknown[]) {
    const [item, qty] = Array.isArray(entry) ? (entry as unknown[]) : [];
    if (typeof item !== 'string' || !items.has(item))
      problems.push(`${where}: item desconhecido ${String(item)}`);
    else if (!isPositiveInt(qty)) problems.push(`${where}: quantidade de ${item} inválida`);
    else out.push([item, qty]);
  }
  return out;
}

export function parseNpcs(input: unknown, sprites: Iterable<string>, stations: Iterable<string>): NpcDefs {
  if (!isObject(input)) throw new QuestDataError('npcs.json', ['tem de ser um objeto id → NPC']);
  const spriteSet = new Set(sprites);
  const stationSet = new Set(stations);
  const problems: string[] = [];
  const defs: Record<string, NpcDef> = {};
  for (const [id, raw] of Object.entries(input)) {
    if (id === '$comment') continue;
    if (!ID.test(id) || !isObject(raw)) {
      problems.push(`"${id}": id em snake_case e um objeto`);
      continue;
    }
    const sprite = typeof raw.sprite === 'string' ? raw.sprite : '';
    if (!spriteSet.has(sprite)) problems.push(`"${id}": sprite "${sprite}" não existe no manifest`);
    const role = (['quests', 'shop', 'waystone'] as const).find((r) => r === raw.role);
    if (!role) problems.push(`"${id}": role tem de ser quests, shop ou waystone`);
    const def: NpcDef = { sprite, role: role ?? 'quests' };
    if (raw.shop !== undefined) {
      if (typeof raw.shop === 'string' && stationSet.has(raw.shop)) def.shop = raw.shop;
      else problems.push(`"${id}": shop com estação desconhecida`);
    }
    if (def.role === 'shop' && !def.shop) problems.push(`"${id}": uma loja precisa de shop`);
    defs[id] = def;
  }
  if (problems.length > 0) throw new QuestDataError('npcs.json', problems);
  return defs;
}

export interface QuestRefs {
  items: Iterable<string>;
  npcs: Iterable<string>;
  zones: Iterable<string>;
  enemies: Iterable<string>;
}

export function parseQuests(input: unknown, refs: QuestRefs): readonly QuestDef[] {
  if (!Array.isArray(input)) throw new QuestDataError('quests.json', ['tem de ser uma lista']);
  const items = new Set(refs.items);
  const npcs = new Set(refs.npcs);
  const zones = new Set(refs.zones);
  const enemies = new Set(refs.enemies);
  const problems: string[] = [];
  const quests: QuestDef[] = [];
  const seen = new Set<string>();
  for (const raw of input as unknown[]) {
    if (!isObject(raw)) {
      problems.push('cada missão tem de ser um objeto');
      continue;
    }
    const id = typeof raw.id === 'string' ? raw.id : '';
    const where = `"${id}"`;
    if (!ID.test(id) || seen.has(id)) problems.push(`${where}: id inválido ou repetido`);
    seen.add(id);
    const giver = typeof raw.giver === 'string' ? raw.giver : '';
    if (!npcs.has(giver)) problems.push(`${where}: giver desconhecido "${giver}"`);
    const turnIn = typeof raw.turnIn === 'string' ? raw.turnIn : giver;
    if (!npcs.has(turnIn)) problems.push(`${where}: turnIn desconhecido "${turnIn}"`);
    const level = raw.level ?? 1;
    if (!isPositiveInt(level)) problems.push(`${where}: level tem de ser > 0`);
    const goals: QuestGoal[] = [];
    if (!Array.isArray(raw.goals) || raw.goals.length === 0) problems.push(`${where}: goals vazio`);
    for (const g of (Array.isArray(raw.goals) ? raw.goals : []) as unknown[]) {
      if (!isObject(g)) continue;
      if (g.type === 'collect' && typeof g.item === 'string' && items.has(g.item) && isPositiveInt(g.qty))
        goals.push({ type: 'collect', item: g.item, qty: g.qty });
      else if (g.type === 'reach' && typeof g.zone === 'string' && zones.has(g.zone))
        goals.push({ type: 'reach', zone: g.zone });
      else if (g.type === 'talk' && typeof g.npc === 'string' && npcs.has(g.npc))
        goals.push({ type: 'talk', npc: g.npc });
      else if (
        g.type === 'kill' &&
        typeof g.enemy === 'string' &&
        (g.enemy === 'any' || enemies.has(g.enemy)) &&
        isPositiveInt(g.qty)
      )
        goals.push({ type: 'kill', enemy: g.enemy, qty: g.qty });
      else problems.push(`${where}: objetivo inválido ${JSON.stringify(g)}`);
    }
    const reward = isObject(raw.reward) ? raw.reward : {};
    const xp = reward.xp ?? 0;
    const coins = reward.coins ?? 0;
    if (!isCount(xp) || !isCount(coins)) problems.push(`${where}: reward.xp/coins inteiros ≥ 0`);
    const quest: QuestDef = {
      id,
      giver,
      turnIn,
      level: isPositiveInt(level) ? level : 1,
      goals,
      reward: {
        xp: isCount(xp) ? xp : 0,
        coins: isCount(coins) ? coins : 0,
        items: itemList(reward.items, items, `${where} reward.items`, problems),
      },
    };
    if (raw.after !== undefined) {
      if (typeof raw.after === 'string') quest.after = raw.after;
      else problems.push(`${where}: after tem de ser o id de uma missão`);
    }
    quests.push(quest);
  }
  for (const q of quests)
    if (q.after && !seen.has(q.after)) problems.push(`"${q.id}": after desconhecido "${q.after}"`);
  if (problems.length > 0) throw new QuestDataError('quests.json', problems);
  return quests;
}

export function parseWaystoneCosts(
  input: unknown,
  items: Iterable<string>,
  zones: Iterable<string>,
): Readonly<Record<string, WaystoneCost>> {
  if (!isObject(input)) throw new QuestDataError('waystones.json', ['tem de ser um objeto zona → custo']);
  const itemSet = new Set(items);
  const zoneSet = new Set(zones);
  const problems: string[] = [];
  const out: Record<string, WaystoneCost> = {};
  for (const [zone, raw] of Object.entries(input)) {
    if (zone === '$comment') continue;
    if (!zoneSet.has(zone) || !isObject(raw)) {
      problems.push(`"${zone}": zona desconhecida ou não é um objeto`);
      continue;
    }
    const coins = raw.coins ?? 0;
    if (!isCount(coins)) problems.push(`"${zone}": coins inteiro ≥ 0`);
    out[zone] = {
      items: itemList(raw.items, itemSet, `"${zone}" items`, problems),
      coins: isCount(coins) ? coins : 0,
    };
  }
  if (problems.length > 0) throw new QuestDataError('waystones.json', problems);
  return out;
}

/** Estado inicial (jogo novo e migração). */
export function emptyQuestState(): QuestState {
  return { active: {}, done: [] };
}

/**
 * Progresso de um objetivo: [feito, total]. Recolher conta o que se tem agora (`have`); os
 * outros vêm do save (contagens ou 1 = feito).
 */
export function goalProgress(
  goal: QuestGoal,
  saved: number,
  have: (item: string) => number,
): [number, number] {
  if (goal.type === 'collect') return [Math.min(goal.qty, have(goal.item)), goal.qty];
  if (goal.type === 'kill') return [Math.min(goal.qty, saved), goal.qty];
  return [saved > 0 ? 1 : 0, 1];
}

export function questComplete(
  quest: QuestDef,
  saved: readonly number[],
  have: (item: string) => number,
): boolean {
  return quest.goals.every((goal, i) => {
    const [done, total] = goalProgress(goal, saved[i] ?? 0, have);
    return done >= total;
  });
}

/** Missão que se pode aceitar agora? (nível, a anterior feita, ainda não aceite nem feita) */
export function questAvailable(quest: QuestDef, state: QuestState, level: number): boolean {
  if (state.done.includes(quest.id) || quest.id in state.active) return false;
  if (level < quest.level) return false;
  return !quest.after || state.done.includes(quest.after);
}

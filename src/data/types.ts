// Tipos dos JSON de conteúdo (CLAUDE.md §5.3) e a sua validação.
// Módulo puro: também é usado por scripts/validate-data.ts, por isso não importa nada em runtime.

export interface Footprint {
  width: number;
  height: number;
}

/** Objeto do mundo com sprite e (opcional) caixa sólida: recursos e obstáculos/decoração. */
export interface WorldObjectDef {
  /** Chave de textura no manifest de assets. */
  sprite: string;
  /** Caixa sólida na base do sprite, centrada nos pés. Omisso = atravessável. */
  footprint?: Footprint;
}

export type ToolKind = 'axe' | 'pickaxe';
export const TOOL_KINDS: readonly ToolKind[] = ['axe', 'pickaxe'];

export interface Drop {
  item: string;
  min: number;
  max: number;
}

/** Nó de recurso (CLAUDE.md §7.4): árvore, pedra, arbusto… */
export interface ResourceDef extends WorldObjectDef {
  /** Vida: golpes à mão (poder 1). Com a ferramenta certa, cada golpe tira `gatherPower`. */
  hp: number;
  /** Ferramenta que acelera a recolha. */
  tool?: ToolKind;
  /** Sem a ferramenta não se consegue recolher (ex.: árvore grande, filão de ferro). */
  toolRequired: boolean;
  drops: readonly Drop[];
  /** Segundos de jogo até reaparecer depois de recolhido. */
  respawnSec: number;
  /** XP ao apanhar (omisso = `xpGather`). */
  xp?: number;
}

export type ResourceDefs = Readonly<Record<string, ResourceDef>>;
export type PropAction = 'drink' | 'fish';
const PROP_ACTIONS: readonly PropAction[] = ['drink', 'fish'];

/** Obstáculo/decoração; alguns têm uma ação contextual (ex.: beber no poço). */
export interface PropDef extends WorldObjectDef {
  action?: PropAction;
}

/** Obstáculos e decoração (`props.json`): troncos, caixotes, carros abandonados… */
export type PropDefs = Readonly<Record<string, PropDef>>;

export type ItemType =
  'resource' | 'consumable' | 'tool' | 'weapon' | 'ammo' | 'armor' | 'backpack' | 'key' | 'note';
const ITEM_TYPES: readonly ItemType[] = [
  'resource',
  'consumable',
  'tool',
  'weapon',
  'ammo',
  'armor',
  'backpack',
  'key',
  'note',
];
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic'];

export interface ItemEffects {
  hp?: number;
  hunger?: number;
  thirst?: number;
}

/** Item (CLAUDE.md §9.2). */
export interface ItemDef {
  /** Chave i18n do nome. */
  name: string;
  /** Chave de textura (16×16) no manifest. */
  icon: string;
  type: ItemType;
  /** Máximo por slot (ferramentas/armas: 1). */
  stack: number;
  rarity: Rarity;
  effects?: ItemEffects;
  /** Item devolvido ao consumir (ex.: a garrafa vazia depois de beber). */
  returns?: string;
  toolKind?: ToolKind;
  gatherPower?: number;
  damage?: number;
  /** Durabilidade máxima (só itens com stack 1). */
  durability?: number;
  /** Armadura: % de dano que evita (somado entre peças, até `maxArmorReductionPct`). */
  armor?: number;
  /** Onde se equipa a armadura. */
  equip?: EquipSlot;
  /** Armas: segundos entre golpes (omisso = `weaponAttackSec`). */
  attackSec?: number;
  /** Armas: alcance do golpe em px (omisso = `weaponReachPx`). */
  reach?: number;
  /** Notas: receita que ensina ao ler (desbloqueio alternativo, §11 Fase 8). */
  teaches?: string;
  /** Slots extra (mochilas). */
  slots?: number;
  /** Sementes: o que dá ao plantar num canteiro (§11 Fase 9). */
  plant?: PlantDef;
  /** Serve para regar os canteiros (água; devolve `returns`). */
  waters?: boolean;
  /** Estanca o sangramento ao usar (ligaduras, kits). */
  stopsBleeding?: boolean;
  /** Arma à distância (Fase 10): gasta 1 de `ammo` por tiro; mira sozinha ao inimigo mais perto. */
  ranged?: RangedDef;
  /** Armas: perícia que treinam (omisso: `archery` à distância, `blunt` corpo a corpo). */
  skill?: WeaponSkill;
  /** Munição que, se falhar o alvo, fica no chão e se apanha ao passar por cima (flechas…). */
  recoverable?: boolean;
  /** Munição que também serve nas armas que gastam `ammoOf` (ex.: flechas de pedra → arco). */
  ammoOf?: string;
  /** Munição: dano somado ao da arma. */
  ammoDamage?: number;
  /** Munição recuperável: % de partir ao acertar (o resto pode apanhar-se do corpo). */
  breakPct?: number;
}

/** A munição `ammo` serve numa arma que gasta `weaponAmmo`? */
export function ammoFits(ammo: string, def: ItemDef | undefined, weaponAmmo: string): boolean {
  return ammo === weaponAmmo || def?.ammoOf === weaponAmmo;
}

/** Perícias de combate: cada uma sobe com o uso e faz falhar menos (CLAUDE.md §7.8). */
export const WEAPON_SKILLS = ['fists', 'blunt', 'blade', 'archery', 'firearms'] as const;
export type WeaponSkill = (typeof WEAPON_SKILLS)[number];

/** Perícia de uma arma (`undefined` = punhos). */
export function skillOf(def: ItemDef | undefined): WeaponSkill {
  if (def?.damage === undefined) return 'fists';
  return def.skill ?? (def.ranged ? 'archery' : 'blunt');
}

export interface RangedDef {
  /** Item de munição (type ammo). */
  ammo: string;
  /** Alcance (px) do tiro e da mira automática. */
  range: number;
  /** Velocidade do projétil (px/s). */
  speed: number;
}

/** Semente: cresce durante `growHours` horas de jogo depois de regada. */
export interface PlantDef {
  crop: string;
  growHours: number;
  /** Colheita: quantidades [mín, máx] do fruto e de sementes. */
  yield: readonly [number, number];
  seeds: readonly [number, number];
}

export type ItemDefs = Readonly<Record<string, ItemDef>>;

/** Slots de equipamento (CLAUDE.md §7.3), pela ordem em que ficam no save. */
export const EQUIP_SLOTS = ['weapon', 'head', 'body', 'legs', 'feet', 'backpack'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** Slot onde um item se equipa (null = não se equipa). Tudo o que tem dano serve de arma. */
export function equipSlotOf(def: ItemDef | undefined): EquipSlot | null {
  if (!def) return null;
  if (def.type === 'armor') return def.equip ?? null;
  if (def.damage !== undefined) return 'weapon';
  return null;
}

/** Grupo de `enemyGroups.json` que forma as hordas (§7.13). */
export const HORDE_GROUP = 'horde';
/** Tabela de `lootTables.json` da recompensa por vencer uma horda. */
export const HORDE_REWARD_TABLE = 'horde_reward';

export class DataError extends Error {
  readonly problems: readonly string[];

  constructor(file: string, problems: readonly string[]) {
    super(`${file} inválido:\n- ${problems.join('\n- ')}`);
    this.name = 'DataError';
    this.problems = problems;
  }
}

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_FOOTPRINT = 64;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_FOOTPRINT;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function describe(value: unknown): string {
  return value === undefined ? 'em falta' : JSON.stringify(value);
}

/** Valida `props.json`. */
export function parseProps(input: unknown, spriteKeys: Iterable<string>): PropDefs {
  return parseWorldObjects(
    input,
    spriteKeys,
    'props.json',
    ['action'],
    (id, raw, problems): { action?: PropAction } => {
      if (raw.action === undefined) return {};
      const action = PROP_ACTIONS.find((a) => a === raw.action);
      if (!action) problems.push(`"${id}": action desconhecida ${describe(raw.action)}`);
      return action ? { action } : {};
    },
  );
}

/**
 * Valida `resources.json`.
 * @param spriteKeys chaves de textura existentes no manifest.
 * @param itemIds ids de itens existentes (para os drops).
 */
export function parseResources(
  input: unknown,
  spriteKeys: Iterable<string>,
  itemIds: Iterable<string>,
): ResourceDefs {
  const items = new Set(itemIds);
  return parseWorldObjects(
    input,
    spriteKeys,
    'resources.json',
    ['hp', 'tool', 'toolRequired', 'drops', 'respawnSec', 'xp'],
    (id, raw, problems) => {
      if (!isPositiveInt(raw.hp))
        problems.push(`"${id}": hp tem de ser um inteiro > 0 (${describe(raw.hp)})`);
      if (!isPositiveInt(raw.respawnSec)) problems.push(`"${id}": respawnSec tem de ser um inteiro > 0`);
      const tool = raw.tool;
      if (tool !== undefined && !TOOL_KINDS.includes(tool as ToolKind)) {
        problems.push(`"${id}": tool desconhecida ${describe(tool)} (${TOOL_KINDS.join(', ')})`);
      }
      const toolRequired = raw.toolRequired === true;
      if (raw.toolRequired !== undefined && typeof raw.toolRequired !== 'boolean') {
        problems.push(`"${id}": toolRequired tem de ser true/false`);
      }
      if (toolRequired && tool === undefined) problems.push(`"${id}": toolRequired sem tool`);
      const drops: Drop[] = [];
      if (!Array.isArray(raw.drops) || raw.drops.length === 0) {
        problems.push(`"${id}": drops tem de ser uma lista [[item, min, max], …]`);
      } else {
        for (const entry of raw.drops as unknown[]) {
          const [item, min, max] = Array.isArray(entry) ? (entry as unknown[]) : [];
          if (typeof item !== 'string' || !items.has(item)) {
            problems.push(`"${id}": drop com item desconhecido ${describe(item)}`);
          } else if (!isPositiveInt(min) || !isPositiveInt(max) || max < min) {
            problems.push(`"${id}": drop ${item} com min/max inválidos`);
          } else {
            drops.push({ item, min, max });
          }
        }
      }
      return {
        hp: isPositiveInt(raw.hp) ? raw.hp : 1,
        ...(tool === undefined ? {} : { tool: tool as ToolKind }),
        toolRequired,
        drops,
        respawnSec: isPositiveInt(raw.respawnSec) ? raw.respawnSec : 1,
        ...optionalXp(id, raw, problems),
      };
    },
  );
}

function parseWorldObjects<Extra extends object>(
  input: unknown,
  spriteKeys: Iterable<string>,
  file: string,
  extraKeys: readonly string[],
  parseExtra: (id: string, raw: Record<string, unknown>, problems: string[]) => Extra,
): Readonly<Record<string, WorldObjectDef & Extra>> {
  if (!isObject(input)) throw new DataError(file, ['tem de ser um objeto id → definição']);
  const sprites = new Set(spriteKeys);
  const allowed = new Set(['sprite', 'footprint', ...extraKeys]);
  const problems: string[] = [];
  const defs: Record<string, WorldObjectDef & Extra> = {};
  for (const [id, raw] of Object.entries(input)) {
    if (id === '$comment') continue;
    if (!ID_PATTERN.test(id)) problems.push(`"${id}": o id tem de estar em snake_case`);
    if (!isObject(raw)) {
      problems.push(`"${id}": tem de ser um objeto`);
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) problems.push(`"${id}": campo desconhecido "${key}"`);
    }
    const sprite = typeof raw.sprite === 'string' ? raw.sprite : '';
    if (!sprites.has(sprite)) problems.push(`"${id}": sprite "${sprite}" não existe no manifest`);
    const def: WorldObjectDef = { sprite };
    if (raw.footprint !== undefined) {
      const fp = raw.footprint;
      if (isObject(fp) && isSize(fp.width) && isSize(fp.height)) {
        def.footprint = { width: fp.width, height: fp.height };
      } else {
        problems.push(
          `"${id}": footprint tem de ser { width, height } inteiros entre 1 e ${String(MAX_FOOTPRINT)}`,
        );
      }
    }
    defs[id] = { ...def, ...parseExtra(id, raw, problems) };
  }
  if (problems.length > 0) throw new DataError(file, problems);
  return defs;
}

const ITEM_KEYS = new Set([
  'name',
  'icon',
  'type',
  'stack',
  'rarity',
  'effects',
  'returns',
  'toolKind',
  'gatherPower',
  'damage',
  'durability',
  'armor',
  'slots',
  'equip',
  'attackSec',
  'reach',
  'teaches',
  'plant',
  'waters',
  'stopsBleeding',
  'ranged',
  'skill',
  'recoverable',
  'ammoOf',
  'ammoDamage',
  'breakPct',
]);
const EFFECT_KEYS = new Set(['hp', 'hunger', 'thirst']);
const OPTIONAL_NUMBERS = ['gatherPower', 'damage', 'durability', 'armor', 'slots', 'reach'] as const;

/**
 * Valida `items.json`.
 * @param iconKeys chaves de textura existentes no manifest.
 */
export function parseItems(input: unknown, iconKeys: Iterable<string>): ItemDefs {
  if (!isObject(input)) throw new DataError('items.json', ['tem de ser um objeto id → item']);
  const icons = new Set(iconKeys);
  const ids = new Set(Object.keys(input).filter((id) => id !== '$comment'));
  const problems: string[] = [];
  const defs: Record<string, ItemDef> = {};
  for (const [id, raw] of Object.entries(input)) {
    if (id === '$comment') continue;
    if (!ID_PATTERN.test(id)) problems.push(`"${id}": o id tem de estar em snake_case`);
    if (!isObject(raw)) {
      problems.push(`"${id}": tem de ser um objeto`);
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (!ITEM_KEYS.has(key)) problems.push(`"${id}": campo desconhecido "${key}"`);
    }
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (name !== `item.${id}`) problems.push(`"${id}": name tem de ser "item.${id}"`);
    const icon = typeof raw.icon === 'string' ? raw.icon : '';
    if (!icons.has(icon)) problems.push(`"${id}": ícone "${icon}" não existe no manifest`);
    const type = ITEM_TYPES.find((t) => t === raw.type);
    if (!type) problems.push(`"${id}": type inválido ${describe(raw.type)}`);
    const rarity = RARITIES.find((r) => r === raw.rarity);
    if (!rarity) problems.push(`"${id}": rarity inválida ${describe(raw.rarity)}`);
    if (!isPositiveInt(raw.stack)) problems.push(`"${id}": stack tem de ser um inteiro > 0`);
    const def: ItemDef = {
      name,
      icon,
      type: type ?? 'resource',
      stack: isPositiveInt(raw.stack) ? raw.stack : 1,
      rarity: rarity ?? 'common',
    };
    if (raw.effects !== undefined) {
      if (!isObject(raw.effects)) problems.push(`"${id}": effects tem de ser um objeto`);
      else {
        const effects: ItemEffects = {};
        for (const [key, value] of Object.entries(raw.effects)) {
          if (!EFFECT_KEYS.has(key) || typeof value !== 'number' || !Number.isInteger(value)) {
            problems.push(`"${id}": efeito inválido ${key}=${describe(value)}`);
          } else {
            effects[key as keyof ItemEffects] = value;
          }
        }
        def.effects = effects;
      }
      if (def.type !== 'consumable') problems.push(`"${id}": só consumíveis têm effects`);
    }
    if (def.type === 'consumable' && raw.effects === undefined)
      problems.push(`"${id}": consumível sem effects`);
    if (raw.returns !== undefined) {
      if (typeof raw.returns === 'string' && ids.has(raw.returns)) def.returns = raw.returns;
      else problems.push(`"${id}": returns aponta para um item desconhecido ${describe(raw.returns)}`);
    }
    if (raw.toolKind !== undefined) {
      const kind = TOOL_KINDS.find((k) => k === raw.toolKind);
      if (kind) def.toolKind = kind;
      else problems.push(`"${id}": toolKind inválido ${describe(raw.toolKind)}`);
      if (raw.gatherPower === undefined) problems.push(`"${id}": ferramenta sem gatherPower`);
    }
    if (raw.equip !== undefined) {
      const slot = EQUIP_SLOTS.find((e) => e === raw.equip && e !== 'weapon' && e !== 'backpack');
      if (slot) def.equip = slot;
      else problems.push(`"${id}": equip inválido ${describe(raw.equip)} (head, body, legs, feet)`);
    }
    if (def.type === 'armor' && raw.equip === undefined) problems.push(`"${id}": armadura sem equip`);
    if (raw.equip !== undefined && def.type !== 'armor') problems.push(`"${id}": só armaduras têm equip`);
    if (raw.teaches !== undefined) {
      if (typeof raw.teaches === 'string' && raw.teaches !== '') def.teaches = raw.teaches;
      else problems.push(`"${id}": teaches tem de ser o id de uma receita`);
    }
    if ((def.type === 'note') !== (def.teaches !== undefined))
      problems.push(`"${id}": as notas (type note) e só elas têm teaches`);
    if (raw.attackSec !== undefined) {
      if (typeof raw.attackSec === 'number' && raw.attackSec > 0 && raw.attackSec <= 5)
        def.attackSec = raw.attackSec;
      else problems.push(`"${id}": attackSec tem de ser um número entre 0 e 5`);
    }
    for (const key of OPTIONAL_NUMBERS) {
      const value = raw[key];
      if (value === undefined) continue;
      if (isPositiveInt(value)) def[key] = value;
      else problems.push(`"${id}": ${key} tem de ser um inteiro > 0`);
    }
    if (def.durability !== undefined && def.stack !== 1)
      problems.push(`"${id}": itens com durabilidade têm stack 1`);
    if (raw.ranged !== undefined) {
      const r = raw.ranged;
      if (
        isObject(r) &&
        typeof r.ammo === 'string' &&
        ids.has(r.ammo) &&
        typeof r.range === 'number' &&
        r.range > 0 &&
        r.range <= 320 &&
        typeof r.speed === 'number' &&
        r.speed > 0 &&
        r.speed <= 800
      )
        def.ranged = { ammo: r.ammo, range: r.range, speed: r.speed };
      else problems.push(`"${id}": ranged tem de ser { ammo (item), range ≤ 320, speed ≤ 800 }`);
      if (raw.damage === undefined) problems.push(`"${id}": uma arma à distância precisa de damage`);
    }
    if (raw.skill !== undefined) {
      const skill = WEAPON_SKILLS.find((k) => k === raw.skill && k !== 'fists');
      if (skill && raw.damage !== undefined) def.skill = skill;
      else problems.push(`"${id}": skill tem de ser blunt, blade, archery ou firearms (e só em armas)`);
    }
    if (raw.recoverable !== undefined) {
      if (raw.recoverable === true && def.type === 'ammo') def.recoverable = true;
      else problems.push(`"${id}": recoverable tem de ser true (e só em munições)`);
    }
    if (raw.ammoOf !== undefined) {
      if (typeof raw.ammoOf === 'string' && ids.has(raw.ammoOf) && def.type === 'ammo')
        def.ammoOf = raw.ammoOf;
      else problems.push(`"${id}": ammoOf tem de ser o id de outra munição (e só em munições)`);
    }
    if (raw.ammoDamage !== undefined) {
      if (isPositiveInt(raw.ammoDamage) && def.type === 'ammo') def.ammoDamage = raw.ammoDamage;
      else problems.push(`"${id}": ammoDamage tem de ser um inteiro > 0 (e só em munições)`);
    }
    if (raw.breakPct !== undefined) {
      if (typeof raw.breakPct === 'number' && raw.breakPct >= 0 && raw.breakPct <= 100 && def.type === 'ammo')
        def.breakPct = raw.breakPct;
      else problems.push(`"${id}": breakPct tem de ser 0–100 (e só em munições)`);
    }
    if (raw.stopsBleeding !== undefined) {
      if (raw.stopsBleeding === true && def.type === 'consumable') def.stopsBleeding = true;
      else problems.push(`"${id}": stopsBleeding tem de ser true (e só em consumíveis)`);
    }
    if (raw.waters !== undefined) {
      if (raw.waters === true) def.waters = true;
      else problems.push(`"${id}": waters tem de ser true`);
    }
    if (raw.plant !== undefined) {
      const plant = parsePlant(raw.plant, ids);
      if (typeof plant === 'string') problems.push(`"${id}": plant ${plant}`);
      else {
        def.plant = plant;
        if (!icons.has(cropSprite(plant.crop)))
          problems.push(`"${id}": falta o sprite "${cropSprite(plant.crop)}" no manifest`);
      }
    }
    defs[id] = def;
  }
  for (const [id, def] of Object.entries(defs)) {
    if (def.ranged && defs[def.ranged.ammo]?.type !== 'ammo')
      problems.push(`"${id}": a munição "${def.ranged.ammo}" tem de ser do tipo ammo`);
  }
  if (problems.length > 0) throw new DataError('items.json', problems);
  return defs;
}

const isRange = (value: unknown, min: number): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= min) &&
  (value[0] as number) <= (value[1] as number);

/** Sprite da planta madura num canteiro. */
export function cropSprite(crop: string): string {
  return `crop_${crop}`;
}

/** Sprite da planta a crescer (igual para todas). */
export const CROP_SPROUT_SPRITE = 'crop_sprout';

/** `{ crop, growHours, yield: [mín, máx], seeds: [mín, máx] }` ou a descrição do problema. */
function parsePlant(raw: unknown, itemIds: ReadonlySet<string>): PlantDef | string {
  if (!isObject(raw)) return 'tem de ser { crop, growHours, yield, seeds }';
  if (typeof raw.crop !== 'string' || !itemIds.has(raw.crop))
    return `com fruto desconhecido ${describe(raw.crop)}`;
  if (typeof raw.growHours !== 'number' || raw.growHours <= 0 || raw.growHours > 240)
    return 'growHours tem de ser um número de horas entre 0 e 240';
  if (!isRange(raw.yield, 1)) return 'yield tem de ser [mín ≥ 1, máx]';
  if (!isRange(raw.seeds, 0)) return 'seeds tem de ser [mín ≥ 0, máx]';
  return { crop: raw.crop, growHours: raw.growHours, yield: raw.yield, seeds: raw.seeds };
}

/** Estação de crafting colocada no mundo (fogueira, bancada…). */
export interface StationDef extends WorldObjectDef {
  /** Máximo de trabalhos em fila (CLAUDE.md §7.5: 3). */
  queue: number;
  /** A bancada repara ferramentas (§2: reparação barata). */
  repair: boolean;
  /** Comerciante (Fase 10): as "receitas" são trocas instantâneas (categoria trade), sem fila. */
  trade: boolean;
}

export type StationDefs = Readonly<Record<string, StationDef>>;

/** Estação especial: craft instantâneo no próprio inventário. */
export const HANDS = 'hands';

export type RecipeCategory = 'tools' | 'materials' | 'weapons' | 'armor' | 'food' | 'trade';
export const RECIPE_CATEGORIES: readonly RecipeCategory[] = [
  'tools',
  'materials',
  'weapons',
  'armor',
  'food',
  'trade',
];

export interface Recipe {
  id: string;
  /** `hands` ou um id de `stations.json`. */
  station: string;
  category: RecipeCategory;
  inputs: readonly { item: string; qty: number }[];
  output: string;
  qty: number;
  /** 0 nas mãos (instantâneo); 5–60 s nas estações (tempo de jogo). */
  timeSec: number;
  unlockLevel: number;
  /** XP ao fabricar (omisso = calculado pelo tempo). */
  xp?: number;
}

export type Recipes = readonly Recipe[];

/** Valida `stations.json`. */
export function parseStations(input: unknown, spriteKeys: Iterable<string>): StationDefs {
  return parseWorldObjects(
    input,
    spriteKeys,
    'stations.json',
    ['queue', 'repair', 'trade'],
    (id, raw, problems) => {
      if (!isPositiveInt(raw.queue)) problems.push(`"${id}": queue tem de ser um inteiro > 0`);
      for (const key of ['repair', 'trade'] as const) {
        if (raw[key] !== undefined && typeof raw[key] !== 'boolean')
          problems.push(`"${id}": ${key} tem de ser true/false`);
      }
      return {
        queue: isPositiveInt(raw.queue) ? raw.queue : 1,
        repair: raw.repair === true,
        trade: raw.trade === true,
      };
    },
  );
}

const RECIPE_KEYS = new Set([
  'id',
  'station',
  'category',
  'inputs',
  'output',
  'qty',
  'timeSec',
  'unlockLevel',
  'xp',
]);

/**
 * Valida `recipes.json` (CLAUDE.md §9.3): ids únicos, itens e estações existentes, tempos
 * (mãos = 0 s; estações > 0 s).
 */
export function parseRecipes(
  input: unknown,
  itemIds: Iterable<string>,
  stationIds: Iterable<string>,
): Recipes {
  if (!Array.isArray(input)) throw new DataError('recipes.json', ['tem de ser uma lista de receitas']);
  const items = new Set(itemIds);
  const stations = new Set(stationIds);
  const seen = new Set<string>();
  const problems: string[] = [];
  const recipes: Recipe[] = [];
  for (const [index, raw] of (input as unknown[]).entries()) {
    const where = isObject(raw) && typeof raw.id === 'string' ? `"${raw.id}"` : `[${String(index)}]`;
    if (!isObject(raw)) {
      problems.push(`${where}: tem de ser um objeto`);
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (!RECIPE_KEYS.has(key)) problems.push(`${where}: campo desconhecido "${key}"`);
    }
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!ID_PATTERN.test(id)) problems.push(`${where}: id tem de estar em snake_case`);
    if (seen.has(id)) problems.push(`${where}: id repetido`);
    seen.add(id);
    const station = typeof raw.station === 'string' ? raw.station : '';
    if (station !== HANDS && !stations.has(station))
      problems.push(`${where}: estação desconhecida "${station}"`);
    const category = RECIPE_CATEGORIES.find((c) => c === raw.category);
    if (!category) problems.push(`${where}: category inválida ${describe(raw.category)}`);
    const output = typeof raw.output === 'string' ? raw.output : '';
    if (!items.has(output)) problems.push(`${where}: output desconhecido "${output}"`);
    if (!isPositiveInt(raw.qty)) problems.push(`${where}: qty tem de ser um inteiro > 0`);
    if (!isPositiveInt(raw.unlockLevel)) problems.push(`${where}: unlockLevel tem de ser um inteiro > 0`);
    const timeSec = raw.timeSec;
    const timeOk =
      typeof timeSec === 'number' &&
      Number.isInteger(timeSec) &&
      (station === HANDS || raw.category === 'trade' ? timeSec === 0 : timeSec > 0 && timeSec <= 60);
    if (!timeOk) problems.push(`${where}: timeSec tem de ser 0 nas mãos e nas trocas, e 1–60 nas estações`);
    const inputs: { item: string; qty: number }[] = [];
    if (!Array.isArray(raw.inputs) || raw.inputs.length === 0) {
      problems.push(`${where}: inputs tem de ser [[item, qtd], …]`);
    } else {
      for (const entry of raw.inputs as unknown[]) {
        const [item, qty] = Array.isArray(entry) ? (entry as unknown[]) : [];
        if (typeof item !== 'string' || !items.has(item))
          problems.push(`${where}: ingrediente desconhecido ${describe(item)}`);
        else if (!isPositiveInt(qty)) problems.push(`${where}: quantidade de ${item} inválida`);
        else inputs.push({ item, qty });
      }
    }
    recipes.push({
      id,
      station,
      category: category ?? 'materials',
      inputs,
      output,
      qty: isPositiveInt(raw.qty) ? raw.qty : 1,
      timeSec: typeof timeSec === 'number' ? timeSec : 0,
      unlockLevel: isPositiveInt(raw.unlockLevel) ? raw.unlockLevel : 1,
      ...optionalXp(where, raw, problems),
    });
  }
  if (problems.length > 0) throw new DataError('recipes.json', problems);
  return recipes;
}

/** Camada de uma peça: `floor` (fundações, por baixo) ou `top` (paredes, portas, estações…). */
export type StructureLayer = 'floor' | 'top';
const STRUCTURE_LAYERS: readonly StructureLayer[] = ['floor', 'top'];

/** Peça de construção da base (CLAUDE.md §7.7). Ocupa `size` tiles da grelha. */
export interface StructureDef {
  /**
   * Chave de textura. Variantes derivadas do nome: `<sprite>_v` (rodada, se `rotatable`),
   * `<sprite>_open` / `<sprite>_v_open` (porta aberta).
   */
  sprite: string;
  layer: StructureLayer;
  /** Largura × altura em tiles (omisso = 1×1). */
  size: { width: number; height: number };
  cost: readonly { item: string; qty: number }[];
  /** Bloqueia os tiles inteiros (paredes, janelas, vedações, portas fechadas). */
  solid: boolean;
  /** Caixa sólida nos pés (estações, baús), em vez do tile inteiro. */
  footprint?: Footprint;
  /** Duas orientações (horizontal/vertical). */
  rotatable: boolean;
  /** Vira-se sozinha para ligar às peças iguais ao lado (vedações em fila vertical ficam verticais). */
  connects: boolean;
  /** Abre e fecha com a ação contextual (fechada é sólida). */
  door: boolean;
  /** Estação de crafting (id de `stations.json`). */
  station?: string;
  /** Baú (guarda itens). */
  chest: boolean;
  /** Só pode ser colocada sobre fundação (estações e baús, §7.7). */
  needsFoundation: boolean;
  /** Nível do jogador para se poder construir. */
  unlockLevel: number;
  /** Raio (px) da luz que dá à noite (fogueiras, tochas). */
  light?: number;
  /** Canteiro da horta: planta-se uma semente, rega-se e colhe-se (sprite `<sprite>_wet` regado). */
  farm: boolean;
  /** Produz sozinha com o tempo (coletor de água, armadilha de caça); sprite `<sprite>_full`. */
  produce?: ProduceDef;
  /** Vida contra as hordas (só as peças sólidas: paredes, portas, janelas, vedações). */
  hp?: number;
  /** Armadilha de estacas: fere os inimigos que a pisam; gasta-se ao fim de `uses` golpes. */
  trap?: TrapDef;
  /** Veículo (moto): construído na base, baixa o custo das viagens nesta %. */
  travelDiscountPct?: number;
}

export interface TrapDef {
  damage: number;
  /** Segundos entre golpes. */
  everySec: number;
  uses: number;
}

/** O que uma peça produz sozinha: uma unidade a cada `everyHours` horas de jogo, até `max`. */
export interface ProduceDef {
  everyHours: number;
  max: number;
  /** O que dá cada unidade (min pode ser 0). */
  drops: readonly Drop[];
  /** Item gasto por unidade ao recolher (ex.: garrafa vazia para a água). */
  needs?: string;
}

export type StructureDefs = Readonly<Record<string, StructureDef>>;

/** Texturas de que uma peça precisa (a base e as variantes rodada/aberta). */
export function structureSpriteKeys(def: StructureDef): string[] {
  const keys = [def.sprite];
  if (def.rotatable) keys.push(`${def.sprite}_v`);
  if (def.door) keys.push(...keys.map((key) => `${key}_open`));
  if (def.farm) keys.push(`${def.sprite}_wet`);
  if (def.produce) keys.push(`${def.sprite}_full`);
  return keys;
}

/** Textura de uma peça com a orientação e o estado (porta aberta) dados. */
export function structureSprite(def: StructureDef, rot: number, open: boolean): string {
  const rotated = def.rotatable && rot === 1 ? `${def.sprite}_v` : def.sprite;
  return def.door && open ? `${rotated}_open` : rotated;
}

const STRUCTURE_KEYS = new Set([
  'sprite',
  'layer',
  'size',
  'cost',
  'solid',
  'footprint',
  'rotatable',
  'connects',
  'door',
  'station',
  'chest',
  'needsFoundation',
  'unlockLevel',
  'light',
  'farm',
  'produce',
  'hp',
  'trap',
  'travelDiscountPct',
]);
const MAX_STRUCTURE_TILES = 4;

/**
 * Valida `structures.json`: sprites (e variantes) no manifest, custos com itens existentes,
 * estações existentes, e combinações coerentes (ex.: estações e baús na camada de cima).
 */
export function parseStructures(
  input: unknown,
  spriteKeys: Iterable<string>,
  itemIds: Iterable<string>,
  stationIds: Iterable<string>,
): StructureDefs {
  if (!isObject(input)) throw new DataError('structures.json', ['tem de ser um objeto id → peça']);
  const sprites = new Set(spriteKeys);
  const items = new Set(itemIds);
  const stations = new Set(stationIds);
  const problems: string[] = [];
  const defs: Record<string, StructureDef> = {};
  const flag = (id: string, raw: Record<string, unknown>, key: string): boolean => {
    const value = raw[key];
    if (value !== undefined && typeof value !== 'boolean')
      problems.push(`"${id}": ${key} tem de ser true/false`);
    return value === true;
  };
  for (const [id, raw] of Object.entries(input)) {
    if (id === '$comment') continue;
    if (!ID_PATTERN.test(id)) problems.push(`"${id}": o id tem de estar em snake_case`);
    if (!isObject(raw)) {
      problems.push(`"${id}": tem de ser um objeto`);
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (!STRUCTURE_KEYS.has(key)) problems.push(`"${id}": campo desconhecido "${key}"`);
    }
    const layer = STRUCTURE_LAYERS.find((l) => l === raw.layer);
    if (!layer) problems.push(`"${id}": layer tem de ser "floor" ou "top"`);
    const size = { width: 1, height: 1 };
    if (raw.size !== undefined) {
      const [w, h] = Array.isArray(raw.size) ? (raw.size as unknown[]) : [];
      if (isPositiveInt(w) && isPositiveInt(h) && w <= MAX_STRUCTURE_TILES && h <= MAX_STRUCTURE_TILES) {
        size.width = w;
        size.height = h;
      } else
        problems.push(
          `"${id}": size tem de ser [largura, altura] em tiles (1–${String(MAX_STRUCTURE_TILES)})`,
        );
    }
    const cost: { item: string; qty: number }[] = [];
    if (!Array.isArray(raw.cost) || raw.cost.length === 0) {
      problems.push(`"${id}": cost tem de ser [[item, qtd], …]`);
    } else {
      for (const entry of raw.cost as unknown[]) {
        const [item, qty] = Array.isArray(entry) ? (entry as unknown[]) : [];
        if (typeof item !== 'string' || !items.has(item))
          problems.push(`"${id}": custo com item desconhecido ${describe(item)}`);
        else if (!isPositiveInt(qty)) problems.push(`"${id}": quantidade de ${item} inválida`);
        else cost.push({ item, qty });
      }
    }
    const def: StructureDef = {
      sprite: typeof raw.sprite === 'string' ? raw.sprite : '',
      layer: layer ?? 'top',
      size,
      cost,
      solid: flag(id, raw, 'solid'),
      rotatable: flag(id, raw, 'rotatable'),
      connects: flag(id, raw, 'connects'),
      door: flag(id, raw, 'door'),
      chest: flag(id, raw, 'chest'),
      needsFoundation: flag(id, raw, 'needsFoundation'),
      unlockLevel: isPositiveInt(raw.unlockLevel) ? raw.unlockLevel : 1,
      farm: flag(id, raw, 'farm'),
    };
    if (raw.hp !== undefined) {
      if (isPositiveInt(raw.hp)) def.hp = raw.hp;
      else problems.push(`"${id}": hp tem de ser um inteiro > 0`);
    }
    if (raw.travelDiscountPct !== undefined) {
      if (isPositiveInt(raw.travelDiscountPct) && raw.travelDiscountPct <= 90)
        def.travelDiscountPct = raw.travelDiscountPct;
      else problems.push(`"${id}": travelDiscountPct tem de ser um inteiro de 1 a 90`);
    }
    if (raw.trap !== undefined) {
      const trap = raw.trap;
      if (
        isObject(trap) &&
        isPositiveInt(trap.damage) &&
        isPositiveInt(trap.uses) &&
        typeof trap.everySec === 'number' &&
        trap.everySec > 0
      )
        def.trap = { damage: trap.damage, everySec: trap.everySec, uses: trap.uses };
      else problems.push(`"${id}": trap tem de ser { damage, everySec, uses }`);
    }
    if (raw.produce !== undefined) {
      const produce = parseProduce(raw.produce, items);
      if (typeof produce === 'string') problems.push(`"${id}": produce ${produce}`);
      else def.produce = produce;
    }
    if (raw.unlockLevel !== undefined && !isPositiveInt(raw.unlockLevel))
      problems.push(`"${id}": unlockLevel tem de ser um inteiro > 0`);
    if (raw.light !== undefined) {
      if (isPositiveInt(raw.light) && raw.light <= 160) def.light = raw.light;
      else problems.push(`"${id}": light tem de ser um raio (px) entre 1 e 160`);
    }
    if (raw.footprint !== undefined) {
      const fp = raw.footprint;
      if (isObject(fp) && isSize(fp.width) && isSize(fp.height))
        def.footprint = { width: fp.width, height: fp.height };
      else problems.push(`"${id}": footprint tem de ser { width, height } inteiros`);
    }
    if (raw.station !== undefined) {
      if (typeof raw.station === 'string' && stations.has(raw.station)) def.station = raw.station;
      else problems.push(`"${id}": estação desconhecida ${describe(raw.station)}`);
    }
    for (const key of structureSpriteKeys(def)) {
      if (!sprites.has(key)) problems.push(`"${id}": sprite "${key}" não existe no manifest`);
    }
    if (def.layer === 'floor' && (def.solid || def.door || def.chest || def.station || def.footprint))
      problems.push(`"${id}": peças de chão não podem ser sólidas, portas, baús nem estações`);
    if (def.solid && def.footprint) problems.push(`"${id}": solid e footprint são alternativos`);
    if (def.door && !def.solid) problems.push(`"${id}": uma porta tem de ser solid (quando fechada)`);
    if (def.chest && def.station) problems.push(`"${id}": não pode ser baú e estação`);
    if (def.hp !== undefined && !def.solid) problems.push(`"${id}": só as peças sólidas têm hp`);
    if (def.trap && (def.solid || def.footprint))
      problems.push(`"${id}": as armadilhas pisam-se (sem solid)`);
    const roles = [
      def.chest,
      def.station !== undefined,
      def.door,
      def.farm,
      def.produce !== undefined,
      def.trap !== undefined,
    ];
    if (roles.filter(Boolean).length > 1)
      problems.push(`"${id}": só pode ter um papel (baú, estação, porta, canteiro, produção ou armadilha)`);
    if ((def.rotatable || def.door) && (size.width !== 1 || size.height !== 1))
      problems.push(`"${id}": peças rodáveis e portas têm 1×1 tiles`);
    defs[id] = def;
  }
  if (problems.length > 0) throw new DataError('structures.json', problems);
  return defs;
}

/** `{ everyHours, max, drops: [[item, mín, máx]], needs? }` ou a descrição do problema. */
function parseProduce(raw: unknown, items: ReadonlySet<string>): ProduceDef | string {
  if (!isObject(raw)) return 'tem de ser { everyHours, max, drops, needs? }';
  for (const key of Object.keys(raw)) {
    if (!['everyHours', 'max', 'drops', 'needs'].includes(key)) return `com campo desconhecido "${key}"`;
  }
  if (typeof raw.everyHours !== 'number' || raw.everyHours <= 0 || raw.everyHours > 240)
    return 'everyHours tem de ser um número de horas entre 0 e 240';
  if (!isPositiveInt(raw.max) || raw.max > 20) return 'max tem de ser um inteiro entre 1 e 20';
  if (!Array.isArray(raw.drops) || raw.drops.length === 0) return 'drops tem de ser [[item, mín, máx], …]';
  const drops: Drop[] = [];
  for (const entry of raw.drops as unknown[]) {
    const [item, min, max] = Array.isArray(entry) ? (entry as unknown[]) : [];
    if (typeof item !== 'string' || !items.has(item)) return `com item desconhecido ${describe(item)}`;
    if (!isRange([min, max], 0) || max === 0) return `com mín/máx inválidos em ${item}`;
    drops.push({ item, min: min as number, max: max as number });
  }
  const produce: ProduceDef = { everyHours: raw.everyHours, max: raw.max, drops };
  if (raw.needs !== undefined) {
    if (typeof raw.needs === 'string' && items.has(raw.needs)) produce.needs = raw.needs;
    else return `needs com item desconhecido ${describe(raw.needs)}`;
  }
  return produce;
}

/** Comportamento: `hostile` persegue e ataca; `flee` foge do jogador (presas). */
export type EnemyBehavior = 'hostile' | 'flee';
const ENEMY_BEHAVIORS: readonly EnemyBehavior[] = ['hostile', 'flee'];

/** Inimigo ou animal (CLAUDE.md §7.9). Distâncias em px, tempos em segundos de jogo. */
export interface EnemyDef {
  sprite: string;
  footprint: Footprint;
  behavior: EnemyBehavior;
  hp: number;
  /** Dano por ataque (0 = não ataca). */
  damage: number;
  /** Velocidade a perseguir/fugir (px/s); a passear anda a metade. */
  speed: number;
  /** Vê o jogador a esta distância (metade se ele andar agachado). */
  detectRadius: number;
  /** Não se afasta mais do que isto do sítio onde nasceu (depois volta). */
  leashRadius: number;
  /** Ataca quando o jogador está a esta distância. */
  attackRange: number;
  /** Segundos entre ataques. */
  attackSec: number;
  /** Drops ao morrer: quantidade entre min e max (min pode ser 0). */
  drops: readonly Drop[];
  /** XP ao derrotar. */
  xp: number;
  /** Explode ao morrer (inchado): aviso de `delaySec`, depois dano em área. */
  explode?: { radius: number; damage: number; delaySec: number };
  /** Carrega (javali): a esta distância, aviso e depois corre em linha reta a `speed` px/s. */
  charge?: { range: number; speed: number; sec: number };
  /** Aviso de ataque próprio, em segundos (omisso = `enemyWindupSec`; o brutamontes é lento). */
  windupSec?: number;
  /** % de hipótese de cada golpe pôr o jogador a sangrar (§7.8, Fase 10). */
  bleedPct?: number;
  /**
   * Gritador: não ataca; mantém-se a `keepAway` px do jogador e, a cada `everySec`, grita e põe
   * os inimigos a menos de `radius` px à procura do jogador durante `alertSec`.
   */
  scream?: { radius: number; everySec: number; keepAway: number; alertSec: number };
  /** Chefe (fim do bunker): derrotado, só volta ao fim de `respawnDays` da zona; barra no HUD. */
  boss?: boolean;
}

export type EnemyDefs = Readonly<Record<string, EnemyDef>>;

const ENEMY_KEYS = new Set([
  'sprite',
  'footprint',
  'behavior',
  'hp',
  'damage',
  'speed',
  'detectRadius',
  'leashRadius',
  'attackRange',
  'attackSec',
  'drops',
  'xp',
  'explode',
  'charge',
  'windupSec',
  'bleedPct',
  'scream',
  'boss',
]);

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Valida `enemies.json`. */
export function parseEnemies(
  input: unknown,
  spriteKeys: Iterable<string>,
  itemIds: Iterable<string>,
): EnemyDefs {
  if (!isObject(input)) throw new DataError('enemies.json', ['tem de ser um objeto id → inimigo']);
  const sprites = new Set(spriteKeys);
  const items = new Set(itemIds);
  const problems: string[] = [];
  const defs: Record<string, EnemyDef> = {};
  for (const [id, raw] of Object.entries(input)) {
    if (id === '$comment') continue;
    if (!ID_PATTERN.test(id)) problems.push(`"${id}": o id tem de estar em snake_case`);
    if (!isObject(raw)) {
      problems.push(`"${id}": tem de ser um objeto`);
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (!ENEMY_KEYS.has(key)) problems.push(`"${id}": campo desconhecido "${key}"`);
    }
    const sprite = typeof raw.sprite === 'string' ? raw.sprite : '';
    if (!sprites.has(sprite)) problems.push(`"${id}": sprite "${sprite}" não existe no manifest`);
    const fp = raw.footprint;
    const footprint =
      isObject(fp) && isSize(fp.width) && isSize(fp.height) ? { width: fp.width, height: fp.height } : null;
    if (!footprint) problems.push(`"${id}": footprint tem de ser { width, height } inteiros`);
    const behavior = ENEMY_BEHAVIORS.find((b) => b === raw.behavior);
    if (!behavior) problems.push(`"${id}": behavior tem de ser ${ENEMY_BEHAVIORS.join(' ou ')}`);
    const num = (key: string, check: (v: unknown) => v is number, what: string): number => {
      const value = raw[key];
      if (check(value)) return value;
      problems.push(`"${id}": ${key} tem de ser ${what}`);
      return 1;
    };
    const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
    const drops: Drop[] = [];
    if (!Array.isArray(raw.drops)) problems.push(`"${id}": drops tem de ser uma lista [[item, min, max], …]`);
    else {
      for (const entry of raw.drops as unknown[]) {
        const [item, min, max] = Array.isArray(entry) ? (entry as unknown[]) : [];
        if (typeof item !== 'string' || !items.has(item))
          problems.push(`"${id}": drop com item desconhecido ${describe(item)}`);
        else if (!isNonNegativeInt(min) || !isPositiveInt(max) || max < min)
          problems.push(`"${id}": drop ${item} com min/max inválidos`);
        else drops.push({ item, min, max });
      }
    }
    defs[id] = {
      sprite,
      footprint: footprint ?? { width: 8, height: 4 },
      behavior: behavior ?? 'hostile',
      hp: num('hp', isPositiveInt, 'um inteiro > 0'),
      damage: num('damage', isNonNegativeInt, 'um inteiro ≥ 0'),
      speed: num('speed', positive, 'um número > 0'),
      detectRadius: num('detectRadius', positive, 'um número > 0'),
      leashRadius: num('leashRadius', positive, 'um número > 0'),
      attackRange: num('attackRange', positive, 'um número > 0'),
      attackSec: num('attackSec', positive, 'um número > 0'),
      drops,
      xp: raw.xp === undefined ? 0 : num('xp', isNonNegativeInt, 'um inteiro ≥ 0'),
    };
    const nums = (key: string, fields: readonly string[]): Record<string, number> | undefined => {
      const value = raw[key];
      if (value === undefined) return undefined;
      if (isObject(value) && fields.every((f) => positive(value[f]))) {
        return Object.fromEntries(fields.map((f) => [f, value[f] as number]));
      }
      problems.push(`"${id}": ${key} tem de ser { ${fields.join(', ')} } com números > 0`);
      return undefined;
    };
    const explode = nums('explode', ['radius', 'damage', 'delaySec']);
    if (explode)
      defs[id].explode = {
        radius: explode.radius ?? 1,
        damage: explode.damage ?? 1,
        delaySec: explode.delaySec ?? 1,
      };
    const charge = nums('charge', ['range', 'speed', 'sec']);
    if (charge)
      defs[id].charge = { range: charge.range ?? 1, speed: charge.speed ?? 1, sec: charge.sec ?? 1 };
    const scream = nums('scream', ['radius', 'everySec', 'keepAway', 'alertSec']);
    if (scream)
      defs[id].scream = {
        radius: scream.radius ?? 1,
        everySec: scream.everySec ?? 1,
        keepAway: scream.keepAway ?? 1,
        alertSec: scream.alertSec ?? 1,
      };
    if (raw.windupSec !== undefined) {
      if (positive(raw.windupSec) && raw.windupSec <= 5) defs[id].windupSec = raw.windupSec;
      else problems.push(`"${id}": windupSec tem de ser um número entre 0 e 5`);
    }
    if (raw.boss !== undefined) {
      if (raw.boss === true) defs[id].boss = true;
      else problems.push(`"${id}": boss tem de ser true`);
    }
    if (raw.bleedPct !== undefined) {
      if (isNonNegativeInt(raw.bleedPct) && raw.bleedPct <= 100) defs[id].bleedPct = raw.bleedPct;
      else problems.push(`"${id}": bleedPct tem de ser um inteiro de 0 a 100`);
    }
    const def = defs[id];
    if (def.leashRadius < def.detectRadius) problems.push(`"${id}": leashRadius tem de ser ≥ detectRadius`);
  }
  if (problems.length > 0) throw new DataError('enemies.json', problems);
  return defs;
}

export interface EnemyGroup {
  members: readonly { enemy: string; min: number; max: number }[];
  /** Só aparece de noite (ex.: lobos no lago). */
  night: boolean;
}

/** Grupos dos pontos `enemy_spawn:<grupo>`: [[inimigo, mín, máx], …] ou { night, members }. */
export type EnemyGroups = Readonly<Record<string, EnemyGroup>>;

/** Valida `enemyGroups.json`. */
export function parseEnemyGroups(input: unknown, enemyIds: Iterable<string>): EnemyGroups {
  if (!isObject(input))
    throw new DataError('enemyGroups.json', ['tem de ser um objeto id → [[inimigo, mín, máx]]']);
  const enemies = new Set(enemyIds);
  const problems: string[] = [];
  const groups: Record<string, EnemyGroup> = {};
  for (const [id, value] of Object.entries(input)) {
    if (id === '$comment') continue;
    if (!ID_PATTERN.test(id)) problems.push(`"${id}": o id tem de estar em snake_case`);
    const raw = isObject(value) ? value.members : value;
    const night = isObject(value) && value.night === true;
    if (!Array.isArray(raw) || raw.length === 0) {
      problems.push(`"${id}": tem de ser uma lista [[inimigo, mín, máx], …] (ou { night, members })`);
      continue;
    }
    const members: { enemy: string; min: number; max: number }[] = [];
    groups[id] = { members, night };
    for (const entry of raw as unknown[]) {
      const [enemy, min, max] = Array.isArray(entry) ? (entry as unknown[]) : [];
      if (typeof enemy !== 'string' || !enemies.has(enemy))
        problems.push(`"${id}": inimigo desconhecido ${describe(enemy)}`);
      else if (!isPositiveInt(min) || !isPositiveInt(max) || max < min)
        problems.push(`"${id}": ${enemy} com mín/máx inválidos`);
      else members.push({ enemy, min, max });
    }
  }
  if (problems.length > 0) throw new DataError('enemyGroups.json', problems);
  return groups;
}

/** Zona (CLAUDE.md §8.2, §9.4). */
export interface ZoneDef {
  /** Chave i18n do nome. */
  name: string;
  /** Mapa Tiled, relativo a `public/assets/`. */
  map: string;
  /** Nível de perigo: 0 = segura (base), 1–4 = T1–T4. */
  danger: number;
  /** Posição no mapa-mundo (0–100 em cada eixo; a base fica ao centro). */
  worldMapPos: { x: number; y: number };
  /** Custo de viajar até lá (fome e sede). */
  travelCost: { hunger: number; thirst: number };
  /** Dias de jogo até os contentores voltarem a ter loot. */
  respawnDays: number;
  /** Nível do jogador para desbloquear. */
  unlockLevel: number;
  /** Mais inimigos à noite (§7.11): multiplica as quantidades dos grupos. */
  nightEnemyMultiplier: number;
  /** Item que é preciso ter (não se gasta) para viajar até lá (ex.: a chave do bunker). */
  requiresItem?: string;
  /** Chave i18n de uma pista mostrada no mapa-mundo enquanto falta o `requiresItem`. */
  hint?: string;
  /**
   * Masmorra com pisos (bunker, Fase 10): zonas com o mesmo `dungeon`, piso 1 no mapa-mundo e os
   * outros escondidos (`hidden`). Viajar para lá leva ao piso mais fundo já alcançado (checkpoint).
   */
  dungeon?: { id: string; floor: number };
  /** Não aparece no mapa-mundo (pisos de baixo de uma masmorra). */
  hidden: boolean;
  /** Sempre escura (debaixo de terra): `darkness` do véu, em vez do dia/noite. */
  darkness?: number;
  /**
   * Zona-evento (§8.3): só existe durante `durationDays` dias de jogo, a cada `everyDays`, a
   * começar no dia `offsetDays` (calculado a partir do relógio; não se grava).
   */
  event?: WorldEventDef;
}

export interface WorldEventDef {
  everyDays: number;
  durationDays: number;
  offsetDays: number;
}

export type ZoneDefs = Readonly<Record<string, ZoneDef>>;

/** Valida `zones.json` (os ficheiros dos mapas são verificados pelo validate-data). */
export function parseZones(input: unknown): ZoneDefs {
  if (!isObject(input)) throw new DataError('zones.json', ['tem de ser um objeto id → zona']);
  const problems: string[] = [];
  const defs: Record<string, ZoneDef> = {};
  for (const [id, raw] of Object.entries(input)) {
    if (id === '$comment') continue;
    if (!/^zone_[a-z0-9_]+$/.test(id)) problems.push(`"${id}": o id tem de começar por zone_`);
    if (!isObject(raw)) {
      problems.push(`"${id}": tem de ser um objeto`);
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (
        ![
          'name',
          'map',
          'danger',
          'worldMapPos',
          'travelCost',
          'respawnDays',
          'unlockLevel',
          'nightEnemyMultiplier',
          'requiresItem',
          'hint',
          'dungeon',
          'hidden',
          'darkness',
          'event',
        ].includes(key)
      )
        problems.push(`"${id}": campo desconhecido "${key}"`);
    }
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (name !== `zone.${id.slice('zone_'.length)}`)
      problems.push(`"${id}": name tem de ser "zone.${id.slice(5)}"`);
    const map = typeof raw.map === 'string' ? raw.map : '';
    if (!/^maps\/[a-z0-9_]+\.json$/.test(map)) problems.push(`"${id}": map tem de ser "maps/<nome>.json"`);
    const danger = raw.danger;
    if (!isNonNegativeInt(danger) || danger > 4) problems.push(`"${id}": danger tem de ser 0–4`);
    const [px, py] = Array.isArray(raw.worldMapPos) ? (raw.worldMapPos as unknown[]) : [];
    const inRange = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 100;
    if (!inRange(px) || !inRange(py)) problems.push(`"${id}": worldMapPos tem de ser [x, y] entre 0 e 100`);
    const cost = isObject(raw.travelCost) ? raw.travelCost : {};
    const hunger = cost.hunger ?? 0;
    const thirst = cost.thirst ?? 0;
    if (!isNonNegativeInt(hunger) || !isNonNegativeInt(thirst))
      problems.push(`"${id}": travelCost tem de ser { hunger, thirst } inteiros ≥ 0`);
    const respawnDays = raw.respawnDays ?? 1;
    if (typeof respawnDays !== 'number' || respawnDays <= 0)
      problems.push(`"${id}": respawnDays tem de ser > 0`);
    const unlockLevel = raw.unlockLevel ?? 1;
    if (!isPositiveInt(unlockLevel)) problems.push(`"${id}": unlockLevel tem de ser um inteiro > 0`);
    const def: ZoneDef = {
      name,
      map,
      danger: isNonNegativeInt(danger) ? danger : 0,
      worldMapPos: { x: inRange(px) ? px : 50, y: inRange(py) ? py : 50 },
      travelCost: {
        hunger: isNonNegativeInt(hunger) ? hunger : 0,
        thirst: isNonNegativeInt(thirst) ? thirst : 0,
      },
      respawnDays: typeof respawnDays === 'number' && respawnDays > 0 ? respawnDays : 1,
      unlockLevel: isPositiveInt(unlockLevel) ? unlockLevel : 1,
      nightEnemyMultiplier:
        typeof raw.nightEnemyMultiplier === 'number' && raw.nightEnemyMultiplier > 0
          ? raw.nightEnemyMultiplier
          : 1,
      hidden: raw.hidden === true,
    };
    defs[id] = def;
    if (
      raw.nightEnemyMultiplier !== undefined &&
      !(typeof raw.nightEnemyMultiplier === 'number' && raw.nightEnemyMultiplier > 0)
    )
      problems.push(`"${id}": nightEnemyMultiplier tem de ser > 0`);
    if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean')
      problems.push(`"${id}": hidden tem de ser true/false`);
    if (raw.requiresItem !== undefined) {
      if (typeof raw.requiresItem === 'string' && raw.requiresItem !== '')
        def.requiresItem = raw.requiresItem;
      else problems.push(`"${id}": requiresItem tem de ser o id de um item`);
    }
    if (raw.hint !== undefined) {
      if (typeof raw.hint === 'string' && raw.hint !== '') def.hint = raw.hint;
      else problems.push(`"${id}": hint tem de ser uma chave i18n`);
    }
    if (raw.dungeon !== undefined) {
      const d = raw.dungeon;
      if (isObject(d) && typeof d.id === 'string' && isPositiveInt(d.floor))
        def.dungeon = { id: d.id, floor: d.floor };
      else problems.push(`"${id}": dungeon tem de ser { id, floor }`);
    }
    if (raw.event !== undefined) {
      const e = raw.event;
      if (
        isObject(e) &&
        isPositiveInt(e.everyDays) &&
        isPositiveInt(e.durationDays) &&
        isNonNegativeInt(e.offsetDays) &&
        e.durationDays < e.everyDays
      )
        def.event = { everyDays: e.everyDays, durationDays: e.durationDays, offsetDays: e.offsetDays };
      else problems.push(`"${id}": event tem de ser { everyDays, durationDays < everyDays, offsetDays }`);
    }
    if (raw.darkness !== undefined) {
      if (typeof raw.darkness === 'number' && raw.darkness > 0 && raw.darkness <= 1)
        def.darkness = raw.darkness;
      else problems.push(`"${id}": darkness tem de ser um número entre 0 e 1`);
    }
  }
  // Cada masmorra tem um piso 1 visível e pisos seguidos (1, 2, 3…).
  const dungeons = new Map<string, number[]>();
  for (const def of Object.values(defs)) {
    if (def.dungeon)
      dungeons.set(def.dungeon.id, [...(dungeons.get(def.dungeon.id) ?? []), def.dungeon.floor]);
  }
  for (const [dungeon, floors] of dungeons) {
    const sorted = [...floors].sort((a, b) => a - b);
    if (!sorted.every((f, i) => f === i + 1))
      problems.push(`masmorra "${dungeon}": pisos têm de ser 1, 2, 3…`);
  }
  for (const [id, def] of Object.entries(defs)) {
    if (def.dungeon && (def.dungeon.floor === 1) === def.hidden)
      problems.push(`"${id}": numa masmorra só o piso 1 aparece no mapa-mundo (os outros são hidden)`);
  }
  if (problems.length > 0) throw new DataError('zones.json', problems);
  return defs;
}

/** Entrada de uma tabela de loot: item, peso (probabilidade relativa), quantidade mín–máx. */
export interface LootEntry {
  item: string;
  weight: number;
  min: number;
  max: number;
}

/** Contentor com loot (`container:<tabela>` nos mapas, CLAUDE.md §7.10). */
export interface LootTableDef extends WorldObjectDef {
  /** Quantas tiragens (mín–máx). */
  rolls: { min: number; max: number };
  /** Slots do contentor. */
  slots: number;
  /** "Pity" (§7.10): garante pelo menos um item incomum ou melhor. */
  guaranteeUncommon: boolean;
  entries: readonly LootEntry[];
}

export type LootTables = Readonly<Record<string, LootTableDef>>;

/** Valida `lootTables.json`. */
export function parseLootTables(
  input: unknown,
  spriteKeys: Iterable<string>,
  itemIds: Iterable<string>,
): LootTables {
  const items = new Set(itemIds);
  return parseWorldObjects(
    input,
    spriteKeys,
    'lootTables.json',
    ['rolls', 'slots', 'guaranteeUncommon', 'entries'],
    (id, raw, problems) => {
      const [rmin, rmax] = Array.isArray(raw.rolls) ? (raw.rolls as unknown[]) : [];
      const rollsOk = isPositiveInt(rmin) && isPositiveInt(rmax) && rmax >= rmin;
      if (!rollsOk) problems.push(`"${id}": rolls tem de ser [mín, máx] inteiros > 0`);
      if (!isPositiveInt(raw.slots) || raw.slots > 24) problems.push(`"${id}": slots tem de ser 1–24`);
      if (raw.guaranteeUncommon !== undefined && typeof raw.guaranteeUncommon !== 'boolean')
        problems.push(`"${id}": guaranteeUncommon tem de ser true/false`);
      const entries: LootEntry[] = [];
      if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
        problems.push(`"${id}": entries tem de ser [[item, peso, mín, máx], …]`);
      } else {
        for (const entry of raw.entries as unknown[]) {
          const [item, weight, min, max] = Array.isArray(entry) ? (entry as unknown[]) : [];
          if (typeof item !== 'string' || !items.has(item))
            problems.push(`"${id}": item desconhecido ${describe(item)}`);
          else if (!isPositiveInt(weight) || !isPositiveInt(min) || !isPositiveInt(max) || max < min)
            problems.push(`"${id}": ${item} com peso/mín/máx inválidos`);
          else entries.push({ item, weight, min, max });
        }
      }
      if (rollsOk && isPositiveInt(raw.slots) && rmax > raw.slots)
        problems.push(`"${id}": mais tiragens do que slots`);
      return {
        rolls: rollsOk ? { min: rmin, max: rmax } : { min: 1, max: 1 },
        slots: isPositiveInt(raw.slots) ? raw.slots : 1,
        guaranteeUncommon: raw.guaranteeUncommon === true,
        entries,
      };
    },
  );
}

/** Campo `xp` opcional (inteiro ≥ 0). */
function optionalXp(where: string, raw: Record<string, unknown>, problems: string[]): { xp?: number } {
  if (raw.xp === undefined) return {};
  if (typeof raw.xp === 'number' && Number.isInteger(raw.xp) && raw.xp >= 0) return { xp: raw.xp };
  problems.push(`${where}: xp tem de ser um inteiro ≥ 0`);
  return {};
}

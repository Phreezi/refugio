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

export type ResourceDef = WorldObjectDef;
export type ResourceDefs = Readonly<Record<string, ResourceDef>>;
/** Obstáculos e decoração (`props.json`): troncos, caixotes, carros abandonados… */
export type PropDefs = Readonly<Record<string, WorldObjectDef>>;

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

/**
 * Valida `resources.json`.
 * @param spriteKeys chaves de textura existentes no manifest.
 */
export function parseResources(input: unknown, spriteKeys: Iterable<string>): ResourceDefs {
  return parseWorldObjects(input, spriteKeys, 'resources.json');
}

/** Valida `props.json`. */
export function parseProps(input: unknown, spriteKeys: Iterable<string>): PropDefs {
  return parseWorldObjects(input, spriteKeys, 'props.json');
}

function parseWorldObjects(
  input: unknown,
  spriteKeys: Iterable<string>,
  file: string,
): Readonly<Record<string, WorldObjectDef>> {
  if (!isObject(input)) throw new DataError(file, ['tem de ser um objeto id → definição']);
  const sprites = new Set(spriteKeys);
  const problems: string[] = [];
  const defs: Record<string, WorldObjectDef> = {};
  for (const [id, raw] of Object.entries(input)) {
    if (id === '$comment') continue;
    if (!ID_PATTERN.test(id)) problems.push(`"${id}": o id tem de estar em snake_case`);
    if (!isObject(raw)) {
      problems.push(`"${id}": tem de ser um objeto`);
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (key !== 'sprite' && key !== 'footprint') problems.push(`"${id}": campo desconhecido "${key}"`);
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
    defs[id] = def;
  }
  if (problems.length > 0) throw new DataError(file, problems);
  return defs;
}

// Leitura e validação de mapas Tiled (JSON) das zonas (CLAUDE.md §8.4).
// Módulo puro: também é usado por scripts/validate-data.ts (Node, sem bundler),
// por isso não importa outros módulos em runtime.

/** Camadas de tiles, de baixo para cima. `collision` é desenhada e bloqueia o movimento. */
export const TILE_LAYERS = ['ground', 'decor_low', 'collision', 'decor_high'] as const;
export type TileLayerName = (typeof TILE_LAYERS)[number];

export const OBJECT_LAYER = 'objects';

/** Número mínimo de saídas para o mapa-mundo em cada zona (§8.4). */
export const MIN_EXITS = 2;

/** Bits de rotação/espelho que o Tiled guarda nos gids (a ignorar para saber o tile). */
const GID_FLAGS_MASK = 0x1fffffff;

export interface Point {
  x: number;
  y: number;
}

/** Objeto `resource:<id>`/`prop:<id>`/`chest:<id>`: ponto = pés (meio da base do sprite). */
export interface ResourcePlacement extends Point {
  id: string;
  /**
   * Id do objeto no Tiled (único e estável no mapa). O save guarda os recursos apanhados por
   * este id, por isso não se deve reutilizar ids ao editar (o Tiled nunca o faz).
   */
  objectId: number;
}

/** Objetos das fases seguintes (`container:<lootTableId>`, `enemy_spawn:<groupId>`). */
export interface TaggedPoint extends Point {
  id: string;
}

export interface ZoneMap {
  /** Em tiles. */
  width: number;
  height: number;
  tileSize: number;
  /** Um booleano por tile (linha a linha): true = bloqueia o movimento. */
  solid: readonly boolean[];
  playerSpawn: Point;
  exits: readonly Point[];
  resources: readonly ResourcePlacement[];
  /** Obstáculos/decoração `prop:<id>` (posição livre; ponto = pés). */
  props: readonly ResourcePlacement[];
  /** Baús (`chest:<id>`): o id é a chave do conteúdo em `base.chests` no save. */
  chests: readonly ResourcePlacement[];
  containers: readonly TaggedPoint[];
  enemySpawns: readonly TaggedPoint[];
}

export interface ZoneMapRules {
  tileSize: number;
  /** Tilesets permitidos: nome → número de tiles. */
  tilesets: Readonly<Record<string, number>>;
  /** Ids válidos em `resource:<id>`. */
  resourceIds: Iterable<string>;
  /** Ids válidos em `prop:<id>`. */
  propIds: Iterable<string>;
}

export class ZoneMapError extends Error {
  readonly problems: readonly string[];

  constructor(where: string, problems: readonly string[]) {
    super(`Mapa inválido (${where}):\n- ${problems.join('\n- ')}`);
    this.name = 'ZoneMapError';
    this.problems = problems;
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

interface GidRange {
  first: number;
  count: number;
}

function parseTilesets(raw: unknown, rules: ZoneMapRules, problems: string[]): GidRange[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('falta a lista "tilesets"');
    return [];
  }
  const ranges: GidRange[] = [];
  for (const [i, ts] of raw.entries()) {
    const where = `tilesets[${String(i)}]`;
    if (!isObject(ts)) {
      problems.push(`${where}: tem de ser um objeto`);
      continue;
    }
    if (ts.source !== undefined) {
      problems.push(
        `${where}: tileset externo (${JSON.stringify(ts.source)}); o Phaser só lê tilesets embebidos`,
      );
      continue;
    }
    const name = typeof ts.name === 'string' ? ts.name : '';
    const expected = rules.tilesets[name];
    if (expected === undefined) {
      problems.push(`${where}: tileset desconhecido "${name}"`);
      continue;
    }
    if (ts.tilecount !== expected) {
      problems.push(`${where}: "${name}" tem ${String(ts.tilecount)} tiles, esperados ${String(expected)}`);
    }
    if (ts.tilewidth !== rules.tileSize || ts.tileheight !== rules.tileSize) {
      problems.push(
        `${where}: tiles de ${String(ts.tilewidth)}×${String(ts.tileheight)} (esperado ${String(rules.tileSize)})`,
      );
    }
    if (!isPositiveInt(ts.firstgid)) {
      problems.push(`${where}: firstgid inválido`);
      continue;
    }
    ranges.push({ first: ts.firstgid, count: expected });
  }
  return ranges;
}

function parseTileLayer(
  layer: JsonObject,
  size: number,
  ranges: readonly GidRange[],
  problems: string[],
): number[] {
  const name = String(layer.name);
  const data = layer.data;
  if (!Array.isArray(data) || data.length !== size) {
    problems.push(
      `camada "${name}": data tem de ter ${String(size)} gids (sem compressão, formato CSV/array)`,
    );
    return [];
  }
  const gids: number[] = [];
  let bad = 0;
  for (const value of data) {
    const gid = typeof value === 'number' && Number.isInteger(value) ? value & GID_FLAGS_MASK : -1;
    const known = gid === 0 || ranges.some((r) => gid >= r.first && gid < r.first + r.count);
    if (!known) bad++;
    gids.push(known ? gid : 0);
  }
  if (bad > 0) problems.push(`camada "${name}": ${String(bad)} tiles com gid fora dos tilesets`);
  return gids;
}

function splitName(name: string): [string, string | null] {
  const colon = name.indexOf(':');
  return colon < 0 ? [name, null] : [name.slice(0, colon), name.slice(colon + 1)];
}

/**
 * Valida um mapa Tiled exportado em JSON e extrai o que a lógica precisa (colisões e objetos).
 * O desenho continua a cargo do Phaser, que lê o mesmo JSON. Junta todos os problemas num
 * único `ZoneMapError`, para se corrigirem de uma vez.
 * @param where nome do ficheiro, para as mensagens de erro.
 */
export function parseZoneMap(input: unknown, rules: ZoneMapRules, where: string): ZoneMap {
  if (!isObject(input)) throw new ZoneMapError(where, ['o ficheiro não contém um objeto JSON']);
  const problems: string[] = [];

  if (input.orientation !== 'orthogonal') problems.push('orientation tem de ser "orthogonal"');
  if (input.infinite !== false) problems.push('o mapa não pode ser infinito');
  if (input.tilewidth !== rules.tileSize || input.tileheight !== rules.tileSize) {
    problems.push(`tiles do mapa têm de ser ${String(rules.tileSize)}×${String(rules.tileSize)}`);
  }
  const width = input.width;
  const height = input.height;
  if (!isPositiveInt(width) || !isPositiveInt(height)) {
    problems.push('width/height inválidos');
    throw new ZoneMapError(where, problems);
  }

  const ranges = parseTilesets(input.tilesets, rules, problems);
  const layers = Array.isArray(input.layers) ? input.layers.filter(isObject) : [];
  const size = width * height;

  let solid: boolean[] = new Array<boolean>(size).fill(false);
  for (const name of TILE_LAYERS) {
    const found = layers.filter((l) => l.name === name);
    if (found.length !== 1 || found[0]?.type !== 'tilelayer') {
      problems.push(`tem de existir exatamente uma camada de tiles "${name}"`);
      continue;
    }
    const gids = parseTileLayer(found[0], size, ranges, problems);
    if (name === 'collision' && gids.length === size) solid = gids.map((gid) => gid !== 0);
  }
  for (const layer of layers) {
    const name = String(layer.name);
    if (!(TILE_LAYERS as readonly string[]).includes(name) && name !== OBJECT_LAYER) {
      problems.push(
        `camada desconhecida "${name}" (permitidas: ${[...TILE_LAYERS, OBJECT_LAYER].join(', ')})`,
      );
    }
  }

  const resourceIds = new Set(rules.resourceIds);
  const propIds = new Set(rules.propIds);
  const props: ResourcePlacement[] = [];
  const chests: ResourcePlacement[] = [];
  const objectIds = new Set<number>();
  const spawns: Point[] = [];
  const exits: Point[] = [];
  const resources: ResourcePlacement[] = [];
  const containers: TaggedPoint[] = [];
  const enemySpawns: TaggedPoint[] = [];
  const objectLayers = layers.filter((l) => l.name === OBJECT_LAYER);
  const objectLayer = objectLayers[0];
  if (
    objectLayers.length !== 1 ||
    objectLayer?.type !== 'objectgroup' ||
    !Array.isArray(objectLayer.objects)
  ) {
    problems.push(`tem de existir exatamente uma camada de objetos "${OBJECT_LAYER}"`);
  } else {
    const pxWidth = width * rules.tileSize;
    const pxHeight = height * rules.tileSize;
    for (const obj of objectLayer.objects.filter(isObject)) {
      const name = typeof obj.name === 'string' ? obj.name : '';
      const { x, y } = obj;
      const label = `objeto "${name}" (id ${String(obj.id)})`;
      if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || y < 0 || x > pxWidth || y > pxHeight) {
        problems.push(`${label}: posição fora do mapa`);
        continue;
      }
      const point = { x, y };
      const objectId = typeof obj.id === 'number' && Number.isInteger(obj.id) && obj.id > 0 ? obj.id : 0;
      if (objectId === 0 || objectIds.has(objectId))
        problems.push(`${label}: id de objeto inválido ou repetido`);
      objectIds.add(objectId);
      const [kind, id] = splitName(name);
      if (kind === 'player_spawn' && id === null) spawns.push(point);
      else if (kind === 'exit' && id === null) exits.push(point);
      else if (kind === 'resource' && id !== null) {
        if (resourceIds.has(id)) resources.push({ id, objectId, ...point });
        else problems.push(`${label}: recurso desconhecido "${id}"`);
      } else if (kind === 'prop' && id !== null) {
        if (propIds.has(id)) props.push({ id, objectId, ...point });
        else problems.push(`${label}: obstáculo desconhecido "${id}"`);
      } else if (kind === 'chest' && id) {
        if (chests.some((c) => c.id === id)) problems.push(`${label}: baú "${id}" repetido`);
        else chests.push({ id, objectId, ...point });
      } else if (kind === 'container' && id) containers.push({ id, ...point });
      else if (kind === 'enemy_spawn' && id) enemySpawns.push({ id, ...point });
      else {
        problems.push(
          `${label}: nome inválido (player_spawn, exit, resource:<id>, prop:<id>, chest:<id>, container:<id>, enemy_spawn:<id>)`,
        );
      }
    }
  }

  if (spawns.length !== 1)
    problems.push(`tem de haver exatamente um player_spawn (há ${String(spawns.length)})`);
  if (exits.length < MIN_EXITS) {
    problems.push(`tem de haver pelo menos ${String(MIN_EXITS)} saídas "exit" (há ${String(exits.length)})`);
  }
  const spawn = spawns[0] ?? { x: 0, y: 0 };
  const spawnTile = Math.floor(spawn.y / rules.tileSize) * width + Math.floor(spawn.x / rules.tileSize);
  if (spawns.length === 1 && solid[spawnTile] === true)
    problems.push('o player_spawn está num tile de colisão');

  if (problems.length > 0) throw new ZoneMapError(where, problems);
  return {
    width,
    height,
    tileSize: rules.tileSize,
    solid,
    playerSpawn: spawn,
    exits,
    resources,
    props,
    chests,
    containers,
    enemySpawns,
  };
}

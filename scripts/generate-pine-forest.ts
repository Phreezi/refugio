// Gera o mapa do Pinhal (public/assets/maps/pine_forest.json), a primeira zona (CLAUDE.md §8.2):
// floresta de 64×64 com clareiras, um caminho de terra, recursos, obstáculos e pontos de inimigos.
// Tal como o da base, é só o ponto de partida: depois edita-se no Tiled, por isso NÃO reescreve
// um mapa existente sem `--force`. Uso: `npm run map:pine` (ou `npm run map:pine -- --force`).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  BASE_TILES,
  BASE_TILESET_FILE,
  BASE_TILESET_NAME,
  baseTileIndex,
  type BaseTile,
} from '../src/world/tileset.ts';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('public/assets/maps/pine_forest.json', ROOT);
const TILE = 16;
const W = 64;
const H = 64;
/** Entrada a oeste (de onde se vem da base): o jogador aparece aqui, numa zona sem inimigos. */
const SPAWN = { tx: 3, ty: 32 };
/** Linhas das duas saídas a oeste (voltam à base). */
const EXIT_ROWS = [20, 44] as const;
/** Raio (tiles) da zona segura à volta da entrada: sem inimigos. */
const SAFE_RADIUS = 14;

if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.error(
    'maps/pine_forest.json já existe (pode ter edições do Tiled). Usar --force para o substituir.',
  );
  process.exit(1);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const random = rng(20260925);

const ground: (BaseTile | null)[] = new Array<BaseTile | null>(W * H).fill('grass');
const collision: (BaseTile | null)[] = new Array<BaseTile | null>(W * H).fill(null);
const at = (x: number, y: number): number => y * W + x;
const path = new Set<number>();

// Caminho de terra: das duas saídas a oeste até ao centro, e daí para a clareira a este.
function carve(x0: number, y0: number, x1: number, y1: number): void {
  let x = x0;
  let y = y0;
  while (x !== x1 || y !== y1) {
    for (const [dx, dy] of [
      [0, 0],
      [0, 1],
    ] as const) {
      path.add(at(x + dx, y + dy));
    }
    if (x !== x1 && (y === y1 || random() < 0.6)) x += Math.sign(x1 - x);
    else y += Math.sign(y1 - y);
  }
}
carve(0, EXIT_ROWS[0], 12, 32);
carve(0, EXIT_ROWS[1], 12, 32);
carve(0, SPAWN.ty, 30, 32);
carve(30, 32, 50, 22);
carve(30, 32, 46, 48);

// Clareiras (sítios abertos com erva e flores).
const clearings = [
  { cx: 30, cy: 32, r: 5 },
  { cx: 50, cy: 22, r: 6 },
  { cx: 46, cy: 48, r: 5 },
];
const inClearing = (x: number, y: number): boolean =>
  clearings.some((c) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r ** 2);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = at(x, y);
    if (path.has(i)) ground[i] = 'dirt';
    else if (inClearing(x, y) ? random() < 0.2 : random() < 0.05) ground[i] = 'grass_flowers';
    // Orla da floresta: rochedos no perímetro, com aberturas nas saídas.
    const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    const gap = x === 0 && EXIT_ROWS.some((row) => y === row || y === row + 1);
    if (border && !gap) collision[i] = 'boulder';
  }
}
// Alguns rochedos soltos para dar forma.
for (const [x, y] of [
  [20, 10],
  [21, 10],
  [40, 38],
  [41, 38],
  [41, 39],
  [56, 34],
  [12, 54],
  [13, 54],
] as const) {
  collision[at(x, y)] = 'boulder';
}

interface Placement {
  name: string;
  x: number;
  y: number;
}
const placements: Placement[] = [];
const taken = new Set<number>();

function freeArea(x0: number, y0: number, x1: number, y1: number): boolean {
  if (x0 < 2 || y0 < 2 || x1 > W - 3 || y1 > H - 3) return false;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = at(x, y);
      if (taken.has(i) || collision[i] !== null || path.has(i)) return false;
    }
  }
  return true;
}

function take(x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) taken.add(at(x, y));
}

function feetIn(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE + 4 + Math.floor(random() * 9), y: (ty + 1) * TILE - 1 - Math.floor(random() * 4) };
}

const nearSpawn = (tx: number, ty: number, r: number): boolean =>
  Math.abs(tx - SPAWN.tx) <= r && Math.abs(ty - SPAWN.ty) <= r;

/** Espalha objetos por tiles livres; `avoid` = não pôr perto da entrada. */
function scatter(
  kind: 'resource' | 'prop',
  id: string,
  count: number,
  clearance: number,
  hTiles = 1,
  opts: { clearings?: boolean; avoidSpawn?: number } = {},
): void {
  let placed = 0;
  for (let attempt = 0; placed < count && attempt < count * 400; attempt++) {
    const tx = 2 + Math.floor(random() * (W - 4));
    const ty = 2 + Math.floor(random() * (H - 4));
    if (opts.clearings === false && inClearing(tx, ty)) continue;
    if (nearSpawn(tx, ty, opts.avoidSpawn ?? 2)) continue;
    if (!freeArea(tx - clearance, ty - hTiles + 1 - clearance, tx + clearance, ty + clearance)) continue;
    take(tx, ty - hTiles + 1, tx, ty);
    placements.push({ name: `${kind}:${id}`, ...feetIn(tx, ty) });
    placed++;
  }
  if (placed < count) throw new Error(`Só coube ${String(placed)}/${String(count)} de ${id}`);
}

// Pontos de inimigos: longe da entrada (zona segura), mais para dentro da floresta.
const spawns: [string, number, number][] = [
  ['walker', 22, 20],
  ['walker', 24, 44],
  ['walkers', 34, 28],
  ['walkers', 48, 20],
  ['walkers', 44, 46],
  ['walkers', 56, 40],
  ['deer', 30, 12],
  ['deer', 36, 54],
  ['deer', 54, 10],
  ['wolf', 58, 56],
];
for (const [group, tx, ty] of spawns) {
  if (nearSpawn(tx, ty, SAFE_RADIUS)) throw new Error(`enemy_spawn:${group} dentro da zona segura`);
  placements.push({ name: `enemy_spawn:${group}`, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
  take(tx - 1, ty - 1, tx + 1, ty + 1);
}

scatter('resource', 'tree_large', 30, 2, 3, { clearings: false });
scatter('resource', 'tree_small', 80, 1, 2, { clearings: false });
scatter('prop', 'stump', 12, 1);
scatter('prop', 'log', 6, 2);
scatter('resource', 'rock', 16, 1);
scatter('resource', 'bush_berries', 14, 1);
scatter('resource', 'tall_grass', 36, 0);
scatter('prop', 'pebbles', 20, 0);

const gid = (tile: BaseTile | null): number => (tile === null ? 0 : baseTileIndex(tile) + 1);
let nextObjectId = 1;
const point = (name: string, x: number, y: number) => ({
  id: nextObjectId++,
  name,
  type: '',
  x,
  y,
  width: 0,
  height: 0,
  rotation: 0,
  point: true,
  visible: true,
});

const objects = [
  point('player_spawn', SPAWN.tx * TILE + TILE / 2, SPAWN.ty * TILE + TILE / 2),
  ...EXIT_ROWS.map((row) => point('exit:zone_base', TILE / 2, (row + 1) * TILE)),
  ...placements.sort((a, b) => a.y - b.y || a.x - b.x).map((p) => point(p.name, p.x, p.y)),
];

let nextLayerId = 1;
const tileLayer = (name: string, data: readonly (BaseTile | null)[]) => ({
  id: nextLayerId++,
  name,
  type: 'tilelayer',
  x: 0,
  y: 0,
  width: W,
  height: H,
  opacity: 1,
  visible: true,
  data: data.map(gid),
});
const empty = new Array<BaseTile | null>(W * H).fill(null);

const map = {
  type: 'map',
  version: '1.10',
  tiledversion: '1.11.2',
  orientation: 'orthogonal',
  renderorder: 'right-down',
  infinite: false,
  compressionlevel: -1,
  width: W,
  height: H,
  tilewidth: TILE,
  tileheight: TILE,
  layers: [
    tileLayer('ground', ground),
    tileLayer('decor_low', empty),
    tileLayer('collision', collision),
    tileLayer('decor_high', empty),
    {
      id: nextLayerId++,
      name: 'objects',
      type: 'objectgroup',
      draworder: 'topdown',
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      objects,
    },
  ],
  tilesets: [
    {
      firstgid: 1,
      name: BASE_TILESET_NAME,
      image: `../${BASE_TILESET_FILE}`,
      imagewidth: TILE * BASE_TILES.length,
      imageheight: TILE,
      tilewidth: TILE,
      tileheight: TILE,
      tilecount: BASE_TILES.length,
      columns: BASE_TILES.length,
      margin: 0,
      spacing: 0,
    },
  ],
  nextlayerid: nextLayerId,
  nextobjectid: nextObjectId,
};

mkdirSync(new URL('./', OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(map)}\n`);
console.log(`maps/pine_forest.json: ${String(W)}×${String(H)} tiles, ${String(objects.length)} objetos`);

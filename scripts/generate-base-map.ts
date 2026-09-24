// Gera o primeiro mapa da base (public/assets/maps/base.json) no formato JSON do Tiled.
// É só o ponto de partida: depois de gerado, o mapa edita-se no Tiled (abrir o .json).
// Por isso NÃO reescreve um mapa existente sem `--force` (perder-se-iam as edições).
// Uso: `npm run map:base` (ou `npm run map:base -- --force`).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  BASE_TILES,
  BASE_TILESET_FILE,
  BASE_TILESET_NAME,
  baseTileIndex,
  type BaseTile,
} from '../src/world/tileset.ts';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('public/assets/maps/base.json', ROOT);
const TILE = 16;
const W = 48;
const H = 48;

/** Colunas/linhas do caminho de terra e das saídas (aberturas na vedação). */
const PATH_X = [24, 25] as const;
const PATH_Y = [26, 27] as const;

/** Ruína de casa: chão de betão com paredes à volta e porta a sul. */
const HOUSE = { x0: 19, y0: 14, x1: 30, y1: 22, door: [24, 25] as const };

/** Lago a noroeste (elipse), com areia à volta. */
const POND = { cx: 10.5, cy: 11.5, rx: 5.5, ry: 4 };

const SPAWN = { tx: 24, ty: 24 };

if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.error('maps/base.json já existe (pode ter edições do Tiled). Usar --force para o substituir.');
  process.exit(1);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const random = rng(20260924);
const has = (list: readonly number[], value: number): boolean => list.includes(value);

const ground: (BaseTile | null)[] = new Array<BaseTile | null>(W * H).fill('grass');
const collision: (BaseTile | null)[] = new Array<BaseTile | null>(W * H).fill(null);
const at = (x: number, y: number): number => y * W + x;
const inHouse = (x: number, y: number): boolean =>
  x >= HOUSE.x0 && x <= HOUSE.x1 && y >= HOUSE.y0 && y <= HOUSE.y1;
const pondValue = (x: number, y: number): number =>
  ((x + 0.5 - POND.cx) / POND.rx) ** 2 + ((y + 0.5 - POND.cy) / POND.ry) ** 2;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = at(x, y);
    const pond = pondValue(x, y);
    if (pond <= 1) {
      ground[i] = 'sand';
      collision[i] = 'water';
    } else if (pond <= 1.6) {
      ground[i] = 'sand';
    } else if (inHouse(x, y)) {
      ground[i] = x <= HOUSE.x0 + 3 ? 'floor_wood' : 'floor_concrete';
      const edge = x === HOUSE.x0 || x === HOUSE.x1 || y === HOUSE.y0 || y === HOUSE.y1;
      const door = y === HOUSE.y1 && has(HOUSE.door, x);
      // Parede interior a separar o quarto de madeira, com passagem.
      const inner = x === HOUSE.x0 + 4 && y !== HOUSE.y0 + 4 && y !== HOUSE.y0 + 5;
      if ((edge && !door) || inner) collision[i] = 'wall';
    } else if (
      (has(PATH_X, x) && y > HOUSE.y1) ||
      (has(PATH_Y, y) && x >= PATH_X[0]) ||
      (y === HOUSE.y1 + 1 && x >= HOUSE.door[0] - 1 && x <= HOUSE.door[1] + 1)
    ) {
      ground[i] = 'dirt';
    } else if (random() < 0.06) {
      ground[i] = 'grass_flowers';
    }

    // Vedação no perímetro, com aberturas no caminho (saídas a este e a sul).
    const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    const gap = (x === W - 1 && has(PATH_Y, y)) || (y === H - 1 && has(PATH_X, x));
    if (border && !gap) collision[i] = 'fence';
  }
}

// Rochedos junto à vedação norte e oeste.
for (const [x, y] of [
  [2, 2],
  [3, 2],
  [2, 3],
  [20, 1],
  [21, 1],
  [36, 2],
  [1, 30],
  [1, 31],
  [2, 31],
  [44, 40],
  [45, 40],
  [45, 41],
] as const) {
  collision[at(x, y)] = 'boulder';
}

// Objetos: posição livre (não presa à grelha), para parecer natural. O ponto são os pés.
interface Placement {
  name: string;
  x: number;
  y: number;
}
const placements: Placement[] = [];
const taken = new Set<number>();

/** Área (em tiles) livre de colisões, caminho, casa, outros objetos e da zona de entrada? */
function freeArea(x0: number, y0: number, x1: number, y1: number, nearSpawnOk = false): boolean {
  if (x0 < 2 || y0 < 1 || x1 > W - 3 || y1 > H - 3) return false;
  if (!nearSpawnOk && Math.abs((x0 + x1) / 2 - SPAWN.tx) <= 4 && Math.abs((y0 + y1) / 2 - SPAWN.ty) <= 4) {
    return false;
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = at(x, y);
      if (taken.has(i) || collision[i] !== null) return false;
      const g = ground[i];
      if (g !== 'grass' && g !== 'grass_flowers') return false;
    }
  }
  return true;
}

function take(x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) taken.add(at(x, y));
}

/** Pés num ponto aleatório dentro do tile (sem encostar às arestas). */
function feetIn(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE + 4 + Math.floor(random() * 9), y: (ty + 1) * TILE - 1 - Math.floor(random() * 4) };
}

/**
 * Obstáculo colocado à mão. `wTiles`/`hTiles` = tamanho aproximado do sprite em tiles; a área
 * ocupada fica reservada. Lança erro se o sítio não estiver livre (mapa mal desenhado).
 */
function place(id: string, tx: number, ty: number, wTiles: number, hTiles: number): void {
  const x0 = tx - Math.floor((wTiles - 1) / 2);
  const x1 = x0 + wTiles - 1;
  const y0 = ty - hTiles + 1;
  if (!freeArea(x0 - 1, y0, x1 + 1, ty + 1, true))
    throw new Error(`prop:${id} em (${String(tx)}, ${String(ty)}) não cabe`);
  take(x0 - 1, y0, x1 + 1, ty + 1);
  const offset = wTiles % 2 === 0 ? TILE / 2 : 0; // largura par: centro na aresta entre tiles
  placements.push({ name: `prop:${id}`, x: tx * TILE + TILE / 2 + offset, y: (ty + 1) * TILE - 2 });
}

/** Espalha `count` objetos por tiles livres (com `clearance` tiles à volta). */
function scatter(kind: 'resource' | 'prop', id: string, count: number, clearance: number, hTiles = 1): void {
  let placed = 0;
  for (let attempt = 0; placed < count && attempt < count * 300; attempt++) {
    const tx = 2 + Math.floor(random() * (W - 4));
    const ty = 2 + Math.floor(random() * (H - 4));
    const box = [tx - clearance, ty - hTiles + 1 - clearance, tx + clearance, ty + clearance] as const;
    if (!freeArea(...box)) continue;
    take(tx, ty - hTiles + 1, tx, ty);
    placements.push({ name: `${kind}:${id}`, ...feetIn(tx, ty) });
    placed++;
  }
  if (placed < count) throw new Error(`Só coube ${String(placed)}/${String(count)} de ${id}`);
}

// Obstáculos à mão: o poço junto à casa, um carro abandonado perto do caminho, cantos com tralha.
place('well', 34, 17, 2, 2);
place('car_wreck', 37, 31, 3, 2);
place('crate', 32, 22, 1, 1);
place('barrel', 35, 23, 1, 2);
place('crate', 17, 21, 1, 1);
place('log', 13, 34, 3, 1);
place('log', 40, 9, 3, 1);
place('fence_broken', 5, 21, 2, 1);
place('fence_broken', 29, 40, 2, 1);
place('fence_broken', 42, 20, 2, 1);

scatter('resource', 'tree_large', 8, 2, 3);
scatter('resource', 'tree_small', 22, 1, 2);
scatter('prop', 'stump', 5, 1);
scatter('resource', 'rock', 8, 1);
scatter('resource', 'bush_berries', 6, 1);
scatter('resource', 'tall_grass', 14, 0);
scatter('prop', 'pebbles', 12, 0);

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
  point('exit', (W - 1) * TILE + TILE / 2, PATH_Y[1] * TILE),
  point('exit', PATH_X[1] * TILE, (H - 1) * TILE + TILE / 2),
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
      // Relativo a este ficheiro (maps/), para o Tiled encontrar o PNG.
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
console.log(`maps/base.json: ${String(W)}×${String(H)} tiles, ${String(objects.length)} objetos`);

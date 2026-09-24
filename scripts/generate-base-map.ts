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

// Objetos: recursos espalhados em tiles livres, longe do caminho, da casa e da entrada.
interface Placement {
  name: string;
  tx: number;
  ty: number;
}
const placements: Placement[] = [];
const taken = new Set<number>();
function free(tx: number, ty: number, clearance: number): boolean {
  if (tx < 2 || ty < 2 || tx > W - 3 || ty > H - 3) return false;
  if (Math.abs(tx - SPAWN.tx) <= 4 && Math.abs(ty - SPAWN.ty) <= 4) return false;
  for (let y = ty - clearance; y <= ty + clearance; y++) {
    for (let x = tx - clearance; x <= tx + clearance; x++) {
      const i = at(x, y);
      if (taken.has(i) || collision[i] !== null) return false;
      const g = ground[i];
      if (g !== 'grass' && g !== 'grass_flowers') return false;
    }
  }
  return true;
}
function scatter(id: string, count: number, clearance: number): void {
  let placed = 0;
  for (let attempt = 0; placed < count && attempt < count * 200; attempt++) {
    const tx = 2 + Math.floor(random() * (W - 4));
    const ty = 2 + Math.floor(random() * (H - 4));
    if (!free(tx, ty, clearance)) continue;
    taken.add(at(tx, ty));
    placements.push({ name: `resource:${id}`, tx, ty });
    placed++;
  }
  if (placed < count) throw new Error(`Só coube ${String(placed)}/${String(count)} de ${id}`);
}
scatter('tree_large', 8, 2);
scatter('tree_small', 22, 1);
scatter('rock', 8, 1);
scatter('bush_berries', 6, 1);
scatter('tall_grass', 14, 0);

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

// Recursos: o ponto são os pés (meio do fundo do tile, 2 px acima da aresta).
const objects = [
  point('player_spawn', SPAWN.tx * TILE + TILE / 2, SPAWN.ty * TILE + TILE / 2),
  point('exit', (W - 1) * TILE + TILE / 2, PATH_Y[1] * TILE),
  point('exit', PATH_X[1] * TILE, (H - 1) * TILE + TILE / 2),
  ...placements
    .sort((a, b) => a.ty - b.ty || a.tx - b.tx)
    .map((p) => point(p.name, p.tx * TILE + TILE / 2, (p.ty + 1) * TILE - 2)),
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

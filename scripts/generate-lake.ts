// Gera o mapa da Margem do Lago (public/assets/maps/lake.json, CLAUDE.md §8.2): um lago com
// cais de pesca, argila, erva alta (fibra), uma cabana de pescador e alguns zombies.
// Uso: `npm run map:lake` (não substitui um mapa existente sem `-- --force`).

import { MapBuilder } from './mapgen.ts';

const m = new MapBuilder(64, 64, 20260927);
const SPAWN = { tx: 3, ty: 32 };
const EXITS = [20, 44];
const LAKE = { cx: 36, cy: 28, rx: 14, ry: 10 };
const lakeValue = (x: number, y: number): number =>
  ((x + 0.5 - LAKE.cx) / LAKE.rx) ** 2 + ((y + 0.5 - LAKE.cy) / LAKE.ry) ** 2;

m.border(
  'boulder',
  EXITS.flatMap(
    (y) =>
      [
        [0, y],
        [0, y + 1],
      ] as [number, number][],
  ),
);
for (let y = 1; y < m.h - 1; y++) {
  for (let x = 1; x < m.w - 1; x++) {
    const v = lakeValue(x, y);
    const i = m.at(x, y);
    if (v <= 1) {
      m.ground[i] = 'sand';
      m.collision[i] = 'water';
    } else if (v <= 1.45) {
      m.ground[i] = 'sand';
    }
  }
}
for (const y of EXITS) m.path(0, y, SPAWN.tx + 2, SPAWN.ty);
m.path(SPAWN.tx, SPAWN.ty, 22, 44);
m.path(22, 44, 44, 44);

m.point('player_spawn', SPAWN.tx, SPAWN.ty);
for (const y of EXITS) m.point('exit', 0, y);

// Cais na margem sul: os pés ficam na areia e o pontão entra na água.
for (const x of [28, 36, 44]) {
  let bottom = LAKE.cy;
  while (lakeValue(x, bottom + 1) <= 1) bottom++;
  m.put('prop:dock', x, bottom + 1);
}

// Cabana do pescador (noroeste) com contentores.
m.house(8, 6, 14, 11, 'floor_wood', 10);
m.put('container:fishing_box', 9, 7);
m.put('container:barrel', 13, 7);
m.put('container:crate', 50, 46);
m.put('container:barrel', 20, 50);

for (const [group, x, y] of [
  ['walkers', 50, 12],
  ['walkers', 54, 44],
  ['walker', 30, 52],
  ['walker', 18, 12],
  ['deer', 44, 56],
  ['deer', 56, 26],
] as const) {
  m.point(`enemy_spawn:${group}`, x, y);
}

const entry = { x0: 0, y0: 22, x1: 14, y1: 42 };
m.scatter('resource:clay_pit', 8, 1, 1, entry);
m.scatter('resource:tall_grass', 30, 0);
m.scatter('resource:tree_large', 10, 2, 3, entry);
m.scatter('resource:tree_small', 36, 1, 2, entry);
m.scatter('resource:bush_berries', 8, 1);
m.scatter('resource:rock', 6, 1);
m.scatter('prop:log', 3, 2);
m.scatter('prop:pebbles', 12, 0);
m.flowers(0.05);
m.write('lake.json');

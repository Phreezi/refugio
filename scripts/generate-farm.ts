// Gera o mapa da Quinta Abandonada (public/assets/maps/farm.json, CLAUDE.md §8.2): casa e
// celeiro em ruínas com contentores, campos, poço, um carro e zombies. Uso: `npm run map:farm`
// (não substitui um mapa existente sem `-- --force`: depois de gerado, edita-se no Tiled).

import { MapBuilder } from './mapgen.ts';

const m = new MapBuilder(64, 48, 20260926);
const SPAWN = { tx: 3, ty: 24 };
const EXITS = [14, 34];

m.border(
  'fence',
  EXITS.flatMap(
    (y) =>
      [
        [0, y],
        [0, y + 1],
      ] as [number, number][],
  ),
);
for (const y of EXITS) m.path(0, y, SPAWN.tx + 2, SPAWN.ty);
m.path(SPAWN.tx, SPAWN.ty, 28, 20);
m.path(28, 20, 45, 22);
m.path(28, 20, 28, 15);

// Casa (madeira) e celeiro (betão), com portas a sul.
m.house(24, 6, 33, 14, 'floor_wood', 28);
m.house(40, 8, 52, 18, 'floor_concrete', 45);
// Campos lavrados (terra), com erva alta nalgumas linhas.
for (let y = 30; y <= 42; y++) {
  if (y % 2 === 0) m.fill(10, y, 22, y, 'dirt');
  else m.fill(10, y, 22, y, 'grass');
}

m.point('player_spawn', SPAWN.tx, SPAWN.ty);
for (const y of EXITS) m.point('exit', 0, y);

// Contentores: armários e caixotes na casa, caixotes e barris no celeiro, um no carro.
m.put('container:cabinet', 26, 7);
m.put('container:cabinet', 31, 7);
m.put('container:crate', 25, 12);
m.put('container:crate', 42, 10);
m.put('container:crate', 50, 10);
m.put('container:barrel', 42, 16);
m.put('container:barrel', 50, 16);
m.put('container:crate', 47, 13);
m.put('prop:car_wreck', 36, 28);
m.put('container:crate', 39, 30);
m.put('prop:well', 34, 19);
for (const [x, y] of [
  [12, 31],
  [15, 33],
  [18, 31],
  [20, 35],
  [13, 37],
  [17, 39],
  [21, 41],
  [11, 41],
] as const) {
  m.put('resource:tall_grass', x, y);
}

// Zombies pela quinta (longe da entrada).
for (const [group, x, y] of [
  ['walkers', 30, 17],
  ['walkers', 46, 22],
  ['walkers', 16, 36],
  ['walkers', 56, 36],
  ['walker', 36, 10],
  ['walker', 58, 12],
] as const) {
  m.point(`enemy_spawn:${group}`, x, y);
}

const entry = { x0: 0, y0: 16, x1: 12, y1: 32 };
m.scatter('resource:tree_large', 8, 2, 3, entry);
m.scatter('resource:tree_small', 26, 1, 2, entry);
m.scatter('resource:bush_berries', 12, 1);
m.scatter('resource:tall_grass', 16, 0);
m.scatter('resource:rock', 6, 1);
m.scatter('prop:stump', 5, 1);
m.scatter('prop:crate', 3, 1);
m.scatter('prop:pebbles', 10, 0);
m.flowers(0.06);
m.write('farm.json');

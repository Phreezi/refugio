// Gera os mapas das zonas T2 (CLAUDE.md §8.2, Fase 8): Estrada e Bomba de Gasolina, Aldeia
// Deserta e Floresta Profunda. Uso: `npm run map:t2` (não substitui mapas existentes sem
// `-- --force`: depois de gerados, editam-se no Tiled).

import { MapBuilder } from './mapgen.ts';

type Spawn = readonly [group: string, tx: number, ty: number];

function spawns(m: MapBuilder, list: readonly Spawn[]): void {
  for (const [group, x, y] of list) m.point(`enemy_spawn:${group}`, x, y);
}

/** Estrada com carros abandonados e a bomba de gasolina (80×40). */
function road(): void {
  const m = new MapBuilder(80, 40, 20260928);
  const ROW = 19;
  m.border('fence', [
    [0, ROW],
    [0, ROW + 1],
    [79, ROW],
    [79, ROW + 1],
  ]);
  m.fill(0, ROW - 1, 79, ROW + 2, 'road');
  m.house(30, 6, 41, 14, 'floor_concrete', 35);
  m.path(35, 15, 35, ROW - 2);
  m.fill(28, 15, 43, 16, 'floor_concrete'); // pátio das bombas
  m.point('player_spawn', 3, ROW);
  m.point('exit', 0, ROW);
  m.point('exit', 79, ROW);
  m.put('container:cabinet', 32, 7);
  m.put('container:village_cabinet', 39, 7);
  m.put('container:crate', 32, 12);
  m.put('container:barrel', 40, 12);
  m.put('prop:barrel', 30, 16);
  m.put('prop:barrel', 42, 16);
  for (const x of [16, 27, 48, 60, 71]) m.put('container:car_trunk', x, ROW + (x % 2 === 0 ? 0 : 2));
  m.put('prop:car_wreck', 55, 26);
  m.put('prop:car_wreck', 22, 12);
  spawns(m, [
    ['t2_mixed', 24, 26],
    ['t2_mixed', 50, 12],
    ['t2_mixed', 66, 28],
    ['runners', 36, 24],
    ['runners', 70, 10],
    ['bloated', 45, 20],
    ['bloated', 62, 20],
    ['walkers', 14, 30],
    ['walkers', 58, 34],
  ]);
  const entry = { x0: 0, y0: 12, x1: 12, y1: 28 };
  m.scatter('resource:tree_small', 30, 1, 2, entry);
  m.scatter('resource:tree_large', 6, 2, 3, entry);
  m.scatter('resource:rock', 8, 1);
  m.scatter('resource:tall_grass', 20, 0);
  m.scatter('prop:crate', 6, 1);
  m.scatter('prop:fence_broken', 5, 1);
  m.scatter('prop:pebbles', 12, 0);
  m.flowers(0.04);
  m.write('road.json');
}

/** Aldeia com ruas em cruz, casas com armários, poços e muitos zombies (80×80). */
function village(): void {
  const m = new MapBuilder(80, 80, 20260929);
  m.border('fence', [
    [0, 39],
    [0, 40],
    [39, 79],
    [40, 79],
  ]);
  m.path(0, 39, 79, 39);
  m.path(39, 0, 39, 79);
  const houses: [number, number, number, number, 'floor_wood' | 'floor_concrete'][] = [
    [12, 20, 20, 27, 'floor_wood'],
    [26, 18, 34, 26, 'floor_concrete'],
    [45, 20, 54, 28, 'floor_wood'],
    [60, 22, 68, 30, 'floor_concrete'],
    [12, 46, 21, 54, 'floor_concrete'],
    [26, 50, 34, 58, 'floor_wood'],
    [46, 48, 55, 56, 'floor_concrete'],
    [60, 50, 69, 58, 'floor_wood'],
  ];
  for (const [x0, y0, x1, y1, floor] of houses) {
    const door = Math.floor((x0 + x1) / 2);
    m.house(x0, y0, x1, y1, floor, door);
    m.put('container:village_cabinet', x0 + 2, y0 + 1);
    m.put('container:crate', x1 - 2, y1 - 2);
  }
  m.put('prop:well', 44, 36);
  m.put('prop:well', 34, 44);
  m.point('player_spawn', 3, 39);
  m.point('exit', 0, 39);
  m.point('exit', 39, 79);
  spawns(m, [
    ['walkers', 24, 32],
    ['walkers', 56, 34],
    ['walkers', 24, 44],
    ['walkers', 58, 44],
    ['runners', 40, 18],
    ['runners', 40, 62],
    ['t2_mixed', 16, 60],
    ['t2_mixed', 64, 64],
    ['t2_mixed', 66, 14],
    ['bloated', 50, 40],
    ['wolves', 72, 72],
  ]);
  const entry = { x0: 0, y0: 30, x1: 12, y1: 48 };
  m.scatter('resource:tree_small', 40, 1, 2, entry);
  m.scatter('resource:tree_large', 12, 2, 3, entry);
  m.scatter('resource:bush_berries', 10, 1);
  m.scatter('resource:tall_grass', 20, 0);
  m.scatter('prop:fence_broken', 8, 1);
  m.scatter('prop:crate', 4, 1);
  m.scatter('prop:stump', 6, 1);
  m.flowers(0.05);
  m.write('village.json');
}

/** Floresta densa com filões de ferro, javalis e lobos (96×96). */
function deepForest(): void {
  const m = new MapBuilder(96, 96, 20260930);
  m.border('boulder', [
    [0, 30],
    [0, 31],
    [0, 66],
    [0, 67],
  ]);
  m.path(0, 30, 6, 48);
  m.path(0, 66, 6, 48);
  m.path(6, 48, 46, 48);
  m.path(46, 48, 70, 30);
  m.path(46, 48, 72, 72);
  m.point('player_spawn', 3, 48);
  m.point('exit', 0, 30);
  m.point('exit', 0, 66);
  for (const [x, y] of [
    [48, 46],
    [70, 28],
    [72, 70],
    [30, 20],
  ] as const) {
    m.put('container:crate', x, y);
  }
  spawns(m, [
    ['boars', 30, 30],
    ['boars', 60, 60],
    ['boars', 80, 40],
    ['boars', 40, 80],
    ['boars', 76, 84],
    ['wolves', 64, 20],
    ['wolves', 84, 70],
    ['wolves', 24, 70],
    ['runners', 50, 36],
    ['t2_mixed', 56, 76],
  ]);
  const entry = { x0: 0, y0: 38, x1: 14, y1: 58 };
  m.scatter('resource:iron_vein', 14, 1, 1, entry);
  m.scatter('resource:tree_large', 60, 2, 3, entry);
  m.scatter('resource:tree_small', 110, 1, 2, entry);
  m.scatter('resource:rock', 20, 1);
  m.scatter('resource:bush_berries', 16, 1);
  m.scatter('resource:tall_grass', 30, 0);
  m.scatter('prop:log', 10, 2);
  m.scatter('prop:stump', 14, 1);
  m.scatter('prop:pebbles', 20, 0);
  m.flowers(0.03);
  m.write('deep_forest.json');
}

road();
village();
deepForest();

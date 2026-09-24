// Gera os mapas das zonas-evento (CLAUDE.md §8.3, Fase 10): queda de avião, comboio parado e
// acampamento com comerciante. Uso: `npm run map:events` (não substitui mapas existentes sem
// `-- --force`: depois de gerados, editam-se no Tiled).

import { MapBuilder } from './mapgen.ts';

/** Clareira com o avião partido e 3 caixas de carga (48×40). */
function planeCrash(): void {
  const m = new MapBuilder(48, 40, 20261031);
  m.border('boulder', [
    [0, 19],
    [0, 20],
    [23, 39],
    [24, 39],
  ]);
  m.fill(14, 12, 40, 28, 'dirt');
  m.path(0, 19, 14, 20);
  m.path(23, 39, 23, 28);
  m.put('prop:plane_wreck', 27, 17);
  for (const [x, y] of [
    [18, 22],
    [30, 25],
    [37, 14],
  ] as const) {
    m.put('container:cargo_crate', x, y);
  }
  m.point('player_spawn', 3, 19);
  m.point('exit', 0, 19);
  m.point('exit', 23, 39);
  for (const [g, x, y] of [
    ['t3_mixed', 26, 22],
    ['runners', 36, 26],
    ['walkers', 20, 14],
  ] as const) {
    m.point(`enemy_spawn:${g}`, x, y);
  }
  const entry = { x0: 0, y0: 12, x1: 12, y1: 28 };
  m.scatter('resource:tree_small', 30, 1, 2, entry);
  m.scatter('resource:tree_large', 8, 2, 3, entry);
  m.scatter('prop:pebbles', 10, 0);
  m.flowers(0.03);
  m.write('plane_crash.json');
}

/** Linha de comboio com a locomotiva e vagões de comida, armas e materiais (64×32). */
function train(): void {
  const m = new MapBuilder(64, 32, 20261032);
  m.border('fence', [
    [0, 22],
    [0, 23],
    [63, 22],
    [63, 23],
  ]);
  m.fill(1, 14, 62, 15, 'road'); // a via
  m.path(0, 22, 63, 22);
  m.put('prop:locomotive', 8, 13);
  for (const [table, x] of [
    ['wagon_food', 22],
    ['wagon_weapons', 34],
    ['wagon_materials', 46],
    ['wagon_food', 57],
  ] as const) {
    m.put(`container:${table}`, x, 13);
  }
  m.point('player_spawn', 3, 22);
  m.point('exit', 0, 22);
  m.point('exit', 63, 22);
  for (const [g, x, y] of [
    ['t3_mixed', 28, 18],
    ['t3_mixed', 50, 18],
    ['runners', 40, 8],
    ['bloated', 20, 26],
  ] as const) {
    m.point(`enemy_spawn:${g}`, x, y);
  }
  m.scatter('resource:tree_small', 24, 1, 2, { x0: 0, y0: 16, x1: 8, y1: 28 });
  m.scatter('resource:tall_grass', 16, 0);
  m.scatter('prop:crate', 5, 1);
  m.flowers(0.04);
  m.write('train.json');
}

/** Acampamento de sobreviventes (seguro): tendas, um poço e o comerciante (40×40). */
function camp(): void {
  const m = new MapBuilder(40, 40, 20261033);
  m.border('fence', [
    [0, 19],
    [0, 20],
    [19, 39],
    [20, 39],
  ]);
  m.path(0, 19, 20, 20);
  m.path(19, 39, 20, 20);
  m.fill(14, 14, 26, 26, 'dirt');
  m.put('station:trader', 20, 17);
  m.put('prop:well', 24, 23);
  for (const [x, y] of [
    [9, 9],
    [30, 9],
    [9, 31],
    [30, 31],
  ] as const) {
    m.put('prop:tent', x, y);
  }
  m.put('container:crate', 16, 24);
  m.put('container:barrel', 24, 16);
  m.point('player_spawn', 3, 19);
  m.point('exit', 0, 19);
  m.point('exit', 19, 39);
  m.scatter('resource:tree_small', 20, 1, 2, { x0: 12, y0: 12, x1: 28, y1: 28 });
  m.scatter('resource:bush_berries', 6, 1);
  m.flowers(0.05);
  m.write('camp.json');
}

planeCrash();
train();
camp();

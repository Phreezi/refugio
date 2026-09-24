// Gera os mapas das zonas T3 (CLAUDE.md §8.2, Fase 10): Zona Industrial e Hospital de Campanha.
// Uso: `npm run map:t3` (não substitui mapas existentes sem `-- --force`: depois de gerados,
// editam-se no Tiled).

import { MapBuilder } from './mapgen.ts';

type Spawn = readonly [group: string, tx: number, ty: number];

function spawns(m: MapBuilder, list: readonly Spawn[]): void {
  for (const [group, x, y] of list) m.point(`enemy_spawn:${group}`, x, y);
}

/** Paredes interiores (colisão) de (x0,y0) a (x1,y1), com uma porta de 2 tiles em `door`. */
function innerWall(m: MapBuilder, x0: number, y0: number, x1: number, y1: number, door: number): void {
  m.fill(x0, y0, x1, y1, 'wall', 'collision');
  const vertical = x0 === x1;
  for (const d of [door, door + 1]) {
    const i = vertical ? m.at(x0, d) : m.at(d, y0);
    m.collision[i] = null;
  }
}

/** Armazéns, pátio de betão e sucata; brutamontes e gritadores (96×64). */
function industrial(): void {
  const m = new MapBuilder(96, 64, 20261001);
  m.border('fence', [
    [0, 31],
    [0, 32],
    [47, 63],
    [48, 63],
  ]);
  m.fill(14, 6, 90, 58, 'floor_concrete');
  m.path(0, 31, 14, 32);
  m.path(47, 63, 47, 58);
  m.fill(14, 31, 90, 32, 'road');
  m.fill(47, 6, 48, 58, 'road');
  const warehouses: [number, number, number, number][] = [
    [18, 8, 34, 20],
    [56, 8, 76, 20],
    [18, 40, 36, 54],
    [58, 40, 80, 54],
  ];
  for (const [x0, y0, x1, y1] of warehouses) {
    m.house(x0, y0, x1, y1, 'floor_concrete', Math.floor((x0 + x1) / 2));
    m.put('container:industrial_locker', x0 + 2, y0 + 1);
    m.put('container:industrial_locker', x1 - 2, y0 + 1);
    m.put('container:crate', x0 + 3, y1 - 2);
    m.put('container:barrel', x1 - 3, y1 - 2);
  }
  m.point('player_spawn', 3, 31);
  m.point('exit', 0, 31);
  m.point('exit', 47, 63);
  // O cofre do escritório guarda a chave do bunker (Fase 10).
  m.put('container:safe', 66, 10);
  for (const [x, y] of [
    [40, 26],
    [52, 26],
    [84, 36],
    [40, 36],
  ] as const) {
    m.put('container:car_trunk', x, y);
  }
  for (const [x, y] of [
    [44, 12],
    [86, 12],
    [86, 48],
    [52, 46],
  ] as const) {
    m.put('prop:car_wreck', x, y);
  }
  spawns(m, [
    ['t3_mixed', 26, 26],
    ['t3_mixed', 66, 26],
    ['t3_mixed', 30, 46],
    ['t3_mixed', 70, 46],
    ['tanks', 26, 14],
    ['tanks', 68, 48],
    ['screamer', 60, 32],
    ['screamer', 84, 20],
    ['bloated', 44, 44],
    ['runners', 80, 30],
  ]);
  const entry = { x0: 0, y0: 22, x1: 14, y1: 42 };
  m.scatter('prop:barrel', 14, 1, 1, entry);
  m.scatter('prop:crate', 12, 1, 1, entry);
  m.scatter('resource:rock', 6, 1, 1, entry);
  m.scatter('prop:pebbles', 16, 0);
  m.write('industrial.json');
}

/** Hospital de campanha: um edifício com enfermarias e armários de medicamentos (64×64). */
function hospital(): void {
  const m = new MapBuilder(64, 64, 20261002);
  m.border('fence', [
    [31, 0],
    [32, 0],
    [0, 40],
    [0, 41],
  ]);
  m.path(31, 0, 31, 9);
  m.path(0, 40, 31, 44);
  m.house(12, 10, 52, 36, 'floor_concrete', 31);
  // Enfermarias: um corredor ao meio (y 22–24) e quartos dos dois lados.
  innerWall(m, 13, 21, 51, 21, 31);
  innerWall(m, 13, 25, 51, 25, 31);
  for (const x of [22, 32, 42]) {
    innerWall(m, x, 11, x, 20, 15);
    innerWall(m, x, 26, x, 35, 29);
  }
  // Uma abertura a norte para a outra saída.
  for (const x of [31, 32]) m.collision[m.at(x, 10)] = null;
  for (const [x0, x1] of [
    [13, 21],
    [23, 31],
    [33, 41],
    [43, 51],
  ] as const) {
    m.put('container:medical_cabinet', x0 + 2, 12);
    m.put('container:medical_cabinet', x1 - 2, 34);
    m.put('container:crate', x1 - 2, 13);
  }
  m.point('player_spawn', 3, 40);
  m.point('exit', 0, 40);
  m.point('exit', 31, 0);
  spawns(m, [
    ['walkers', 17, 16],
    ['walkers', 37, 16],
    ['walkers', 27, 30],
    ['walkers', 47, 30],
    ['t3_mixed', 26, 23],
    ['t3_mixed', 46, 23],
    ['screamer', 30, 16],
    ['runners', 40, 44],
    ['t3_mixed', 20, 50],
    ['tanks', 50, 50],
  ]);
  const entry = { x0: 0, y0: 32, x1: 12, y1: 50 };
  m.scatter('resource:tree_small', 30, 1, 2, entry);
  m.scatter('resource:tall_grass', 16, 0, 1, entry);
  m.scatter('prop:crate', 6, 1);
  m.scatter('prop:barrel', 4, 1);
  m.flowers(0.03);
  m.write('hospital.json');
}

industrial();
hospital();

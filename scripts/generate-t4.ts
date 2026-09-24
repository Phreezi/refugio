// Gera os mapas das zonas T4 (CLAUDE.md §8.2, Fase 10): Base Militar e Cidade em Ruínas.
// Uso: `npm run map:t4` (não substitui mapas existentes sem `-- --force`: depois de gerados,
// editam-se no Tiled).

import { MapBuilder } from './mapgen.ts';

type Spawn = readonly [group: string, tx: number, ty: number];

function spawns(m: MapBuilder, list: readonly Spawn[]): void {
  for (const [group, x, y] of list) m.point(`enemy_spawn:${group}`, x, y);
}

/** Base Militar: recinto vedado com casernas, arsenal e veículos (96×96). */
function military(): void {
  const m = new MapBuilder(96, 96, 20261021);
  m.border('fence', [
    [0, 47],
    [0, 48],
    [47, 95],
    [48, 95],
  ]);
  m.fill(14, 10, 86, 86, 'floor_concrete');
  m.path(0, 47, 14, 48);
  m.path(47, 95, 47, 86);
  m.fill(14, 47, 86, 48, 'road');
  m.fill(47, 10, 48, 86, 'road');
  const barracks: [number, number, number, number][] = [
    [18, 14, 34, 24],
    [60, 14, 80, 24],
    [18, 62, 34, 74],
  ];
  for (const [x0, y0, x1, y1] of barracks) {
    m.house(x0, y0, x1, y1, 'floor_wood', Math.floor((x0 + x1) / 2));
    m.put('container:armory', x0 + 3, y0 + 1);
    m.put('container:city_store', x1 - 2, y0 + 1);
    m.put('container:crate', x0 + 2, y1 - 2);
  }
  // Arsenal: o melhor loot, bem guardado.
  m.house(58, 60, 82, 80, 'floor_concrete', 69);
  for (const x of [61, 66, 71, 76]) m.put('container:armory', x, 62);
  m.put('container:bunker_crate', 62, 76);
  m.put('container:bunker_crate', 77, 76);
  for (const [x, y] of [
    [40, 30],
    [55, 36],
    [40, 58],
    [55, 60],
    [26, 44],
    [72, 44],
  ] as const) {
    m.put('prop:car_wreck', x, y);
  }
  m.point('player_spawn', 3, 47);
  m.point('exit', 0, 47);
  m.point('exit', 47, 95);
  spawns(m, [
    ['squad', 26, 30],
    ['squad', 70, 30],
    ['squad', 70, 54],
    ['squad', 26, 56],
    ['t4_mixed', 40, 40],
    ['t4_mixed', 56, 40],
    ['t4_mixed', 40, 80],
    ['tanks', 70, 70],
    ['tanks', 64, 74],
    ['screamers', 48, 30],
    ['screamers', 80, 50],
    ['bloated', 30, 80],
  ]);
  const entry = { x0: 0, y0: 38, x1: 14, y1: 58 };
  m.scatter('prop:crate', 16, 1, 1, entry);
  m.scatter('prop:barrel', 12, 1, 1, entry);
  m.scatter('prop:pebbles', 20, 0);
  m.write('military.json');
}

/** Cidade em Ruínas: ruas em grelha, prédios com lojas e muitos zombies (128×96). */
function city(): void {
  const m = new MapBuilder(128, 96, 20261022);
  m.border('wall', [
    [0, 47],
    [0, 48],
    [63, 95],
    [64, 95],
  ]);
  m.ground.fill('floor_concrete'); // sem reservar (os obstáculos espalham-se por cima)
  // Ruas (estrada) em grelha.
  for (const y of [22, 47, 72]) m.fill(1, y, 126, y + 1, 'road');
  for (const x of [30, 63, 96]) m.fill(x, 1, x + 1, 94, 'road');
  // Um prédio em cada quarteirão.
  const blocksX = [
    [4, 26],
    [35, 59],
    [68, 92],
    [101, 123],
  ] as const;
  const blocksY = [
    [4, 18],
    [26, 43],
    [51, 68],
    [76, 91],
  ] as const;
  let k = 0;
  for (const [x0, x1] of blocksX) {
    for (const [y0, y1] of blocksY) {
      k++;
      const ix0 = x0 + 2;
      const ix1 = x1 - 2;
      const iy0 = y0 + 1;
      const iy1 = y1 - 2;
      m.house(ix0, iy0, ix1, iy1, k % 3 === 0 ? 'floor_wood' : 'floor_concrete', Math.floor((ix0 + ix1) / 2));
      m.put('container:city_store', ix0 + 2, iy0 + 1);
      if (k % 2 === 0) m.put('container:village_cabinet', ix1 - 2, iy0 + 1);
      if (k % 4 === 1) m.put('container:medical_cabinet', ix1 - 2, iy1 - 1);
      if (k % 5 === 2) m.put('container:armory', ix0 + 3, iy1 - 1);
    }
  }
  for (const [x, y] of [
    [12, 22],
    [45, 47],
    [80, 72],
    [110, 22],
    [96, 60],
    [30, 84],
  ] as const) {
    m.put('container:car_trunk', x, y);
  }
  m.point('player_spawn', 3, 47);
  m.point('exit', 0, 47);
  m.point('exit', 63, 95);
  const groups = ['t4_mixed', 'squad', 't4_mixed', 'screamers', 't4_mixed', 'tanks', 'bloated'] as const;
  let g = 0;
  for (const y of [22, 47, 72]) {
    for (const x of [16, 46, 80, 112]) {
      if (x === 16 && y === 47) continue; // a entrada fica livre
      m.point(`enemy_spawn:${groups[g % groups.length] ?? 't4_mixed'}`, x, y);
      g++;
    }
  }
  const entry = { x0: 0, y0: 40, x1: 12, y1: 56 };
  m.scatter('prop:car_wreck', 10, 2, 1, entry);
  m.scatter('prop:crate', 20, 1, 1, entry);
  m.scatter('prop:barrel', 16, 1, 1, entry);
  m.write('city.json');
}

military();
city();

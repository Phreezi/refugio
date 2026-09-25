// Gera os Caminhos do mundo contínuo (Etapa E, CLAUDE.md §8.5): mapas estreitos (20 tiles de
// largura) que sobem para norte ao lado das zonas, estilo Pokémon. Barreiras de lado a lado com
// uma só passagem, alternada à esquerda e à direita, obrigam a ir por sítios certos. Cada caminho
// liga-se ao de baixo e ao de cima (colunas 9–10) e à zona a leste (as aberturas dela); o
// primeiro também à base (a oeste). Uso: `npm run map:routes` (não substitui sem `-- --force`).

import { MapBuilder } from './mapgen.ts';
import type { BaseTile } from '../src/world/tileset.ts';

export const ROUTE_WIDTH = 20;
/** Colunas da passagem entre um caminho e o seguinte (norte/sul). */
const SPINE: readonly [number, number] = [9, 10];

interface RouteSpec {
  n: number;
  /** Altura (a da zona ao lado). */
  h: number;
  /** Linhas abertas na borda leste (as aberturas da zona). */
  east: readonly number[];
  /** Linhas abertas na borda oeste (só o 1.º: a saída da base). */
  west?: readonly number[];
  south: boolean;
  north: boolean;
  barrier: BaseTile;
  enemies: readonly string[];
  trees: number;
}

export const ROUTES: readonly RouteSpec[] = [
  {
    n: 1,
    h: 64,
    east: [20, 21, 44, 45],
    west: [42, 43],
    south: false,
    north: true,
    barrier: 'fence',
    enemies: ['walker', 'deer'],
    trees: 18,
  },
  {
    n: 2,
    h: 48,
    east: [14, 15, 34, 35],
    south: true,
    north: true,
    barrier: 'fence',
    enemies: ['walkers'],
    trees: 14,
  },
  {
    n: 3,
    h: 64,
    east: [20, 21, 44, 45],
    south: true,
    north: true,
    barrier: 'fence',
    enemies: ['walkers', 'wolf_night'],
    trees: 16,
  },
  {
    n: 4,
    h: 40,
    east: [19, 20],
    south: true,
    north: true,
    barrier: 'boulder',
    enemies: ['t2_mixed'],
    trees: 10,
  },
  {
    n: 5,
    h: 80,
    east: [39, 40],
    south: true,
    north: true,
    barrier: 'boulder',
    enemies: ['t2_mixed', 'wolf'],
    trees: 20,
  },
  {
    n: 6,
    h: 96,
    east: [30, 31, 66, 67],
    south: true,
    north: true,
    barrier: 'boulder',
    enemies: ['wolves', 'boars'],
    trees: 26,
  },
  {
    n: 7,
    h: 64,
    east: [31, 32],
    south: true,
    north: true,
    barrier: 'wall',
    enemies: ['t3_mixed', 'bloated'],
    trees: 10,
  },
  {
    n: 8,
    h: 64,
    east: [40, 41],
    south: true,
    north: true,
    barrier: 'wall',
    enemies: ['t3_mixed', 'screamer'],
    trees: 10,
  },
  {
    n: 9,
    h: 96,
    east: [47, 48],
    south: true,
    north: true,
    barrier: 'wall',
    enemies: ['t4_mixed', 'tanks'],
    trees: 14,
  },
  {
    n: 10,
    h: 96,
    east: [47, 48],
    south: true,
    north: false,
    barrier: 'wall',
    enemies: ['t4_mixed', 'squad'],
    trees: 14,
  },
];

function route(spec: RouteSpec): void {
  const w = ROUTE_WIDTH;
  const { h } = spec;
  const m = new MapBuilder(w, h, 20270100 + spec.n);
  const gaps: [number, number][] = [
    ...spec.east.map((y): [number, number] => [w - 1, y]),
    ...(spec.west ?? []).map((y): [number, number] => [0, y]),
    ...(spec.south ? SPINE.map((x): [number, number] => [x, h - 1]) : []),
    ...(spec.north ? SPINE.map((x): [number, number] => [x, 0]) : []),
  ];
  m.border(spec.barrier, gaps);

  // Linhas abertas nas bordas: as barreiras não passam lá (nem ao lado).
  const edgeRows = new Set<number>();
  for (const y of [...spec.east, ...(spec.west ?? [])]) for (let d = -2; d <= 2; d++) edgeRows.add(y + d);
  // Barreiras a cada ~9 linhas, de baixo para cima, com a passagem alternada.
  const barriers: { y: number; gapX: number }[] = [];
  let left = true;
  for (let y = h - 8; y >= 6; y -= 9) {
    let row = y;
    while (edgeRows.has(row) && row > 4) row--;
    if (row <= 4 || edgeRows.has(row)) continue;
    const gapX = left ? 2 : w - 5;
    for (let x = 1; x < w - 1; x++) {
      if (x >= gapX && x < gapX + 3) continue;
      m.collision[m.at(x, row)] = spec.barrier;
      m.reserved.add(m.at(x, row));
    }
    barriers.push({ y: row, gapX });
    left = !left;
  }

  // Caminho de terra em ziguezague: entrada de baixo → passagens → saída de cima.
  const points: [number, number][] = [];
  points.push(spec.south ? [SPINE[0], h - 1] : [SPINE[0], h - 3]);
  for (const b of barriers) {
    points.push([b.gapX + 1, b.y + 1]);
    points.push([b.gapX + 1, b.y - 1]);
  }
  points.push(spec.north ? [SPINE[0], 0] : [SPINE[0], 2]);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) m.path(a[0], a[1], b[0], b[1]);
  }
  // Ramais até às aberturas laterais.
  for (const y of spec.east.filter((_, i) => i % 2 === 0)) m.path(w - 1, y, SPINE[0], y);
  for (const y of (spec.west ?? []).filter((_, i) => i % 2 === 0)) m.path(0, y, SPINE[0], y);

  m.point('player_spawn', SPINE[0], Math.floor(h / 2));
  for (const [x, y] of gaps.filter((_, i) => i % 2 === 0)) m.point('exit', x, y);
  // Inimigos entre as barreiras (um grupo por faixa, alternando).
  barriers.forEach((b, i) => {
    const group = spec.enemies[i % spec.enemies.length];
    if (group && i % 2 === 1) m.point(`enemy_spawn:${group}`, left ? 14 : 5, b.y + 4);
  });
  m.scatter('resource:tree_small', spec.trees, 1, 2);
  m.scatter('resource:tall_grass', Math.round(h / 4), 0);
  m.scatter('resource:bush_berries', Math.max(2, Math.round(h / 24)), 1);
  m.scatter('resource:rock', Math.max(2, Math.round(h / 20)), 1);
  m.scatter('prop:pebbles', Math.round(h / 10), 0);
  if (spec.barrier !== 'fence') m.scatter('prop:crate', Math.round(h / 32), 1);
  m.flowers(spec.barrier === 'fence' ? 0.05 : 0.02);
  m.write(`route_${String(spec.n)}.json`);
}

for (const spec of ROUTES) route(spec);

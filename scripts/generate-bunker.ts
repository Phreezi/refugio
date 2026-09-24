// Gera os 4 pisos do bunker (CLAUDE.md §8.2, Fase 10). Cada piso tem as escadas para cima a
// oeste e para baixo a leste (saídas `exit:<zona do piso>`); no piso 1 as de cima levam ao
// mapa-mundo e no piso 4, depois do chefe, um elevador também. Uso: `npm run map:bunker`
// (não substitui mapas existentes sem `-- --force`: depois de gerados, editam-se no Tiled).

import { MapBuilder } from './mapgen.ts';

const W = 40;
const H = 40;
const MID = 20;

/** Id da zona do piso `n` (o piso 1 é a entrada, `zone_bunker`). */
const zoneOf = (n: number): string => (n === 1 ? 'zone_bunker' : `zone_bunker_${String(n)}`);

type Spawn = readonly [group: string, tx: number, ty: number];

/** Parede interior com uma porta de 2 tiles em `door`. */
function innerWall(m: MapBuilder, x0: number, y0: number, x1: number, y1: number, door: number): void {
  m.fill(x0, y0, x1, y1, 'wall', 'collision');
  const vertical = x0 === x1;
  for (const d of [door, door + 1]) m.collision[vertical ? m.at(x0, d) : m.at(d, y0)] = null;
}

function floor(n: number, spawns: readonly Spawn[], seed: number): void {
  const m = new MapBuilder(W, H, seed);
  m.ground.fill('floor_dark'); // sem reservar os tiles (os obstáculos espalham-se por cima)
  m.border('wall', []);
  // Três secções com corredores; as portas mudam de sítio de piso para piso.
  const odd = n % 2 === 1;
  innerWall(m, 13, 1, 13, H - 2, odd ? 8 + (n % 3) * 4 : 26 - (n % 3) * 4);
  innerWall(m, 26, 1, 26, H - 2, odd ? 30 - (n % 3) * 5 : 10 + (n % 3) * 4);
  innerWall(m, 1, 12, 12, 12, 5);
  innerWall(m, 27, 28, W - 2, 28, 32);
  const hall = 8 + n * 5;
  innerWall(m, 14, hall, 25, hall, 18);
  // Escadas: para cima a oeste, para baixo (ou o elevador no fim) a leste.
  const up = n === 1 ? 'exit' : `exit:${zoneOf(n - 1)}`;
  const down = n === 4 ? 'exit' : `exit:${zoneOf(n + 1)}`;
  m.fill(1, MID, 1, MID, 'stairs_up');
  m.fill(W - 2, MID, W - 2, MID, n === 4 ? 'stairs_up' : 'stairs_down');
  m.point(up, 1, MID);
  m.point(down, W - 2, MID);
  m.point('player_spawn', 3, MID);
  // Caixas militares e armários nas secções.
  for (const [x, y] of [
    [4, 3],
    [9, 36],
    [17, 3],
    [22, 36],
    [30, 3],
    [35, 36],
  ] as const) {
    m.put(y < MID ? 'container:bunker_crate' : 'container:industrial_locker', x, y);
  }
  m.put('container:medical_cabinet', 22, 3);
  for (const [group, x, y] of spawns) m.point(`enemy_spawn:${group}`, x, y);
  m.scatter('prop:crate', 6, 1);
  m.scatter('prop:barrel', 5, 1);
  m.write(`bunker_${String(n)}.json`);
}

floor(
  1,
  [
    ['t3_mixed', 18, 10],
    ['t3_mixed', 20, 30],
    ['walkers', 32, 12],
    ['walkers', 34, 34],
  ],
  20261011,
);
floor(
  2,
  [
    ['runners', 18, 12],
    ['screamer', 20, 30],
    ['t3_mixed', 32, 10],
    ['t3_mixed', 34, 34],
    ['runners', 7, 30],
  ],
  20261012,
);
floor(
  3,
  [
    ['tanks', 19, 20],
    ['bloated', 32, 12],
    ['t3_mixed', 32, 34],
    ['screamer', 8, 30],
    ['tanks', 33, 22],
  ],
  20261013,
);
floor(
  4,
  [
    ['t3_mixed', 18, 12],
    ['tanks', 19, 30],
    ['warden', 33, 20],
  ],
  20261014,
);

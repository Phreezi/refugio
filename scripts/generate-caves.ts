// Cavernas (pedido do jogador: "cria cavernas, aqui sim abre um mapa diferente, com entradas").
// Cada caverna é uma zona própria, escura e escondida do mapa-mundo, com túneis e salas escavados
// na rocha (minério, pedras, contentores e inimigos do nível da zona de onde se entra). A entrada
// é uma boca de caverna numa zona do mundo contínuo: pisá-la leva lá dentro (`exit:<caverna>`),
// e a saída da caverna leva de volta à boca.
// Uso: `npm run map:caves` (não substitui cavernas existentes sem `-- --force`; a entrada só se
// acrescenta uma vez a cada zona).

import { readFileSync, writeFileSync } from 'node:fs';
import { BASE_TILES, baseTileIndex } from '../src/world/tileset.ts';
import { MapBuilder } from './mapgen.ts';

interface Cave {
  zone: string;
  parent: string;
  seed: number;
  groups: readonly string[];
  containers: readonly string[];
  ores: number;
}

export const CAVES: readonly Cave[] = [
  {
    zone: 'zone_cave_pine',
    parent: 'zone_pine_forest',
    seed: 71001,
    groups: ['walkers', 'wolf', 'walkers'],
    containers: ['crate', 'barrel'],
    ores: 3,
  },
  {
    zone: 'zone_cave_lake',
    parent: 'zone_lake',
    seed: 71002,
    groups: ['walkers', 'wolves', 't2_mixed'],
    containers: ['fishing_box', 'crate'],
    ores: 4,
  },
  {
    zone: 'zone_cave_deep',
    parent: 'zone_deep_forest',
    seed: 71003,
    groups: ['boars', 'wolves', 't2_mixed', 'bears'],
    containers: ['cabinet', 'crate', 'village_cabinet'],
    ores: 7,
  },
  {
    zone: 'zone_cave_industrial',
    parent: 'zone_industrial',
    seed: 71004,
    groups: ['t3_mixed', 'tanks', 'spitters', 'armored'],
    containers: ['industrial_locker', 'safe', 'crate'],
    ores: 8,
  },
];

const W = 48;
const H = 36;
const MOUTH = { x: 24, y: H - 2 };

function carveCave(cave: Cave): void {
  const m = new MapBuilder(W, H, cave.seed);
  m.ground.fill('floor_dark');
  m.collision.fill('cliff');
  const open = (x: number, y: number): void => {
    if (x < 1 || y < 1 || x > W - 2 || y > H - 2) return;
    m.collision[m.at(x, y)] = null;
  };
  // Túneis: caminhadas aleatórias a partir da entrada, com 2–3 tiles de largura, e salas.
  const rooms: { x: number; y: number }[] = [];
  let x = MOUTH.x;
  let y = MOUTH.y - 1;
  for (let branch = 0; branch < 5; branch++) {
    for (let step = 0; step < 90; step++) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 0; dy++) open(x + dx, y + dy);
      const r = m.random();
      if (r < 0.4) y -= 1;
      else if (r < 0.65) x -= 1;
      else if (r < 0.9) x += 1;
      else y += 1;
      x = Math.max(3, Math.min(W - 4, x));
      y = Math.max(3, Math.min(H - 5, y));
    }
    rooms.push({ x, y });
    const radius = 3 + Math.floor(m.random() * 3);
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius - 1; dx <= radius + 1; dx++)
        if ((dx * dx) / ((radius + 1) * (radius + 1)) + (dy * dy) / (radius * radius) <= 1)
          open(x + dx, y + dy);
    // O ramo seguinte parte de um ponto já escavado.
    x = MOUTH.x + Math.floor((m.random() - 0.5) * 20);
    y = MOUTH.y - 3 - Math.floor(m.random() * 10);
    for (let yy = y; yy <= MOUTH.y - 1; yy++) open(x, yy);
    // …ligado à entrada por um corredor ao fundo.
    for (let xx = Math.min(x, MOUTH.x); xx <= Math.max(x, MOUTH.x); xx++) open(xx, MOUTH.y - 1);
  }
  // O que não se alcança a partir da entrada volta a ser rocha (nada fica fechado).
  const seen = new Set<number>([m.at(MOUTH.x, MOUTH.y - 1)]);
  const queue = [[MOUTH.x, MOUTH.y - 1] as const];
  while (queue.length > 0) {
    const [cx, cy] = queue.shift() ?? [0, 0];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const i = m.at(cx + dx, cy + dy);
      if (!m.inside(cx + dx, cy + dy) || seen.has(i) || m.collision[i] !== null) continue;
      seen.add(i);
      queue.push([cx + dx, cy + dy]);
    }
  }
  for (let i = 0; i < m.collision.length; i++)
    if (m.collision[i] === null && !seen.has(i)) m.collision[i] = 'cliff';
  // Entrada (a saída leva de volta à zona de onde se veio).
  for (let yy = MOUTH.y - 3; yy <= MOUTH.y; yy++)
    for (let xx = MOUTH.x - 1; xx <= MOUTH.x + 1; xx++) open(xx, yy);
  m.collision[m.at(MOUTH.x, MOUTH.y)] = null;
  m.ground[m.at(MOUTH.x, MOUTH.y)] = 'stairs_up';
  m.point(`exit:${cave.parent}`, MOUTH.x, MOUTH.y);
  m.point('player_spawn', MOUTH.x, MOUTH.y - 2);
  for (let yy = MOUTH.y - 4; yy <= MOUTH.y; yy++)
    for (let xx = MOUTH.x - 2; xx <= MOUTH.x + 2; xx++) if (m.inside(xx, yy)) m.reserved.add(m.at(xx, yy));
  // Salas: contentores e inimigos; minério e pedras pelos túneis.
  rooms.forEach((room, i) => {
    const group = cave.groups[i % cave.groups.length];
    if (group) m.point(`enemy_spawn:${group}`, room.x, room.y);
  });
  for (const table of cave.containers) m.scatter(`container:${table}`, 1, 0);
  m.scatter('resource:iron_vein', cave.ores, 0);
  m.scatter('resource:rock', 6, 0);
  m.write(`${cave.zone.replace('zone_', '')}.json`);
}

interface Obj {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  point: boolean;
  visible: boolean;
}
interface TiledMap {
  width: number;
  height: number;
  nextobjectid: number;
  layers: { name: string; type: string; data?: number[]; objects?: Obj[] }[];
}

/** Boca da caverna numa zona do mundo: rocha à volta, chão escuro e a saída para a caverna. */
function addEntrance(cave: Cave, zoneFile: string): void {
  const url = new URL(`../public/assets/maps/${zoneFile}`, import.meta.url);
  const map = JSON.parse(readFileSync(url, 'utf8')) as TiledMap;
  const objects = map.layers.find((l) => l.type === 'objectgroup')?.objects ?? [];
  if (objects.some((o) => o.name === `exit:${cave.zone}`)) return; // já tem entrada
  const layer = (name: string): number[] => map.layers.find((l) => l.name === name)?.data ?? [];
  const ground = layer('ground');
  const collision = layer('collision');
  const decor = layer('decor_high');
  const w = map.width;
  const busy = (tx: number, ty: number): boolean =>
    objects.some((o) => Math.abs(o.x / 16 - (tx + 0.5)) < 3 && Math.abs(o.y / 16 - (ty + 0.5)) < 3);
  // Um sítio com 6×4 tiles livres, a meio do mapa na horizontal e a norte.
  let best: { x: number; y: number } | null = null;
  for (let ty = 4; ty < map.height - 4 && !best; ty++) {
    for (let tx = Math.floor(w * 0.3); tx < w - 5 && !best; tx++) {
      let ok = true;
      for (let dy = -2; dy <= 1 && ok; dy++)
        for (let dx = -2; dx <= 3 && ok; dx++) {
          const i = (ty + dy) * w + tx + dx;
          if (collision[i] !== 0 || (decor[i] ?? 0) !== 0 || busy(tx + dx, ty + dy)) ok = false;
        }
      if (ok) best = { x: tx, y: ty };
    }
  }
  if (!best) throw new Error(`${zoneFile}: sem sítio para a entrada de ${cave.zone}`);
  const gid = (tile: (typeof BASE_TILES)[number]): number => baseTileIndex(tile) + 1;
  const { x, y } = best;
  // Rocha por cima e dos lados de uma boca de 2 tiles (aberta a sul): entra-se sem raspar.
  for (let dx = -1; dx <= 2; dx++) collision[(y - 1) * w + x + dx] = gid('cliff');
  collision[y * w + x - 1] = gid('cliff');
  collision[y * w + x + 2] = gid('cliff');
  ground[y * w + x] = gid('cave_mouth');
  ground[y * w + x + 1] = gid('cave_mouth');
  objects.push({
    id: map.nextobjectid++,
    name: `exit:${cave.zone}`,
    type: '',
    x: (x + 1) * 16,
    y: y * 16 + 8,
    width: 0,
    height: 0,
    rotation: 0,
    point: true,
    visible: true,
  });
  writeFileSync(url, JSON.stringify(map));
  console.log(`${zoneFile}: entrada de ${cave.zone} em (${String(x)}, ${String(y)})`);
}

const zones = JSON.parse(readFileSync(new URL('../src/data/zones.json', import.meta.url), 'utf8')) as Record<
  string,
  { map?: string }
>;
for (const cave of CAVES) {
  carveCave(cave);
  const parentMap = zones[cave.parent]?.map?.replace('maps/', '');
  if (!parentMap) throw new Error(`${cave.parent}: zona sem mapa`);
  addEntrance(cave, parentMap);
}

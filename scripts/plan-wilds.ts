// Mundo selvagem (plano D): faz o plano das zonas geradas à volta das desenhadas à mão
// (src/world/wilds.ts) e grava-o em src/data/wilds.json. Abre também as passagens nas bordas
// das zonas à mão que dão para o mundo selvagem (só onde o interior está perto e se chega lá a
// partir do ponto de partida da zona); as passagens que não se podem abrir saem do plano, e as
// zonas selvagens a que não se chega de casa ficam de fora (montanhas).
// Uso: `npm run map:wilds` (não substitui o plano sem `-- --force`).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE_LEDGE_TILES, baseTileIndex } from '../src/world/tileset.ts';
import { planWilds, type Opening, type Rect, type Side, type WildPlan } from '../src/world/wilds.ts';

const SEED = 20261003;
const MAX_DEPTH = 10;
const OUT = new URL('../src/data/wilds.json', import.meta.url);

if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.error('src/data/wilds.json já existe. Usar --force para refazer o plano.');
  process.exit(1);
}

interface Obj {
  name: string;
  x: number;
  y: number;
}
interface TiledMap {
  width: number;
  height: number;
  layers: { name: string; type: string; data?: number[]; objects?: Obj[] }[];
}

const zones = JSON.parse(readFileSync(new URL('../src/data/zones.json', import.meta.url), 'utf8')) as Record<
  string,
  { map?: string; world?: [number, number] }
>;
const mapUrl = (file: string): URL => new URL(`../public/assets/${file}`, import.meta.url);
const maps = new Map<string, TiledMap>();
const hand: Rect[] = [];
for (const [id, zone] of Object.entries(zones)) {
  if (!zone.world || !zone.map) continue;
  const map = JSON.parse(readFileSync(mapUrl(zone.map), 'utf8')) as TiledMap;
  maps.set(id, map);
  hand.push({ zoneId: id, x: zone.world[0], y: zone.world[1], w: map.width, h: map.height });
}

const LEDGES = new Set(BASE_LEDGE_TILES.map((t) => baseTileIndex(t) + 1));
const DIRT = baseTileIndex('dirt') + 1;

/** Tile (local) do lane `k` à profundidade `d` de uma passagem. */
function laneTile(map: TiledMap, [side, at]: Opening, k: number, d: number): [number, number] {
  if (side === 'n') return [at + k, d];
  if (side === 's') return [at + k, map.height - 1 - d];
  if (side === 'w') return [d, at + k];
  return [map.width - 1 - d, at + k];
}

/** Tenta abrir a passagem no mapa à mão. */
function carve(zoneId: string, open: Opening, dryRun = false): boolean {
  const map = maps.get(zoneId);
  if (!map) return false;
  const layer = (name: string): number[] => map.layers.find((l) => l.name === name)?.data ?? [];
  const collision = layer('collision');
  const ground = layer('ground');
  const decor = layer('decor_high');
  const objects = map.layers.find((l) => l.type === 'objectgroup')?.objects ?? [];
  const w = map.width;
  const width = open[2];
  let depth = 0;
  for (let k = 0; k < width; k++) {
    let d = 0;
    for (;;) {
      if (d > MAX_DEPTH) return false;
      const [x, y] = laneTile(map, open, k, d);
      if (collision[y * w + x] === 0) break;
      d++;
    }
    depth = Math.max(depth, d);
  }
  // Nada de objetos no corte (nem colados a ele).
  const cut: [number, number][] = [];
  for (let k = -1; k <= width; k++) for (let d = 0; d <= depth; d++) cut.push(laneTile(map, open, k, d));
  if (
    objects.some((o) => cut.some(([x, y]) => Math.floor(o.x / 16) === x && Math.floor((o.y - 1) / 16) === y))
  )
    return false;
  // O interior chega-se a partir do ponto de partida?
  const spawn = objects.find((o) => o.name === 'player_spawn');
  if (!spawn) return false;
  const [gx, gy] = laneTile(map, open, Math.floor(width / 2), depth);
  const seen = new Uint8Array(w * map.height);
  const queue: [number, number][] = [[Math.floor(spawn.x / 16), Math.floor(spawn.y / 16)]];
  let found = false;
  while (queue.length > 0 && !found) {
    const [x, y] = queue.pop() ?? [0, 0];
    if (x === gx && y === gy) found = true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= map.height) continue;
      const i = ny * w + nx;
      const tile = collision[i] ?? 0;
      if (seen[i] || (tile !== 0 && !LEDGES.has(tile))) continue;
      seen[i] = 1;
      queue.push([nx, ny]);
    }
  }
  if (!found) return false;
  if (dryRun) return true;
  for (let k = 0; k < width; k++)
    for (let d = 0; d < depth; d++) {
      const [x, y] = laneTile(map, open, k, d);
      collision[y * w + x] = 0;
      if (decor.length > 0) decor[y * w + x] = 0;
      ground[y * w + x] = DIRT;
    }
  return true;
}

const plan: WildPlan = planWilds(hand, SEED, (zoneId, open) => carve(zoneId, open, true));
console.log(
  `plano: ${String(plan.zones.length)} zonas selvagens, ${String(plan.hand.length)} passagens à mão`,
);

/** Chave da borda de uma passagem no mundo (igual dos dois lados). */
function key(r: Rect, [side, at]: Opening): string {
  if (side === 'n') return `h:${String(r.x + at)}:${String(r.y)}`;
  if (side === 's') return `h:${String(r.x + at)}:${String(r.y + r.h)}`;
  if (side === 'w') return `v:${String(r.x)}:${String(r.y + at)}`;
  return `v:${String(r.x + r.w)}:${String(r.y + at)}`;
}

const rectOf = new Map<string, Rect>([
  ...hand.map((r) => [r.zoneId, r] as const),
  ...plan.zones.map((z) => [z.id, { zoneId: z.id, x: z.x, y: z.y, w: z.w, h: z.h }] as const),
]);
const dead = new Set<string>();
const carved = new Set<string>();
const handOk: WildPlan['hand'] = [];
for (const entry of plan.hand) {
  const rect = rectOf.get(entry.zone);
  if (!rect) continue;
  if (carve(entry.zone, entry.open)) {
    handOk.push(entry);
    carved.add(entry.zone);
  } else dead.add(key(rect, entry.open));
}
for (const z of plan.zones) {
  const rect = rectOf.get(z.id);
  if (rect) z.open = z.open.filter((o) => !dead.has(key(rect, o)));
}

// Zonas a que se chega a partir das zonas à mão.
const byKey = new Map<string, string[]>();
for (const z of plan.zones) {
  const rect = rectOf.get(z.id);
  if (!rect) continue;
  for (const o of z.open) byKey.set(key(rect, o), [...(byKey.get(key(rect, o)) ?? []), z.id]);
}
for (const entry of handOk) {
  const rect = rectOf.get(entry.zone);
  if (rect) byKey.set(key(rect, entry.open), [...(byKey.get(key(rect, entry.open)) ?? []), entry.zone]);
}
const reach = new Set(hand.map((r) => r.zoneId));
const queue = [...reach];
const opensOf = (id: string): Opening[] =>
  plan.zones.find((z) => z.id === id)?.open ?? handOk.filter((e) => e.zone === id).map((e) => e.open);
while (queue.length > 0) {
  const id = queue.pop() ?? '';
  const rect = rectOf.get(id);
  if (!rect) continue;
  for (const o of opensOf(id))
    for (const other of byKey.get(key(rect, o)) ?? [])
      if (!reach.has(other)) {
        reach.add(other);
        queue.push(other);
      }
}
const kept = plan.zones.filter((z) => reach.has(z.id));
const keptKeys = new Set<string>();
for (const z of kept) {
  const rect = rectOf.get(z.id);
  if (rect) for (const o of z.open) keptKeys.add(key(rect, o));
}
// Passagens que davam para zonas que saíram: fecham-se (as das zonas à mão já estão abertas,
// e dão para montanhas; ficam como recantos).
const pairs = (k: string): number => (byKey.get(k) ?? []).filter((id) => reach.has(id)).length;
for (const z of kept) {
  const rect = rectOf.get(z.id);
  if (rect) z.open = z.open.filter((o) => pairs(key(rect, o)) >= 2);
}
// Ids seguidos (pela distância a casa, como no plano).
const rename = new Map(kept.map((z, i) => [z.id, `zone_w_${String(i)}`]));
const out: WildPlan = {
  version: 1,
  zones: kept.map((z) => ({ ...z, id: rename.get(z.id) ?? z.id })),
  hand: handOk.filter((e) => {
    const rect = rectOf.get(e.zone);
    return rect ? pairs(key(rect, e.open)) >= 2 : false;
  }),
};
for (const zoneId of carved) {
  const file = zones[zoneId]?.map;
  const map = maps.get(zoneId);
  if (file && map) writeFileSync(mapUrl(file), JSON.stringify(map));
}
// Uma zona por linha: o ficheiro fica legível nos diffs.
const line = (v: unknown): string => JSON.stringify(v);
writeFileSync(
  OUT,
  `{\n  "version": 1,\n  "zones": [\n${out.zones.map((z) => `    ${line(z)}`).join(',\n')}\n  ],\n  "hand": [\n${out.hand.map((h) => `    ${line(h)}`).join(',\n')}\n  ]\n}\n`,
);
const area = out.zones.reduce((sum, z) => sum + z.w * z.h, 0);
const handArea = hand.reduce((sum, r) => sum + r.w * r.h, 0);
console.log(
  `wilds.json: ${String(out.zones.length)} zonas (${String(out.zones.filter((z) => z.village).length)} aldeias), ` +
    `${String(out.hand.length)} passagens em ${String(carved.size)} zonas à mão; área ${String(area)} tiles ` +
    `(${(area / handArea + 1).toFixed(1)}× o mundo à mão)`,
);
export type { Side };

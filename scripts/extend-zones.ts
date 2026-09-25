// Alarga as zonas do mundo contínuo para leste (Etapa E): uma área de combate maior antes do
// poste de teletransporte, que passa para o fundo da zona, com o técnico (NPC) ao lado. A antiga
// borda leste fica como muralha com 3 portões (obriga a passar por sítios certos).
// Uso: `npm run map:extend` (só alarga os mapas que ainda não têm o técnico).

import { readFileSync, writeFileSync } from 'node:fs';
import { rng, TILE } from './mapgen.ts';

const EXTRA = 48;

interface MapObject {
  id: number;
  name: string;
  x: number;
  y: number;
  [key: string]: unknown;
}
interface Layer {
  name: string;
  type: string;
  width?: number;
  data?: number[];
  objects?: MapObject[];
}
interface TiledMap {
  width: number;
  height: number;
  layers: Layer[];
  nextobjectid: number;
}

/** Zona → [ficheiro, tile da borda nova, semente]. Os gids: 1 relva, 3 terra, 9 muro, 10 vedação, 11 rochedo. */
const ZONES: readonly [string, number, number][] = [
  ['pine_forest', 11, 1],
  ['farm', 10, 2],
  ['lake', 11, 3],
  ['road', 11, 4],
  ['village', 10, 5],
  ['deep_forest', 11, 6],
  ['industrial', 9, 7],
  ['hospital', 9, 8],
  ['military', 9, 9],
  ['city', 9, 10],
];
const DIRT = 3;

function extend(file: string, borderGid: number, seed: number): void {
  const url = new URL(`../public/assets/maps/${file}.json`, import.meta.url);
  const map = JSON.parse(readFileSync(url, 'utf8')) as TiledMap;
  const objectsLayer = map.layers.find((l) => l.type === 'objectgroup');
  const objects = objectsLayer?.objects ?? [];
  if (objects.some((o) => o.name.startsWith('npc:technician'))) {
    console.log(`maps/${file}.json: já alargado`);
    return;
  }
  const random = rng(20270200 + seed);
  const { width: w, height: h } = map;
  const nw = w + EXTRA;
  const layer = (name: string): number[] => {
    const found = map.layers.find((l) => l.name === name)?.data;
    if (!found) throw new Error(`${file}: sem camada ${name}`);
    return found;
  };
  const ground = layer('ground');
  // Chão da área nova: o mais comum no mapa.
  const counts = new Map<number, number>();
  for (const gid of ground) counts.set(gid, (counts.get(gid) ?? 0) + 1);
  const baseGround = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
  for (const l of map.layers) {
    if (l.type !== 'tilelayer' || !l.data) continue;
    const old = l.data;
    const next: number[] = [];
    for (let y = 0; y < h; y++) {
      next.push(...old.slice(y * w, (y + 1) * w));
      for (let x = 0; x < EXTRA; x++) next.push(l.name === 'ground' ? baseGround : 0);
    }
    l.data = next;
    l.width = nw;
  }
  map.width = nw;
  const g = layer('ground');
  const c = layer('collision');
  const at = (x: number, y: number): number => y * nw + x;
  // Borda nova (topo, fundo e leste).
  for (let x = w; x < nw; x++) {
    c[at(x, 0)] = borderGid;
    c[at(x, h - 1)] = borderGid;
  }
  for (let y = 0; y < h; y++) c[at(nw - 1, y)] = borderGid;
  // A antiga borda leste passa a muralha com 3 portões de 3 tiles.
  const gates = [0.25, 0.5, 0.75].map((f) => Math.round(h * f));
  for (let y = 1; y < h - 1; y++) {
    const gate = gates.some((gy) => Math.abs(y - gy) <= 1);
    c[at(w - 1, y)] = gate ? 0 : borderGid;
    if (gate) g[at(w - 1, y)] = DIRT;
  }
  const taken = new Set<number>();
  const free = (x: number, y: number, r: number): boolean => {
    for (let yy = y - r; yy <= y + r; yy++)
      for (let xx = x - r; xx <= x + r; xx++) {
        if (xx < w + 1 || yy < 2 || xx >= nw - 2 || yy >= h - 2) return false;
        if (c[at(xx, yy)] !== 0 || taken.has(at(xx, yy))) return false;
      }
    return true;
  };
  const take = (x: number, y: number, r: number): void => {
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) taken.add(at(xx, yy));
  };
  // Caminho de terra dos portões até ao poste (ao fundo, a meio).
  const post = { x: nw - 6, y: Math.round(h / 2) };
  for (const gy of gates) {
    let x = w - 1;
    let y = gy;
    while (x !== post.x || y !== post.y) {
      if (x !== post.x && (y === post.y || random() < 0.7)) x += Math.sign(post.x - x);
      else y += Math.sign(post.y - y);
      for (const [dx, dy] of [
        [0, 0],
        [0, 1],
      ] as const) {
        if (c[at(x + dx, y + dy)] === 0) {
          g[at(x + dx, y + dy)] = DIRT;
          taken.add(at(x + dx, y + dy));
        }
      }
    }
  }
  // Maciços (rochedos/muros) para dar forma à área, fora do caminho.
  for (let i = 0; i < Math.round(h / 6); i++) {
    const cx = w + 4 + Math.floor(random() * (EXTRA - 10));
    const cy = 3 + Math.floor(random() * (h - 6));
    const rw = 1 + Math.floor(random() * 3);
    const rh = 1 + Math.floor(random() * 3);
    let ok = true;
    for (let y = cy - 1; y <= cy + rh; y++)
      for (let x = cx - 1; x <= cx + rw; x++) if (taken.has(at(x, y)) || c[at(x, y)] !== 0) ok = false;
    if (!ok) continue;
    for (let y = cy; y < cy + rh; y++) for (let x = cx; x < cx + rw; x++) c[at(x, y)] = borderGid;
  }
  take(post.x, post.y, 3);

  let nextId = map.nextobjectid;
  const add = (name: string, tx: number, ty: number, point = false): void => {
    const x = point ? tx * TILE + TILE / 2 : tx * TILE + 4 + Math.floor(random() * 9);
    const y = point ? ty * TILE + TILE / 2 : (ty + 1) * TILE - 2;
    objects.push({
      id: nextId++,
      name,
      type: '',
      x,
      y,
      width: 0,
      height: 0,
      rotation: 0,
      point: true,
      visible: true,
    });
  };
  const scatter = (name: string, count: number, r: number, point = false): void => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 300; tries++) {
      const tx = w + 1 + Math.floor(random() * (EXTRA - 3));
      const ty = 2 + Math.floor(random() * (h - 4));
      if (!free(tx, ty, r)) continue;
      take(tx, ty, r);
      add(name, tx, ty, point);
      placed++;
    }
  };
  // O que a zona já tem, na mesma proporção (a área nova tem ~3/4 da largura original).
  const share = (EXTRA / w) * 0.6;
  const kinds = new Map<string, number>();
  for (const o of objects) {
    const kind = o.name.split(':')[0] ?? '';
    // Contentores únicos (o cofre da chave do bunker) não se repetem.
    if (
      ['resource', 'prop', 'container'].includes(kind) &&
      !['prop:waystone', 'container:safe'].includes(o.name)
    )
      kinds.set(o.name, (kinds.get(o.name) ?? 0) + 1);
  }
  for (const [name, n] of kinds) {
    const count = Math.max(name.startsWith('container:') ? 1 : 0, Math.round(n * share));
    scatter(name, count, name.startsWith('resource:tree') ? 1 : name.startsWith('container:') ? 1 : 0);
  }
  // Mais inimigos do que no resto da zona: é a área de combate antes do poste.
  const groups = objects.filter((o) => o.name.startsWith('enemy_spawn:')).map((o) => o.name);
  for (let i = 0; i < Math.max(5, Math.round(groups.length * 1.2)); i++) {
    const name = groups[Math.floor(random() * groups.length)];
    if (name) scatter(name, 1, 2, true);
  }
  // O poste vai para o fundo; o técnico fica ao lado.
  const waystone = objects.find((o) => o.name === 'prop:waystone');
  if (waystone) {
    waystone.x = post.x * TILE + TILE / 2;
    waystone.y = (post.y + 1) * TILE - 2;
  } else add('prop:waystone', post.x, post.y);
  add(`npc:technician`, post.x - 2, post.y + 1);
  map.nextobjectid = nextId;
  writeFileSync(url, `${JSON.stringify(map)}\n`);
  console.log(`maps/${file}.json: ${String(w)} → ${String(nw)} tiles de largura`);
}

for (const [file, border, seed] of ZONES) extend(file, border, seed);

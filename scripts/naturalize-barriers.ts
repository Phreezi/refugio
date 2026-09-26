// Divisórias naturais (pedido do jogador: "não serem só cercas"): troca as linhas de vedações,
// rochedos e muros que separam as zonas e os Caminhos do mundo contínuo por montes de terra,
// rochas, troncos caídos, riachos com cascata e penhascos (virados para o vazio), e torna-as
// irregulares (às vezes com 2 tiles de espessura). Nunca fecha passagens: no fim confirma que
// as saídas e as aberturas do mapa continuam acessíveis a partir do ponto de partida; se não,
// desfaz as partes irregulares desse mapa.
// Também atualiza o tileset embebido de todos os mapas (tiles acrescentados no fim).
// Uso: `npm run map:naturalize` (uma vez; `-- --force` refaz mapas já tratados).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE_TILES, type BaseTile } from '../src/world/tileset.ts';

const ROOT = new URL('../', import.meta.url);
const MAPS = new URL('public/assets/maps/', ROOT);
const SIZE = 16;
const force = process.argv.includes('--force');

interface Layer {
  name: string;
  type: string;
  data?: number[];
  objects?: { id: number; name: string; x: number; y: number }[];
}
interface TiledMap {
  width: number;
  height: number;
  layers: Layer[];
  tilesets: { firstgid: number; tilecount: number; columns: number; imagewidth: number }[];
}

const load = (file: string): TiledMap => JSON.parse(readFileSync(new URL(file, MAPS), 'utf8')) as TiledMap;
const save = (file: string, map: TiledMap): void => {
  writeFileSync(new URL(file, MAPS), JSON.stringify(map));
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const hash = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h;
};

// 1) Tileset embebido de todos os mapas: o número de tiles e a largura da imagem.
for (const file of readdirSync(MAPS).filter((f) => f.endsWith('.json'))) {
  const map = load(file);
  const ts = map.tilesets[0];
  if (!ts || ts.tilecount === BASE_TILES.length) continue;
  ts.tilecount = BASE_TILES.length;
  ts.columns = BASE_TILES.length;
  ts.imagewidth = BASE_TILES.length * SIZE;
  save(file, map);
}

// 2) Blocos do mundo contínuo (para saber que bordas dão para o vazio).
const zones = JSON.parse(readFileSync(new URL('src/data/zones.json', ROOT), 'utf8')) as Record<
  string,
  { map?: string; world?: [number, number] }
>;
const rects: { id: string; file: string; x: number; y: number; w: number; h: number }[] = [];
for (const [id, zone] of Object.entries(zones)) {
  if (!zone.world || !zone.map) continue;
  const file = zone.map.replace(/^maps\//, '');
  const map = load(file);
  rects.push({ id, file, x: zone.world[0], y: zone.world[1], w: map.width, h: map.height });
}
const inWorld = (wx: number, wy: number): boolean =>
  rects.some((r) => wx >= r.x && wy >= r.y && wx < r.x + r.w && wy < r.y + r.h);

const gid = (tile: BaseTile): number => BASE_TILES.indexOf(tile) + 1;
const NATURAL = new Set([gid('mound'), gid('rocks'), gid('log'), gid('cliff'), gid('waterfall')]);
const OPEN_GROUND = new Set([gid('grass'), gid('grass_flowers'), gid('sand')]);

function naturalize(rect: (typeof rects)[number]): void {
  const map = load(rect.file);
  const { width: W, height: H } = map;
  const layer = (name: string): number[] => {
    const data = map.layers.find((l) => l.name === name)?.data;
    if (!data) throw new Error(`${rect.file}: sem camada ${name}`);
    return data;
  };
  const ground = layer('ground');
  const collision = layer('collision');
  const objects = map.layers.find((l) => l.name === 'objects')?.objects ?? [];
  if (!force && collision.some((g) => NATURAL.has(g))) {
    console.log(`${rect.file}: já tratado`);
    return;
  }
  const route = rect.id.startsWith('zone_route_');
  const random = rng(hash(rect.id));
  const at = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  // Nos Caminhos trocam-se todas as linhas; nas zonas só as vedações e rochedos (os muros são
  // prédios) e só nas bordas e no muro antigo do alargamento para leste.
  const targets = new Set(
    route ? [gid('fence'), gid('boulder'), gid('wall')] : [gid('fence'), gid('boulder')],
  );
  const oldEdge = W - 49;
  const onDivider = (x: number, y: number): boolean =>
    route || x === 0 || y === 0 || x === W - 1 || y === H - 1 || x === oldEdge;
  const isTarget = (x: number, y: number): boolean => inside(x, y) && targets.has(collision[at(x, y)] ?? 0);
  const run = (x: number, y: number, dx: number, dy: number): number => {
    let n = 0;
    for (let i = 1; isTarget(x + dx * i, y + dy * i); i++) n++;
    return n;
  };
  const horizontal = (x: number, y: number): boolean => run(x, y, -1, 0) + run(x, y, 1, 0) >= 2;
  const vertical = (x: number, y: number): boolean => run(x, y, 0, -1) + run(x, y, 0, 1) >= 2;
  // Borda virada para o vazio (fora de todas as zonas): penhasco.
  const facesVoid = (x: number, y: number): boolean => {
    const out: [number, number][] = [];
    if (x === 0) out.push([-1, 0]);
    if (x === W - 1) out.push([1, 0]);
    if (y === 0) out.push([0, -1]);
    if (y === H - 1) out.push([0, 1]);
    return out.some(([dx, dy]) => !inWorld(rect.x + x + dx, rect.y + y + dy));
  };

  // Troços: tiles seguidos do mesmo tipo (monte, rochas ou tronco), 2–5 de cada vez.
  let kind: BaseTile = 'mound';
  let left = 0;
  const pick = (canLog: boolean): BaseTile => {
    if (left <= 0) {
      const r = random();
      kind = canLog && r < 0.2 ? 'log' : r < 0.6 ? 'mound' : 'rocks';
      left = 2 + Math.floor(random() * 4);
    }
    left--;
    return kind === 'log' && !canLog ? 'mound' : kind;
  };
  const swapped: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isTarget(x, y) || !onDivider(x, y)) continue;
      const h = horizontal(x, y);
      // Nas zonas, um rochedo solto fica; nos Caminhos troca-se tudo (até as pontas junto às passagens).
      if (!route && !h && !vertical(x, y)) continue;
      swapped.push([x, y]);
    }
  }
  for (const [x, y] of swapped)
    collision[at(x, y)] = gid(facesVoid(x, y) ? 'cliff' : pick(horizontal(x, y) && !vertical(x, y)));

  // Riachos com ponte: nos Caminhos, uma barreira interior em cada três vira água.
  const bridges: number[] = [];
  if (route) {
    const rows = [
      ...new Set(swapped.filter(([x, y]) => x > 0 && x < W - 1 && y > 0 && y < H - 1).map(([, y]) => y)),
    ];
    rows.forEach((row, i) => {
      if (i % 3 !== 1) return;
      for (let x = 1; x < W - 1; x++) {
        const c = at(x, row);
        if (NATURAL.has(collision[c] ?? 0)) {
          collision[c] = gid('water');
          ground[c] = gid('water');
        } else if (collision[c] === 0) {
          ground[c] = gid('floor_wood'); // a passagem é uma ponte de tábuas
          bridges.push(c);
        }
      }
      // Cascata a cair do lado do vazio (ou do lado de fora, se não houver vazio).
      const end = facesVoid(0, row) || !facesVoid(W - 1, row) ? 0 : W - 1;
      collision[at(end, row)] = gid('waterfall');
    });
  }

  // Irregular: às vezes a divisória tem 2 tiles de espessura (nunca perto de passagens,
  // caminhos, objetos, saídas ou do ponto de partida).
  const blocked = (c: number): boolean => (collision[c] ?? 0) !== 0;
  const openings: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && !blocked(at(x, y))) openings.push(at(x, y));
  const tileOf = (px: number, py: number): number => at(Math.floor(px / SIZE), Math.floor((py - 1) / SIZE));
  const special = objects
    .filter((o) => o.name === 'player_spawn' || o.name.startsWith('exit'))
    .map((o) => tileOf(o.x, o.y));
  const near = (c: number, list: readonly number[], d: number): boolean =>
    list.some(
      (o) => Math.abs((o % W) - (c % W)) <= d && Math.abs(Math.floor(o / W) - Math.floor(c / W)) <= d,
    );
  const objectTiles = new Set(objects.map((o) => tileOf(o.x, o.y)));
  const free = (x: number, y: number): boolean => {
    if (!inside(x, y) || x === 0 || y === 0 || x === W - 1 || y === H - 1) return false;
    const c = at(x, y);
    if (blocked(c) || !OPEN_GROUND.has(ground[c] ?? 0)) return false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = at(x + dx, y + dy);
        if (objectTiles.has(n)) return false;
        // Sem tapar os lados de uma passagem (os buracos da divisória).
        if (inside(x + dx, y + dy) && !blocked(n) && (dx !== 0 || dy !== 0) && isGap(x + dx, y + dy))
          return false;
      }
    return !near(c, openings, 3) && !near(c, special, 3) && !near(c, bridges, 2);
  };
  // Buraco numa divisória: livre, com divisória dos dois lados (na horizontal ou na vertical).
  function isGap(x: number, y: number): boolean {
    const wall = (dx: number, dy: number): boolean => {
      for (let i = 1; i <= 3; i++)
        if (inside(x + dx * i, y + dy * i) && NATURAL.has(collision[at(x + dx * i, y + dy * i)] ?? 0))
          return true;
      return false;
    };
    return (wall(-1, 0) && wall(1, 0)) || (wall(0, -1) && wall(0, 1));
  }
  const added: number[] = [];
  const before = reach();
  for (const [x, y] of swapped) {
    if (random() > 0.4) continue;
    const g = collision[at(x, y)] ?? 0;
    if (g === gid('water') || g === gid('waterfall')) continue;
    const dirs: [number, number][] = horizontal(x, y)
      ? [[0, random() < 0.5 ? -1 : 1]]
      : [[x === 0 ? 1 : -1, 0]];
    for (const [dx, dy] of dirs) {
      if (!free(x + dx, y + dy)) continue;
      const c = at(x + dx, y + dy);
      collision[c] = gid(random() < 0.6 ? 'mound' : 'rocks');
      added.push(c);
    }
  }

  // Nada ficou fechado? As saídas e as aberturas têm de continuar acessíveis.
  function reach(): Set<number> {
    const start = special.find((c) => !blocked(c)) ?? openings[0] ?? 0;
    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const c = queue.pop() ?? 0;
      const x = c % W;
      const y = Math.floor(c / W);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!inside(x + dx, y + dy)) continue;
        const n = at(x + dx, y + dy);
        if (!seen.has(n) && !blocked(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  }
  const reached = reach();
  const lost = openings.filter((c) => before.has(c) && !reached.has(c));
  if (lost.length > 0 && added.length > 0) {
    for (const c of added) collision[c] = 0;
    console.log(`${rect.file}: irregularidades desfeitas (fechavam ${String(lost.length)} aberturas)`);
  }
  const still = reach();
  const closed = openings.filter((c) => before.has(c) && !still.has(c));
  if (closed.length > 0) console.log(`${rect.file}: AVISO — ${String(closed.length)} aberturas sem acesso`);
  save(rect.file, map);
  console.log(
    `${rect.file}: ${String(swapped.length)} tiles trocados, ${String(added.length)} irregulares, ${String(bridges.length)} tábuas de ponte`,
  );
}

for (const rect of rects) if (rect.id !== 'zone_base') naturalize(rect);

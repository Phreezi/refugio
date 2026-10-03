// Mundo selvagem (plano D, pedido do jogador: "mapa 20× maior… caminhos orgânicos… não
// retangular… aldeias"): à volta das zonas desenhadas à mão há um continente de zonas geradas
// por código. O plano (onde fica cada zona, o bioma, o nível e as passagens entre zonas) é feito
// uma vez por `npm run map:wilds` e fica em `src/data/wilds.json`; o mapa de cada zona é gerado
// quando é preciso (com seed: é sempre igual), por isso o jogo não fica maior para descarregar.
// Módulo puro: também é usado por scripts/ (Node), por isso não importa nada em runtime.

export const BIOMES = ['meadow', 'forest', 'hills', 'marsh'] as const;
export type Biome = (typeof BIOMES)[number];

export type Side = 'n' | 's' | 'w' | 'e';
/** Passagem numa borda: lado, primeiro tile ao longo do lado (local) e largura. */
export type Opening = readonly [Side, number, number];

export interface WildZone {
  id: string;
  /** Canto superior esquerdo e tamanho, em tiles do mundo. */
  x: number;
  y: number;
  w: number;
  h: number;
  biome: Biome;
  level: number;
  seed: number;
  /** Nome do sítio (nome próprio, igual nas duas línguas). */
  name: string;
  open: Opening[];
  /** Aldeia (casas, NPCs com missões e um comerciante). */
  village?: boolean;
}

export interface WildPlan {
  version: number;
  zones: WildZone[];
  /** Passagens a abrir nas zonas desenhadas à mão (o script abre-as nos mapas). */
  hand: { zone: string; open: Opening }[];
}

export interface Rect {
  zoneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const WILD = {
  /** Grelha base das zonas e tamanho máximo/mínimo (tiles). */
  cell: 48,
  maxSize: 96,
  minSize: 12,
  /** As linhas da grelha ficam a pelo menos isto das bordas das zonas à mão. */
  keepOff: 16,
  /** Raios do continente (tiles), à volta do meio das zonas à mão. */
  rx: 880,
  ry: 780,
  openWidth: 3,
  minSegment: 10,
  openingEvery: 48,
  /** Meio da Casa (tiles do mundo): o nível das zonas cresce com a distância a ela. */
  home: { x: 24, y: 24 },
  /** Distância mínima entre aldeias (tiles). */
  villageSpacing: 190,
} as const;

// --- Ruído e aleatório com seed ---------------------------------------------------------------

export function hash(...values: number[]): number {
  let h = 2166136261;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

/** Ruído suave (0–1) em (x, y), com a grelha de 1 unidade. */
export function noise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Nível (≥ 1) de um ponto do mundo: cresce com a distância à Casa. */
export function levelAt(x: number, y: number): number {
  const d = Math.hypot(x - WILD.home.x, y - WILD.home.y);
  return Math.max(1, Math.round((d - 60) / 24));
}

/** Perigo T1–T4 de uma zona selvagem pelo nível. */
export function dangerOf(level: number): number {
  if (level < 5) return 1;
  if (level < 12) return 2;
  if (level < 20) return 3;
  return 4;
}

const NAME_START = [
  'Val',
  'Mont',
  'Rib',
  'Pen',
  'Font',
  'Lag',
  'Cov',
  'Serr',
  'Bouç',
  'Ermid',
  'Carv',
  'Frag',
  'Alv',
  'Sobr',
  'Azinh',
  'Castanh',
  'Pedr',
  'Torr',
  'Ced',
  'Freix',
  'Murt',
  'Louz',
  'Barr',
  'Vim',
  'Tojal',
  'Cerdeir',
  'Salgueir',
  'Amieir',
  'Junc',
  'Gest',
];
const NAME_END = [
  'eira',
  'ada',
  'elo',
  'inha',
  'ais',
  'oso',
  'edo',
  'ão',
  'alva',
  'ouco',
  'ega',
  'ela',
  'ido',
  'osa',
];

function placeName(seed: number, taken: Set<string>): string {
  for (let i = 0; ; i++) {
    const start = NAME_START[Math.floor(hash(seed, i, 1) * NAME_START.length)] ?? 'Val';
    const end = NAME_END[Math.floor(hash(seed, i, 2) * NAME_END.length)] ?? 'eira';
    const name = /[aeiou]$/.test(start) ? `${start}${end.replace(/^[aeiou]/, '')}` : `${start}${end}`;
    const suffix = i >= NAME_START.length * NAME_END.length ? ` ${String(i)}` : '';
    if (!taken.has(name + suffix)) {
      taken.add(name + suffix);
      return name + suffix;
    }
  }
}

// --- Plano ------------------------------------------------------------------------------------

const inside = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** Passagens na borda partilhada entre `a` e `b` (em tiles do mundo ao longo da borda). */
export function sharedOpenings(
  a: Rect,
  b: Rect,
  seed: number,
): { aSide: Side; bSide: Side; at: number[] } | null {
  let aSide: Side;
  let bSide: Side;
  let from: number;
  let to: number;
  if (a.x + a.w === b.x || b.x + b.w === a.x) {
    aSide = a.x + a.w === b.x ? 'e' : 'w';
    bSide = aSide === 'e' ? 'w' : 'e';
    from = Math.max(a.y, b.y);
    to = Math.min(a.y + a.h, b.y + b.h);
  } else if (a.y + a.h === b.y || b.y + b.h === a.y) {
    aSide = a.y + a.h === b.y ? 's' : 'n';
    bSide = aSide === 's' ? 'n' : 's';
    from = Math.max(a.x, b.x);
    to = Math.min(a.x + a.w, b.x + b.w);
  } else return null;
  const length = to - from;
  if (length < WILD.minSegment) return null;
  const count = 1 + Math.floor(length / WILD.openingEvery);
  const at: number[] = [];
  for (let k = 0; k < count; k++) {
    const start = from + Math.floor((k * length) / count);
    const size = Math.floor(length / count);
    const room = size - 6 - WILD.openWidth;
    if (room < 0) continue;
    at.push(start + 3 + Math.floor(hash(seed, from, to, k) * (room + 1)));
  }
  return at.length > 0 ? { aSide, bSide, at } : null;
}

/**
 * Faz o plano do mundo selvagem à volta das zonas `hand` (desenhadas à mão).
 * @param canOpen se dá para abrir uma passagem numa zona à mão (o script vê o mapa).
 */
export function planWilds(
  hand: readonly Rect[],
  seed: number,
  canOpen: (zoneId: string, open: Opening) => boolean = () => true,
): WildPlan {
  const minX = Math.min(...hand.map((r) => r.x));
  const maxX = Math.max(...hand.map((r) => r.x + r.w));
  const minY = Math.min(...hand.map((r) => r.y));
  const maxY = Math.max(...hand.map((r) => r.y + r.h));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const land = (x: number, y: number): boolean => {
    const d = Math.hypot((x - cx) / WILD.rx, (y - cy) / WILD.ry);
    return d < 1 + (noise(x / 240, y / 240, seed) - 0.5) * 0.55;
  };
  const cuts = (bounds: number[], lo: number, hi: number): number[] => {
    const set = new Set(bounds);
    for (let v = Math.floor(lo / WILD.cell) * WILD.cell; v <= hi; v += WILD.cell)
      if (bounds.every((b) => Math.abs(v - b) >= WILD.keepOff)) set.add(v);
    return [...set].sort((p, q) => p - q);
  };
  const xs = cuts(
    hand.flatMap((r) => [r.x, r.x + r.w]),
    cx - WILD.rx * 1.35,
    cx + WILD.rx * 1.35,
  );
  const ys = cuts(
    hand.flatMap((r) => [r.y, r.y + r.h]),
    cy - WILD.ry * 1.35,
    cy + WILD.ry * 1.35,
  );
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  // 0 = vazio (montanhas), 1 = livre, 2 = zona à mão / já usado.
  const cell = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x0 = xs[i] ?? 0;
      const y0 = ys[j] ?? 0;
      const mx = (x0 + (xs[i + 1] ?? 0)) / 2;
      const my = (y0 + (ys[j + 1] ?? 0)) / 2;
      cell[j * cols + i] = hand.some((r) => inside(r, mx, my)) ? 2 : land(mx, my) ? 1 : 0;
    }
  // Junta células livres em retângulos até `maxSize`.
  const rects: Rect[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (cell[j * cols + i] !== 1) continue;
      const x0 = xs[i] ?? 0;
      const y0 = ys[j] ?? 0;
      let i1 = i + 1;
      while (i1 < cols && cell[j * cols + i1] === 1 && (xs[i1 + 1] ?? 0) - x0 <= WILD.maxSize) i1++;
      let j1 = j + 1;
      while (j1 < rows && (ys[j1 + 1] ?? 0) - y0 <= WILD.maxSize) {
        let ok = true;
        for (let k = i; k < i1; k++) if (cell[j1 * cols + k] !== 1) ok = false;
        if (!ok) break;
        j1++;
      }
      for (let jj = j; jj < j1; jj++) for (let ii = i; ii < i1; ii++) cell[jj * cols + ii] = 2;
      const w = (xs[i1] ?? 0) - x0;
      const h = (ys[j1] ?? 0) - y0;
      if (w >= WILD.minSize && h >= WILD.minSize) rects.push({ zoneId: '', x: x0, y: y0, w, h });
    }
  const centre = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];
  const dist = (r: Rect): number => {
    const [x, y] = centre(r);
    return Math.hypot(x - WILD.home.x, y - WILD.home.y);
  };
  rects.sort((a, b) => dist(a) - dist(b) || a.y - b.y || a.x - b.x);
  const names = new Set<string>();
  const zones: WildZone[] = rects.map((r, i) => {
    const [x, y] = centre(r);
    const wet = noise(x / 300, y / 300, seed + 2);
    const rough = noise(x / 260, y / 260, seed + 1);
    const biome: Biome = wet > 0.64 ? 'marsh' : rough > 0.6 ? 'hills' : rough < 0.42 ? 'forest' : 'meadow';
    const id = `zone_w_${String(i)}`;
    r.zoneId = id;
    return {
      id,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      biome,
      level: levelAt(x, y),
      seed: Math.floor(hash(seed, i, 7) * 2 ** 31),
      name: placeName(Math.floor(hash(seed, i, 9) * 2 ** 31), names),
      open: [],
    };
  });
  // Aldeias: algumas zonas grandes, afastadas umas das outras.
  const villages: WildZone[] = [];
  for (const [i, z] of zones.entries()) {
    if (z.w < 40 || z.h < 40 || z.level < 2 || hash(seed, i, 11) > 0.3) continue;
    const [x, y] = centre(z as unknown as Rect);
    if (villages.some((v) => Math.hypot(v.x + v.w / 2 - x, v.y + v.h / 2 - y) < WILD.villageSpacing))
      continue;
    z.village = true;
    villages.push(z);
  }
  // Passagens entre zonas vizinhas: uma árvore que liga tudo (as zonas à mão contam como uma só,
  // já estão ligadas pelos Caminhos) e mais algumas ao acaso — um labirinto largo, à Pokémon.
  const byId = new Map(zones.map((z) => [z.id, z]));
  const all: Rect[] = [...hand, ...rects];
  const handOpen: WildPlan['hand'] = [];
  interface Edge {
    a: Rect;
    b: Rect;
    shared: { aSide: Side; bSide: Side; at: number[] };
    order: number;
  }
  const edges: Edge[] = [];
  for (let a = 0; a < all.length; a++)
    for (let b = a + 1; b < all.length; b++) {
      const ra = all[a];
      const rb = all[b];
      if (!ra || !rb || (!byId.has(ra.zoneId) && !byId.has(rb.zoneId))) continue;
      const shared = sharedOpenings(ra, rb, seed);
      if (!shared) continue;
      const local = (r: Rect, side: Side, at: number): Opening => [
        side,
        side === 'n' || side === 's' ? at - r.x : at - r.y,
        WILD.openWidth,
      ];
      // As passagens nas zonas à mão só onde se podem abrir.
      shared.at = shared.at.filter(
        (at) =>
          (byId.has(ra.zoneId) || canOpen(ra.zoneId, local(ra, shared.aSide, at))) &&
          (byId.has(rb.zoneId) || canOpen(rb.zoneId, local(rb, shared.bSide, at))),
      );
      if (shared.at.length === 0) continue;
      // Uma passagem por borda (duas nas muito compridas), a do meio.
      const keep =
        shared.at.length >= 3
          ? [shared.at[0], shared.at[shared.at.length - 1]]
          : [shared.at[Math.floor(shared.at.length / 2)]];
      shared.at = keep.filter((v): v is number => v !== undefined);
      edges.push({ a: ra, b: rb, shared, order: hash(seed, a, b, 13) });
    }
  edges.sort((p, q) => p.order - q.order);
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    const handRoot = byId.has(id) ? id : '#hand';
    let r = handRoot;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) ?? r;
    return r;
  };
  const chosen: Edge[] = [];
  const extra: Edge[] = [];
  for (const edge of edges) {
    const ra = root(edge.a.zoneId);
    const rb = root(edge.b.zoneId);
    if (ra !== rb) {
      parent.set(ra, rb);
      chosen.push(edge);
    } else extra.push(edge);
  }
  for (const edge of extra) if ((edge.order * 7) % 1 < 0.3) chosen.push(edge);
  for (const { a: ra, b: rb, shared } of chosen) {
    const wildA = byId.get(ra.zoneId);
    const wildB = byId.get(rb.zoneId);
    for (const at of shared.at) {
      const local = (r: Rect, side: Side): Opening => [
        side,
        side === 'n' || side === 's' ? at - r.x : at - r.y,
        WILD.openWidth,
      ];
      const oa = local(ra, shared.aSide);
      const ob = local(rb, shared.bSide);
      if (wildA) wildA.open.push(oa);
      else handOpen.push({ zone: ra.zoneId, open: oa });
      if (wildB) wildB.open.push(ob);
      else handOpen.push({ zone: rb.zoneId, open: ob });
    }
  }
  return { version: 1, zones, hand: handOpen };
}

/** A borda vizinha de uma passagem (a outra zona e a passagem dela), para tirar passagens aos pares. */
export function mirrorOpening(from: Rect, open: Opening): { x: number; y: number; side: Side } {
  const [side, at] = open;
  if (side === 'n') return { x: from.x + at, y: from.y - 1, side: 's' };
  if (side === 's') return { x: from.x + at, y: from.y + from.h, side: 'n' };
  if (side === 'w') return { x: from.x - 1, y: from.y + at, side: 'e' };
  return { x: from.x + from.w, y: from.y + at, side: 'w' };
}

// --- Gerador do mapa de uma zona --------------------------------------------------------------

export const TILE_PX = 16;

/** Tiles usados pelo gerador (nomes do tileset da base). */
type Tile =
  | 'grass'
  | 'grass_flowers'
  | 'dirt'
  | 'sand'
  | 'water'
  | 'floor_wood'
  | 'wall'
  | 'boulder'
  | 'mound'
  | 'rocks'
  | 'log'
  | 'cliff';

const BARRIERS: Readonly<Record<Biome, readonly Tile[]>> = {
  meadow: ['mound', 'mound', 'rocks', 'mound'],
  forest: ['mound', 'log', 'mound', 'rocks'],
  hills: ['rocks', 'boulder', 'cliff', 'rocks'],
  marsh: ['mound', 'log', 'mound', 'rocks'],
};

/** Recursos por 1000 tiles, por bioma: [id, densidade, nível mínimo]. */
const RESOURCES: Readonly<Record<Biome, readonly [string, number, number][]>> = {
  forest: [
    ['tree_small', 8, 1],
    ['tree_large', 4, 1],
    ['bush_berries', 1.5, 1],
    ['tall_grass', 3, 1],
    ['rock', 1, 1],
    ['iron_vein', 0.4, 10],
  ],
  meadow: [
    ['tall_grass', 6, 1],
    ['bush_berries', 2.5, 1],
    ['tree_small', 1.8, 1],
    ['rock', 1.5, 1],
  ],
  hills: [
    ['rock', 5, 1],
    ['tree_small', 1.2, 1],
    ['tall_grass', 1.5, 1],
    ['iron_vein', 1.6, 6],
  ],
  marsh: [
    ['tall_grass', 6, 1],
    ['clay_pit', 1.8, 1],
    ['bush_berries', 1.5, 1],
    ['tree_small', 1.2, 1],
  ],
};

const PROPS: Readonly<Record<Biome, readonly string[]>> = {
  forest: ['log', 'stump', 'stump', 'pebbles'],
  meadow: ['pebbles', 'fence_broken', 'stump', 'crate'],
  hills: ['pebbles', 'pebbles', 'log', 'barrel'],
  marsh: ['log', 'stump', 'pebbles', 'barrel'],
};

const CONTAINERS: readonly (readonly string[])[] = [
  ['crate', 'barrel'],
  ['crate', 'barrel'],
  ['crate', 'car_trunk', 'village_cabinet', 'barrel'],
  ['industrial_locker', 'medical_cabinet', 'crate'],
  ['armory', 'city_store', 'cabinet'],
];

const ENEMY_GROUPS: readonly Readonly<Partial<Record<Biome | 'all', readonly string[]>>>[] = [
  {},
  { all: ['walkers', 'walker'], meadow: ['deer'], forest: ['deer', 'wolf_night'], marsh: ['wolf_night'] },
  { all: ['t2_mixed', 'runners', 'wolves', 'bloated'], forest: ['boars'], hills: ['boars'] },
  { all: ['t3_mixed', 'screamer', 'spitters', 'armored', 'tanks'], forest: ['bears'] },
  { all: ['t4_mixed', 'squad', 'screamers', 'armored', 'spitters'] },
];

/** O inimigo das missões das aldeias, por perigo (e o grupo onde nasce). */
export const VILLAGE_QUARRY: readonly (readonly [string, string])[] = [
  ['zombie_walker', 'walkers'],
  ['zombie_walker', 'walkers'],
  ['zombie_runner', 'runners'],
  ['zombie_spitter', 'spitters'],
  ['zombie_armored', 'armored'],
];

export interface VillageSpots {
  /** Pés (px da zona) do ancião (missões) e do comerciante. */
  elder: { x: number; y: number };
  trader: { x: number; y: number };
}

/** Praça da zona (tile): o meio, com um desvio nas zonas sem aldeia. */
export function hubOf(z: WildZone): { x: number; y: number } {
  if (z.village) return { x: Math.floor(z.w / 2), y: Math.floor(z.h / 2) };
  const jx = Math.floor((hash(z.seed, 1) - 0.5) * (z.w / 3));
  const jy = Math.floor((hash(z.seed, 2) - 0.5) * (z.h / 3));
  return { x: Math.floor(z.w / 2) + jx, y: Math.floor(z.h / 2) + jy };
}

const feet = (tx: number, ty: number): { x: number; y: number } => ({
  x: tx * TILE_PX + TILE_PX / 2,
  y: (ty + 1) * TILE_PX - 2,
});

export function villageSpots(z: WildZone): VillageSpots {
  const hub = hubOf(z);
  return { elder: feet(hub.x - 2, hub.y - 2), trader: feet(hub.x + 2, hub.y - 2) };
}

/** Ids dos NPCs de uma aldeia. */
export function villageNpcIds(z: WildZone): { elder: string; trader: string } {
  const n = z.id.slice('zone_w_'.length);
  return { elder: `w${n}_elder`, trader: `w${n}_trader` };
}

interface Placed {
  name: string;
  x: number;
  y: number;
}

/**
 * Gera o mapa (JSON do Tiled, como os desenhados à mão) de uma zona selvagem.
 * @param gid gid de cada tile do tileset da base (firstgid 1).
 * @param tileset dados do tileset embebido (nome, ficheiro, número de tiles).
 */
export function generateWild(
  z: WildZone,
  gid: (tile: Tile) => number,
  tileset: { name: string; image: string; count: number },
): Record<string, unknown> {
  const W = z.w;
  const H = z.h;
  const random = rng(z.seed);
  const danger = dangerOf(z.level);
  const ground: Tile[] = new Array<Tile>(W * H).fill('grass');
  const collision: (Tile | null)[] = new Array<Tile | null>(W * H).fill(null);
  const reserved = new Uint8Array(W * H);
  const taken = new Uint8Array(W * H);
  const path = new Uint8Array(W * H);
  const objects: Placed[] = [];
  const points: Placed[] = [];
  const at = (x: number, y: number): number => y * W + x;
  const inMap = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const clear = (x: number, y: number, tile: Tile = 'dirt'): void => {
    if (!inMap(x, y)) return;
    const i = at(x, y);
    collision[i] = null;
    ground[i] = tile;
    reserved[i] = 1;
    path[i] = 1;
  };

  // Chão por bioma.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = noise((z.x + x) / 9, (z.y + y) / 9, z.seed);
      const i = at(x, y);
      if (z.biome === 'meadow' && random() < 0.07) ground[i] = 'grass_flowers';
      else if (z.biome === 'hills' && n > 0.72) ground[i] = 'dirt';
      else if (z.biome === 'forest' && n > 0.8) ground[i] = 'dirt';
      else if (z.biome === 'marsh' && n > 0.75) ground[i] = 'sand';
      else if (random() < 0.015) ground[i] = 'grass_flowers';
    }

  // Bordas irregulares (1–3 tiles) com as passagens abertas.
  const barrier = BARRIERS[z.biome];
  const thickness = (t: number, side: number): number =>
    1 + Math.floor(noise(t / 6, side * 31.7, z.seed + 5) * 3);
  for (let x = 0; x < W; x++) {
    const tn = thickness(z.x + x, 1);
    const ts = thickness(z.x + x, 2);
    for (let d = 0; d < tn; d++) collision[at(x, d)] = pick(barrier);
    for (let d = 0; d < ts; d++) collision[at(x, H - 1 - d)] = pick(barrier);
  }
  for (let y = 0; y < H; y++) {
    const tw = thickness(z.y + y, 3);
    const te = thickness(z.y + y, 4);
    for (let d = 0; d < tw; d++) collision[at(d, y)] = pick(barrier);
    for (let d = 0; d < te; d++) collision[at(W - 1 - d, y)] = pick(barrier);
  }
  for (let i = 0; i < W * H; i++) if (collision[i] !== null) reserved[i] = 1;

  const hub = hubOf(z);
  const ends: { x: number; y: number }[] = [];
  const DEPTH = 5;
  for (const [side, start, width] of z.open) {
    for (let k = 0; k < width; k++) {
      const p = start + k;
      for (let d = 0; d <= DEPTH; d++) {
        if (side === 'n') clear(p, d);
        else if (side === 's') clear(p, H - 1 - d);
        else if (side === 'w') clear(d, p);
        else clear(W - 1 - d, p);
      }
    }
    const mid = start + Math.floor(width / 2);
    ends.push(
      side === 'n'
        ? { x: mid, y: DEPTH }
        : side === 's'
          ? { x: mid, y: H - 1 - DEPTH }
          : side === 'w'
            ? { x: DEPTH, y: mid }
            : { x: W - 1 - DEPTH, y: mid },
    );
  }

  // Caminhos de terra sinuosos das passagens até à praça.
  const lo = 4;
  const hiX = W - 5;
  const hiY = H - 5;
  for (const end of ends) {
    let x = end.x;
    let y = end.y;
    let wobble = 0;
    for (let step = 0; step < 6 * (W + H); step++) {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        if (x + dx > 0 && y + dy > 0 && x + dx < W - 1 && y + dy < H - 1) clear(x + dx, y + dy);
      if (x === hub.x && y === hub.y) break;
      const rx = hub.x - x;
      const ry = hub.y - y;
      // Curvas: de vez em quando desvia-se uns tiles para o lado (fica orgânico, mas chega).
      if (wobble === 0 && random() < 0.08)
        wobble = (random() < 0.5 ? -1 : 1) * (2 + Math.floor(random() * 4));
      const horizontal = Math.abs(rx) >= Math.abs(ry);
      if (wobble !== 0 && Math.abs(rx) + Math.abs(ry) > 6) {
        const s = Math.sign(wobble);
        if (horizontal) y = Math.max(lo, Math.min(hiY, y + s));
        else x = Math.max(lo, Math.min(hiX, x + s));
        wobble -= s;
        continue;
      }
      if (rx !== 0 && (ry === 0 || random() < Math.abs(rx) / (Math.abs(rx) + Math.abs(ry))))
        x += Math.sign(rx);
      else y += Math.sign(ry);
    }
  }
  if (ends.length === 0) clear(hub.x, hub.y);

  // Aldeia: praça, casas, poço, NPCs.
  const houses: { x0: number; y0: number; x1: number; y1: number }[] = [];
  if (z.village) {
    for (let y = hub.y - 3; y <= hub.y + 3; y++) for (let x = hub.x - 5; x <= hub.x + 5; x++) clear(x, y);
    const spots = [
      [hub.x - 12, hub.y - 10],
      [hub.x + 6, hub.y - 10],
      [hub.x - 12, hub.y + 5],
      [hub.x + 6, hub.y + 5],
      [hub.x - 3, hub.y - 12],
      [hub.x - 3, hub.y + 7],
    ] as const;
    const fits = (x0: number, y0: number): boolean => {
      if (x0 < 4 || y0 < 5 || x0 + 6 > W - 5 || y0 + 4 > H - 6) return false;
      for (let y = y0 - 1; y <= y0 + 5; y++)
        for (let x = x0 - 1; x <= x0 + 7; x++)
          if (path[at(x, y)] || collision[at(x, y)] !== null) return false;
      return true;
    };
    for (const [sx, sy] of spots) {
      // Se um caminho passa por ali, tenta um pouco ao lado.
      const spot = [
        [0, 0],
        [-3, 0],
        [3, 0],
        [0, -3],
        [0, 3],
        [-4, -3],
        [4, 3],
      ]
        .map(([dx, dy]) => [sx + (dx ?? 0), sy + (dy ?? 0)] as const)
        .find(([x, y]) => fits(x, y));
      if (!spot) continue;
      const [x0, y0] = spot;
      const x1 = x0 + 6;
      const y1 = y0 + 4;
      const doorX = x0 + 3;
      // A porta fica virada para a praça.
      const top = y0 > hub.y;
      const doorY = top ? y0 : y1;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = at(x, y);
          ground[i] = 'floor_wood';
          reserved[i] = 1;
          const edge = x === x0 || x === x1 || y === y0 || y === y1;
          if (edge && !(y === doorY && x === doorX)) collision[i] = 'wall';
        }
      // Da porta até ao caminho mais perto.
      for (let y = doorY + (top ? -1 : 1); y > 3 && y < H - 4; y += top ? -1 : 1) {
        if (path[at(doorX, y)]) break;
        clear(doorX, y);
      }
      houses.push({ x0, y0, x1, y1 });
    }
    const npc = villageNpcIds(z);
    objects.push({ name: `npc:${npc.elder}`, ...feet(hub.x - 2, hub.y - 2) });
    objects.push({ name: `npc:${npc.trader}`, ...feet(hub.x + 2, hub.y - 2) });
    objects.push({ name: 'prop:well', ...feet(hub.x, hub.y + 2) });
    for (const [x, y] of [
      [hub.x - 2, hub.y - 2],
      [hub.x + 2, hub.y - 2],
      [hub.x, hub.y + 2],
    ] as const)
      for (let yy = y - 1; yy <= y; yy++) for (let xx = x - 1; xx <= x + 1; xx++) taken[at(xx, yy)] = 1;
  }

  // Tanques e lagos (longe dos caminhos).
  const ponds =
    z.biome === 'marsh'
      ? 4 + Math.floor(random() * 4)
      : z.biome === 'hills'
        ? Math.floor(random() * 2)
        : 1 + Math.floor(random() * 2);
  for (let p = 0, tries = 0; p < ponds && tries < 200; tries++) {
    const rx = 2 + Math.floor(random() * 5);
    const ry = 2 + Math.floor(random() * 3);
    const cx = rx + 4 + Math.floor(random() * (W - 2 * rx - 8));
    const cy = ry + 4 + Math.floor(random() * (H - 2 * ry - 8));
    let ok = true;
    for (let y = cy - ry - 1; y <= cy + ry + 1 && ok; y++)
      for (let x = cx - rx - 1; x <= cx + rx + 1 && ok; x++)
        if (!inMap(x, y) || reserved[at(x, y)] || taken[at(x, y)]) ok = false;
    if (!ok) continue;
    for (let y = cy - ry - 1; y <= cy + ry + 1; y++)
      for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
        const d = ((x - cx) / (rx + 0.5)) ** 2 + ((y - cy) / (ry + 0.5)) ** 2;
        const i = at(x, y);
        if (d <= 1) {
          ground[i] = 'water';
          collision[i] = 'water';
        } else if (d <= 1.6 && z.biome !== 'forest') ground[i] = 'sand';
        reserved[i] = 1;
      }
    p++;
  }

  // Montes de rochas soltos (colinas) e troncos caídos (floresta).
  const clumps = z.biome === 'hills' ? 6 + Math.floor(random() * 6) : z.biome === 'forest' ? 3 : 2;
  for (let c = 0, tries = 0; c < clumps && tries < 200; tries++) {
    const x = 4 + Math.floor(random() * (W - 8));
    const y = 4 + Math.floor(random() * (H - 8));
    const len = 1 + Math.floor(random() * 3);
    let ok = true;
    for (let k = -1; k <= len && ok; k++)
      for (let d = -1; d <= 1 && ok; d++)
        if (reserved[at(x + k, y + d)] || taken[at(x + k, y + d)]) ok = false;
    if (!ok) continue;
    for (let k = 0; k < len; k++) {
      collision[at(x + k, y)] =
        z.biome === 'hills' ? pick(['rocks', 'boulder'] as const) : pick(['log', 'mound'] as const);
      reserved[at(x + k, y)] = 1;
    }
    c++;
  }

  const area = W * H;
  const free = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (x0 < 2 || y0 < 2 || x1 > W - 3 || y1 > H - 3) return false;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = at(x, y);
        if (reserved[i] || taken[i] || collision[i] !== null) return false;
      }
    return true;
  };
  const scatter = (name: string, count: number, clearance: number, tall = 1): void => {
    for (let placed = 0, tries = 0; placed < count && tries < count * 60; tries++) {
      const tx = 2 + Math.floor(random() * (W - 4));
      const ty = 2 + Math.floor(random() * (H - 4));
      if (!free(tx - clearance, ty - tall + 1 - clearance, tx + clearance, ty + clearance)) continue;
      for (let y = ty - tall + 1; y <= ty; y++) taken[at(tx, y)] = 1;
      objects.push({
        name,
        x: tx * TILE_PX + 4 + Math.floor(random() * 9),
        y: (ty + 1) * TILE_PX - 1 - Math.floor(random() * 4),
      });
      placed++;
    }
  };
  const scale = area / 1000;
  for (const [id, density, level] of RESOURCES[z.biome]) {
    if (z.level < level) continue;
    scatter(
      `resource:${id}`,
      Math.round(density * scale),
      id === 'tall_grass' ? 0 : 1,
      id === 'tree_large' ? 2 : 1,
    );
  }
  for (const prop of PROPS[z.biome]) scatter(`prop:${prop}`, Math.max(1, Math.round(scale * 0.25)), 1);

  // Contentores (dentro das casas, na aldeia) e inimigos.
  const tables = CONTAINERS[danger] ?? CONTAINERS[1] ?? [];
  for (const house of houses) {
    const tx = house.x0 + 1 + Math.floor(random() * 2);
    const ty = house.y0 > hub.y ? house.y1 - 1 : house.y0 + 1;
    objects.push({ name: `container:${pick(tables)}`, ...feet(tx, ty) });
  }
  scatter(`container:${pick(tables)}`, 1 + Math.floor(area / 4500), 1);
  const groups = ENEMY_GROUPS[danger] ?? {};
  const list = [...(groups.all ?? []), ...(groups[z.biome] ?? [])];
  const spawnCount = 2 + Math.floor(area / 2600);
  const farFrom = (x: number, y: number, d: number, pts: readonly { x: number; y: number }[]): boolean =>
    pts.every((p) => Math.hypot(p.x - x, p.y - y) >= d);
  const spawns: { x: number; y: number }[] = [];
  const quarry = VILLAGE_QUARRY[danger]?.[1];
  for (let s = 0, tries = 0; s < spawnCount + (z.village ? 2 : 0) && tries < 400; tries++) {
    const x = 4 + Math.floor(random() * (W - 8));
    const y = 4 + Math.floor(random() * (H - 8));
    const i = at(x, y);
    if (collision[i] !== null || taken[i]) continue;
    if (!farFrom(x, y, 9, ends)) continue;
    if (z.village && !farFrom(x, y, 18, [hub])) continue;
    if (!farFrom(x, y, 10, spawns)) continue;
    spawns.push({ x, y });
    const group = z.village && s < 2 && quarry ? quarry : pick(list);
    points.push({ name: `enemy_spawn:${group}`, x: x * TILE_PX + TILE_PX / 2, y: y * TILE_PX + TILE_PX / 2 });
    s++;
  }
  points.push({ name: 'player_spawn', x: hub.x * TILE_PX + TILE_PX / 2, y: hub.y * TILE_PX + TILE_PX / 2 });

  // JSON do Tiled (o mesmo formato que scripts/mapgen.ts escreve).
  let nextObjectId = 1;
  const obj = (p: Placed) => ({
    id: nextObjectId++,
    name: p.name,
    type: '',
    x: p.x,
    y: p.y,
    width: 0,
    height: 0,
    rotation: 0,
    point: true,
    visible: true,
  });
  const layerObjects = [...points.map(obj), ...objects.sort((a, b) => a.y - b.y || a.x - b.x).map(obj)];
  let nextLayerId = 1;
  const tileLayer = (name: string, data: readonly (Tile | null)[] | null) => ({
    id: nextLayerId++,
    name,
    type: 'tilelayer',
    x: 0,
    y: 0,
    width: W,
    height: H,
    opacity: 1,
    visible: true,
    data: data ? data.map((t) => (t === null ? 0 : gid(t))) : new Array<number>(W * H).fill(0),
  });
  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.11.2',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    compressionlevel: -1,
    width: W,
    height: H,
    tilewidth: TILE_PX,
    tileheight: TILE_PX,
    layers: [
      tileLayer('ground', ground),
      tileLayer('decor_low', null),
      tileLayer('collision', collision),
      tileLayer('decor_high', null),
      {
        id: nextLayerId++,
        name: 'objects',
        type: 'objectgroup',
        draworder: 'topdown',
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        objects: layerObjects,
      },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: tileset.name,
        image: tileset.image,
        imagewidth: TILE_PX * tileset.count,
        imageheight: TILE_PX,
        tilewidth: TILE_PX,
        tileheight: TILE_PX,
        tilecount: tileset.count,
        columns: tileset.count,
        margin: 0,
        spacing: 0,
      },
    ],
    nextlayerid: nextLayerId,
    nextobjectid: nextObjectId,
  };
}

/** Valida a forma de `wilds.json` (sem verificar as referências: isso faz o validate-data). */
export function parseWildPlan(input: unknown): WildPlan {
  const fail = (why: string): never => {
    throw new Error(`wilds.json inválido: ${why}`);
  };
  if (typeof input !== 'object' || input === null) return fail('tem de ser um objeto');
  const raw = input as Partial<WildPlan>;
  if (!Array.isArray(raw.zones) || !Array.isArray(raw.hand)) return fail('faltam "zones"/"hand"');
  for (const z of raw.zones as Partial<Record<keyof WildZone, unknown>>[]) {
    const id = JSON.stringify(z.id);
    if (typeof z.id !== 'string' || !/^zone_w_\d+$/.test(z.id)) fail(`id ${id}`);
    if (![z.x, z.y, z.w, z.h, z.level, z.seed].every(Number.isInteger)) fail(`${id}: números inválidos`);
    if (!(BIOMES as readonly unknown[]).includes(z.biome)) fail(`${id}: bioma ${JSON.stringify(z.biome)}`);
    if (!Array.isArray(z.open)) fail(`${id}: "open"`);
  }
  return raw as WildPlan;
}

// Gera o tileset placeholder da base (public/assets/tiles/base_tiles.png) só com cores da paleta.
// Os tiles vão por ordem de BASE_TILES (src/world/tileset.ts), numa linha de 16 px cada.
// Serve ao jogo e ao Tiled (o mapa referencia este PNG). Quando houver arte final, substitui-se
// o PNG mantendo a ordem dos tiles.
// Uso: `npm run tiles`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE_TILES, BASE_TILESET_FILE, type BaseTile } from '../src/world/tileset.ts';
import { Bitmap, hexToRgb, type Rgb } from './png.ts';

const ROOT = new URL('../', import.meta.url);
const SIZE = 16;

const palette = JSON.parse(readFileSync(new URL('src/assets/palette.json', ROOT), 'utf8')) as Record<
  string,
  string
>;
function color(name: string): Rgb {
  const hex = palette[name];
  if (hex === undefined) throw new Error(`Cor fora da paleta: ${name}`);
  return hexToRgb(hex);
}

/** Gerador pseudoaleatório com seed (os PNG têm de sair iguais em cada execução). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Painter = (img: Bitmap, ox: number) => void;

/** Fundo liso com salpicos de outras cores (relva, terra, areia…). */
function speckled(base: string, specks: readonly [string, number][], seed: number): Painter {
  return (img, ox) => {
    img.fill(ox, 0, SIZE, SIZE, color(base));
    const random = rng(seed);
    for (const [name, count] of specks) {
      for (let i = 0; i < count; i++) {
        img.set(ox + Math.floor(random() * SIZE), Math.floor(random() * SIZE), color(name));
      }
    }
  };
}

const grass = speckled(
  'grass',
  [
    ['leaf', 14],
    ['forest', 8],
  ],
  1,
);

const painters: Record<BaseTile, Painter> = {
  grass,
  grass_flowers: (img, ox) => {
    grass(img, ox);
    for (const [x, y, c] of [
      [3, 4, 'wheat'],
      [11, 3, 'rose'],
      [7, 10, 'wheat'],
      [13, 12, 'cream'],
      [2, 13, 'rose'],
    ] as const) {
      img.set(ox + x, y, color(c));
      img.set(ox + x, y + 1, color('forest'));
    }
  },
  dirt: speckled(
    'wood',
    [
      ['bark', 16],
      ['wood_light', 6],
    ],
    2,
  ),
  sand: speckled(
    'sand',
    [
      ['wheat', 12],
      ['wood_light', 6],
    ],
    3,
  ),
  water: (img, ox) => {
    img.fill(ox, 0, SIZE, SIZE, color('water'));
    img.fill(ox + 2, 4, 5, 1, color('sky'));
    img.fill(ox + 9, 10, 5, 1, color('sky'));
    img.fill(ox + 11, 3, 3, 1, color('deep_water'));
    img.fill(ox + 3, 13, 3, 1, color('deep_water'));
  },
  road: speckled(
    'stone_dark',
    [
      ['stone', 14],
      ['shadow', 8],
    ],
    4,
  ),
  floor_wood: (img, ox) => {
    img.fill(ox, 0, SIZE, SIZE, color('wood_light'));
    for (let y = 3; y < SIZE; y += 4) img.fill(ox, y, SIZE, 1, color('wood'));
    // Juntas das tábuas desencontradas.
    for (const [x, y] of [
      [5, 0],
      [12, 4],
      [2, 8],
      [9, 12],
    ] as const) {
      img.fill(ox + x, y, 1, 3, color('wood'));
    }
  },
  floor_concrete: speckled(
    'stone_light',
    [
      ['stone', 10],
      ['parchment', 6],
    ],
    5,
  ),
  wall: (img, ox) => {
    // Tijolos de 8 × 4 com argamassa de 1 px, fiadas desencontradas.
    for (let y = 0; y < SIZE; y++) {
      const offset = Math.floor(y / 4) % 2 === 0 ? 0 : 4;
      for (let x = 0; x < SIZE; x++) {
        const mortar = y % 4 === 3 || (x + offset) % 8 === 7;
        img.set(ox + x, y, color(mortar ? 'stone_dark' : 'stone'));
      }
    }
    img.fill(ox, 0, SIZE, 1, color('stone_light'));
  },
  // Vedação e rochedo têm fundo transparente: ficam na camada `collision`, por cima do chão.
  fence: (img, ox) => {
    img.fill(ox, 5, SIZE, 2, color('wood'));
    img.fill(ox, 10, SIZE, 2, color('wood'));
    for (const x of [1, 9]) {
      img.fill(ox + x, 2, 3, 13, color('bark'));
      img.fill(ox + x, 2, 3, 1, color('wood_light'));
      img.fill(ox + x + 2, 3, 1, 12, color('bark_dark'));
    }
  },
  boulder: (img, ox) => {
    const rows: readonly [number, number][] = [
      [5, 6],
      [3, 10],
      [2, 12],
      [1, 14],
      [1, 14],
      [1, 14],
      [1, 14],
      [1, 14],
      [1, 14],
      [2, 12],
      [2, 12],
      [3, 10],
    ];
    for (const [i, [x, w]] of rows.entries()) {
      const y = i + 3;
      img.fill(ox + x, y, w, 1, color('stone'));
      img.set(ox + x, y, color('stone_dark'));
      img.set(ox + x + w - 1, y, color('shadow'));
    }
    img.fill(ox + 4, 5, 4, 2, color('stone_light'));
    img.fill(ox + 3, 13, 10, 2, color('stone_dark'));
  },
  floor_dark: (img, ox) => {
    speckled(
      'stone_dark',
      [
        ['shadow', 12],
        ['stone', 5],
      ],
      6,
    )(img, ox);
    // Placas de metal de 8 × 8.
    img.fill(ox, 7, SIZE, 1, color('shadow'));
    img.fill(ox + 7, 0, 1, SIZE, color('shadow'));
  },
  // Escadas: degraus a escurecer para onde se desce (ou a clarear para onde se sobe).
  stairs_down: (img, ox) => {
    const steps = ['stone_light', 'stone', 'stone_dark', 'shadow'] as const;
    for (const [i, c] of steps.entries()) {
      img.fill(ox, i * 4, SIZE, 4, color(c));
      img.fill(ox, i * 4, SIZE, 1, color('stone_light'));
    }
    img.fill(ox, 0, 1, SIZE, color('ink'));
    img.fill(ox + SIZE - 1, 0, 1, SIZE, color('ink'));
  },
  stairs_up: (img, ox) => {
    const steps = ['shadow', 'stone_dark', 'stone', 'stone_light'] as const;
    for (const [i, c] of steps.entries()) {
      img.fill(ox, i * 4, SIZE, 4, color(c));
      img.fill(ox, i * 4 + 3, SIZE, 1, color('ink'));
    }
    img.fill(ox, 0, 1, SIZE, color('ink'));
    img.fill(ox + SIZE - 1, 0, 1, SIZE, color('ink'));
  },
};

const image = new Bitmap(SIZE * BASE_TILES.length, SIZE);
for (const [i, tile] of BASE_TILES.entries()) painters[tile](image, i * SIZE);

const out = new URL(`public/assets/${BASE_TILESET_FILE}`, ROOT);
mkdirSync(new URL('./', out), { recursive: true });
writeFileSync(out, image.toPng());
console.log(
  `${BASE_TILESET_FILE}: ${String(BASE_TILES.length)} tiles, ${String(image.width)}×${String(image.height)} px`,
);

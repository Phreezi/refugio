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
  dirt: (img, ox) => {
    // Terra batida: base castanha, manchas mais escuras e seixinhos com luz em cima.
    speckled(
      'wood',
      [
        ['bark', 10],
        ['wood_light', 4],
      ],
      2,
    )(img, ox);
    for (const [x, y] of [
      [3, 3],
      [11, 6],
      [6, 12],
      [13, 13],
    ] as const) {
      img.fill(ox + x, y, 2, 1, color('bark'));
      img.set(ox + x, y - 1, color('wood_light'));
    }
    for (const [x, y] of [
      [8, 2],
      [2, 9],
      [12, 10],
    ] as const) {
      img.set(ox + x, y, color('stone'));
      img.set(ox + x, y + 1, color('bark_dark'));
    }
  },
  sand: speckled(
    'sand',
    [
      ['wheat', 12],
      ['wood_light', 6],
    ],
    3,
  ),
  water: (img, ox) => {
    // Água: fundo com zonas mais fundas em pontilhado e ondinhas curvas (claro em cima, escuro
    // por baixo), desencontradas para a repetição não se notar.
    img.fill(ox, 0, SIZE, SIZE, color('water'));
    const random = rng(7);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(random() * SIZE);
      const y = Math.floor(random() * SIZE);
      if ((x + y) % 2 === 0) img.set(ox + x, y, color('deep_water'));
    }
    for (const [x, y, w] of [
      [1, 3, 4],
      [9, 6, 5],
      [4, 11, 4],
      [12, 13, 3],
    ] as const) {
      img.fill(ox + x + 1, y, w - 2, 1, color('sky'));
      img.set(ox + x, y + 1, color('sky'));
      img.set(ox + x + w - 1, y + 1, color('sky'));
      img.fill(ox + x + 1, y + 1, w - 2, 1, color('deep_water'));
    }
    img.set(ox + 7, 1, color('ice'));
    img.set(ox + 14, 9, color('ice'));
  },
  road: (img, ox) => {
    // Alcatrão gasto: cinzento-escuro com grão, uma fenda e uma mancha mais clara.
    speckled(
      'stone_dark',
      [
        ['stone', 9],
        ['shadow', 12],
      ],
      4,
    )(img, ox);
    for (const [x, y] of [
      [3, 5],
      [4, 6],
      [5, 6],
      [6, 7],
      [7, 7],
      [8, 8],
    ] as const) {
      img.set(ox + x, y, color('shadow'));
      img.set(ox + x, y + 1, color('stone'));
    }
    img.fill(ox + 11, 11, 3, 2, color('stone'));
    img.set(ox + 11, 11, color('stone_light'));
  },
  floor_wood: (img, ox) => {
    // Soalho: tábuas de 4 px com luz em cima, sombra em baixo, veios e pregos; tons alternados.
    const tones = ['wood_light', 'wood', 'wood_light', 'wood'] as const;
    tones.forEach((tone, i) => {
      const y = i * 4;
      img.fill(ox, y, SIZE, 4, color(tone));
      img.fill(ox, y, SIZE, 1, color(tone === 'wood' ? 'wood_light' : 'sand'));
      img.fill(ox, y + 3, SIZE, 1, color('bark'));
    });
    for (const [x, y] of [
      [5, 0],
      [12, 4],
      [2, 8],
      [9, 12],
    ] as const) {
      img.fill(ox + x, y, 1, 3, color('bark')); // topos das tábuas
      img.set(ox + x + 1, y + 1, color('bark_dark')); // prego
    }
    for (const [x, y, w] of [
      [8, 1, 3],
      [1, 6, 4],
      [11, 9, 3],
      [3, 14, 4],
    ] as const) {
      img.fill(ox + x, y, w, 1, color('wood')); // veios
    }
  },
  floor_concrete: (img, ox) => {
    // Lajes de betão 8×8 com bisel (luz em cima-esquerda, junta escura) e grão.
    speckled(
      'stone_light',
      [
        ['stone', 8],
        ['parchment', 5],
      ],
      5,
    )(img, ox);
    for (const [x, y] of [
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ] as const) {
      img.fill(ox + x, y, 8, 1, color('parchment'));
      img.fill(ox + x, y, 1, 8, color('parchment'));
      img.fill(ox + x, y + 7, 8, 1, color('stone'));
      img.fill(ox + x + 7, y, 1, 8, color('stone'));
    }
    img.set(ox + 12, 3, color('stone_dark')); // fissura
    img.set(ox + 13, 4, color('stone_dark'));
    img.set(ox + 3, 12, color('stone_dark'));
  },
  wall: (img, ox) => {
    // Muro de tijolo (ruínas do mapa): cada tijolo com luz em cima, sombra em baixo e junta.
    for (let y = 0; y < SIZE; y++) {
      const row = Math.floor(y / 4);
      const offset = row % 2 === 0 ? 0 : 4;
      for (let x = 0; x < SIZE; x++) {
        const mortar = y % 4 === 3 || (x + offset) % 8 === 7;
        const shade = y % 4 === 0 ? 'stone_light' : y % 4 === 2 ? 'stone_dark' : 'stone';
        img.set(ox + x, y, color(mortar ? 'shadow' : shade));
      }
    }
    img.set(ox + 5, 1, color('parchment'));
    img.set(ox + 13, 9, color('parchment'));
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
    // Rochedo: forma irregular com 3 tons, contorno, fissura e musgo em cima.
    const rows: readonly [number, number][] = [
      [5, 6],
      [3, 10],
      [2, 12],
      [1, 14],
      [1, 14],
      [1, 14],
      [1, 14],
      [1, 14],
      [2, 13],
      [2, 12],
      [3, 10],
      [4, 8],
    ];
    for (const [i, [x, w]] of rows.entries()) {
      const y = i + 3;
      for (let xx = x; xx < x + w; xx++) {
        const t = (xx - x) / w + i / rows.length;
        img.set(ox + xx, y, color(t < 0.55 ? 'stone_light' : t < 1.1 ? 'stone' : 'stone_dark'));
      }
      img.set(ox + x, y, color('ink'));
      img.set(ox + x + w - 1, y, color('ink'));
    }
    img.fill(ox + 5, 2, 6, 1, color('ink'));
    img.fill(ox + 4, 15, 8, 1, color('ink'));
    for (const [x, y] of [
      [9, 6],
      [10, 7],
      [10, 8],
      [11, 9],
    ] as const) {
      img.set(ox + x, y, color('stone_dark'));
    }
    img.fill(ox + 5, 3, 4, 1, color('leaf')); // musgo
    img.set(ox + 4, 4, color('grass'));
    img.set(ox + 6, 4, color('grass'));
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

// Gera sprites de pixel art "placeholder melhorado" (recursos e obstáculos) em
// public/assets/sprites/, só com cores da paleta (+ sombra semitransparente). Substituem os
// retângulos com letra até haver arte final (Fase 12): para trocar, basta substituir o PNG.
// Uso: `npm run sprites` (com `-- --preview <ficheiro.png>` escreve também uma prancha ×6).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Bitmap, hexToRgb, type Rgb } from './png.ts';

const ROOT = new URL('../', import.meta.url);

const palette = JSON.parse(readFileSync(new URL('src/assets/palette.json', ROOT), 'utf8')) as Record<
  string,
  string
>;
function c(name: string): Rgb {
  const hex = palette[name];
  if (hex === undefined) throw new Error(`Cor fora da paleta: ${name}`);
  return hexToRgb(hex);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Sombra no chão (elipse escura semitransparente), desenhada antes do objeto. */
function shadow(img: Bitmap, cx: number, cy: number, rx: number, ry: number): void {
  img.ellipse(cx, cy, rx, ry, c('ink'), 80);
}

type Circle = readonly [cx: number, cy: number, r: number];

/** Copa/arbusto: círculos com sombra em baixo-direita, luz em cima-esquerda e contorno. */
function foliage(
  img: Bitmap,
  circles: readonly Circle[],
  seed: number,
  colors = ['forest_dark', 'forest', 'grass', 'leaf'],
) {
  const [dark = '', mid = '', base = '', light = ''] = colors;
  for (const [x, y, r] of circles) img.ellipse(x, y, r, r, c(dark));
  for (const [x, y, r] of circles) img.ellipse(x - 0.5, y - 1, r - 1, r - 1, c(mid));
  for (const [x, y, r] of circles) img.ellipse(x - 1, y - 1.5, r * 0.75, r * 0.7, c(base));
  for (const [x, y, r] of circles) img.ellipse(x - r * 0.35, y - r * 0.45, r * 0.35, r * 0.3, c(light));
  // Salpicos de folhas soltas (luz) para não ficar liso.
  const random = rng(seed);
  for (const [x, y, r] of circles) {
    for (let i = 0; i < r; i++) {
      const px = Math.round(x + (random() - 0.6) * r * 1.4);
      const py = Math.round(y + (random() - 0.7) * r * 1.2);
      if (img.alpha(px, py) === 255) img.set(px, py, c(light));
    }
  }
}

function trunk(img: Bitmap, x: number, y: number, w: number, h: number): void {
  img.fill(x, y, w, h, c('bark'));
  img.fill(x + w - 1, y, 1, h, c('bark_dark'));
  img.fill(x, y, 1, h, c('wood'));
  // Raízes a abrir na base.
  img.set(x - 1, y + h - 1, c('bark'));
  img.set(x + w, y + h - 1, c('bark_dark'));
}

/** Pedra: elipse com luz em cima e sombra em baixo. */
function stone(
  img: Bitmap,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  colors = ['stone_dark', 'stone', 'stone_light'],
) {
  const [dark = '', mid = '', light = ''] = colors;
  img.ellipse(cx, cy, rx, ry, c(dark));
  img.ellipse(cx - 0.5, cy - 0.8, rx - 1, ry - 1, c(mid));
  img.ellipse(cx - rx * 0.35, cy - ry * 0.45, rx * 0.35, ry * 0.3, c(light));
}

/** Garrafa (ícones de água); `water` = cor do conteúdo, null = vazia. */
function bottle(img: Bitmap, water: string | null): void {
  img.fill(6, 2, 4, 2, c('bark')); // rolha
  img.fill(6, 4, 4, 2, c('ice'));
  img.ellipse(8, 10, 4.5, 4.5, c('ice'));
  if (water) img.ellipse(8, 11, 3.5, 3, c(water));
  img.fill(6, 8, 1, 3, c('cream')); // reflexo
}

interface Sprite {
  file: string;
  width: number;
  height: number;
  paint: (img: Bitmap) => void;
  /** Cor do contorno exterior (omisso = sem contorno). */
  outline?: string;
}

const SPRITES: Sprite[] = [
  {
    file: 'tree_small',
    width: 16,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 29.5, 6, 2);
      trunk(img, 7, 20, 3, 10);
      foliage(
        img,
        [
          [8, 10, 6],
          [5, 14, 4],
          [11, 14, 4],
          [8, 16, 4],
        ],
        1,
      );
    },
  },
  {
    file: 'tree_large',
    width: 32,
    height: 48,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 16, 45, 11, 2.5);
      trunk(img, 13, 30, 6, 16);
      img.fill(15, 36, 1, 3, c('bark_dark')); // nó no tronco
      foliage(
        img,
        [
          [16, 13, 10],
          [8, 20, 7],
          [24, 20, 7],
          [12, 26, 6],
          [21, 26, 6],
          [16, 21, 7],
        ],
        2,
      );
    },
  },
  {
    file: 'rock',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 13.5, 7, 2);
      stone(img, 8, 9.5, 6.5, 5);
      // Faceta de cima mais clara, fissura e uma pedra mais pequena encostada.
      img.fill(5, 6, 5, 1, c('stone_light'));
      img.fill(4, 7, 4, 1, c('stone_light'));
      img.set(6, 5, c('parchment'));
      for (const [x, y] of [
        [9, 7],
        [10, 8],
        [10, 9],
        [11, 10],
      ] as const) {
        img.set(x, y, c('stone_dark'));
      }
      img.ellipse(12.5, 12, 2.2, 1.8, c('stone_dark'));
      img.ellipse(12.2, 11.6, 1.4, 1, c('stone'));
      img.set(4, 12, c('leaf')); // musgo em baixo
      img.set(5, 12, c('grass'));
    },
  },
  {
    file: 'iron_vein',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 13.5, 7, 2);
      stone(img, 8, 9.5, 6.5, 5, ['shadow', 'stone_dark', 'stone']);
      for (const [x, y] of [
        [5, 8],
        [6, 8],
        [9, 10],
        [10, 10],
        [10, 11],
        [7, 12],
      ] as const) {
        img.set(x, y, c('orange'));
      }
      img.set(6, 7, c('amber'));
      img.set(9, 9, c('amber'));
    },
  },
  {
    file: 'bush_berries',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 14, 7, 1.5);
      foliage(
        img,
        [
          [5, 10, 4],
          [11, 10, 4],
          [8, 8, 4.5],
        ],
        3,
        ['forest_dark', 'forest', 'grass', 'leaf'],
      );
      for (const [x, y] of [
        [4, 9],
        [7, 6],
        [10, 8],
        [12, 11],
        [6, 12],
        [9, 11],
      ] as const) {
        img.set(x, y, c('red'));
        img.set(x - 1, y - 1, c('rose'));
      }
    },
  },
  {
    file: 'tall_grass',
    width: 16,
    height: 16,
    paint: (img) => {
      // Tufos de erva: lâminas de 1 px, mais claras na ponta.
      const blades: readonly [x: number, top: number, lean: number][] = [
        [3, 6, -1],
        [5, 3, 0],
        [7, 5, 1],
        [8, 2, 0],
        [10, 4, 1],
        [12, 6, 1],
        [6, 8, -1],
        [11, 8, 0],
      ];
      for (const [x, top, lean] of blades) {
        for (let y = top; y < 15; y++) {
          const bend = y < top + 3 ? lean : 0;
          img.set(x + bend, y, c(y < top + 2 ? 'lime' : y > 12 ? 'forest' : 'leaf'));
        }
      }
    },
  },
  {
    file: 'log',
    width: 48,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 24, 13.5, 22, 2);
      img.fill(4, 5, 38, 8, c('bark'));
      img.fill(4, 5, 38, 2, c('wood'));
      img.fill(4, 11, 38, 2, c('bark_dark'));
      for (const x of [10, 19, 27, 34]) img.fill(x, 7, 3, 1, c('bark_dark')); // casca
      // Topo cortado com anéis, à direita.
      img.ellipse(42, 9, 3.5, 4.5, c('wood_light'));
      img.ellipse(42, 9, 2, 2.5, c('wood'));
      img.set(42, 9, c('bark'));
      // Galho partido.
      img.fill(15, 2, 2, 3, c('bark'));
    },
  },
  {
    file: 'stump',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 13.5, 7, 2);
      img.fill(3, 7, 10, 6, c('bark'));
      img.fill(12, 7, 1, 6, c('bark_dark'));
      img.ellipse(8, 7, 5, 2.5, c('wood_light'));
      img.ellipse(8, 7, 2.5, 1.2, c('wood'));
    },
  },
  {
    file: 'pebbles',
    width: 16,
    height: 8,
    paint: (img) => {
      stone(img, 4, 4, 3, 2);
      stone(img, 10, 5, 2.5, 1.8);
      stone(img, 13, 3, 1.5, 1.3);
    },
    outline: 'shadow',
  },
  {
    file: 'crate',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 14.5, 7, 1.5);
      img.fill(2, 3, 12, 11, c('wood'));
      img.fill(2, 3, 12, 1, c('wood_light'));
      img.fill(2, 8, 12, 1, c('bark'));
      img.fill(2, 13, 12, 1, c('bark'));
      // Travessa em diagonal.
      for (let i = 0; i < 10; i++) img.set(3 + i, 12 - Math.floor(i / 2.5), c('bark'));
      img.fill(2, 3, 1, 11, c('bark'));
      img.fill(13, 3, 1, 11, c('bark_dark'));
    },
  },
  {
    file: 'barrel',
    width: 16,
    height: 20,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 18, 6, 1.5);
      img.ellipse(8, 11, 5.5, 7, c('wood'));
      img.fill(4, 5, 8, 12, c('wood'));
      img.fill(11, 5, 1, 12, c('bark'));
      img.fill(5, 5, 1, 12, c('wood_light'));
      for (const y of [7, 13]) img.fill(3, y, 10, 1, c('stone_dark')); // aros
      img.ellipse(8, 4.5, 4, 1.5, c('bark'));
    },
  },
  {
    file: 'fence_broken',
    width: 32,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 16, 14, 14, 1.5);
      for (const x of [3, 27]) {
        img.fill(x, 3, 3, 11, c('bark'));
        img.fill(x + 2, 3, 1, 11, c('bark_dark'));
        img.fill(x, 3, 3, 1, c('wood_light'));
      }
      img.fill(6, 6, 21, 2, c('wood'));
      // Tábua de baixo partida, caída na diagonal.
      for (let i = 0; i < 14; i++) img.fill(6 + i, 10 + Math.floor(i / 5), 1, 2, c('wood'));
      img.fill(22, 10, 5, 2, c('wood'));
    },
  },
  {
    file: 'car_wreck',
    width: 48,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 24, 29, 22, 2.5);
      // Carroçaria (vista de cima/frente 3/4), ferrugem e pintura desbotada.
      img.fill(3, 12, 42, 14, c('teal'));
      img.fill(3, 12, 42, 2, c('sky'));
      img.fill(10, 4, 26, 9, c('teal'));
      img.fill(12, 5, 22, 7, c('deep_water')); // vidros
      img.fill(13, 5, 6, 2, c('ice'));
      img.fill(22, 8, 1, 4, c('teal'));
      img.fill(3, 22, 42, 4, c('stone_dark')); // para-choques / sombra
      for (const [x, y, w, h] of [
        [30, 15, 5, 3],
        [8, 18, 4, 2],
        [38, 12, 3, 4],
      ] as const) {
        img.fill(x, y, w, h, c('orange')); // ferrugem
        img.set(x, y, c('amber'));
      }
      // Rodas.
      for (const x of [9, 36]) {
        img.ellipse(x, 26, 4, 3, c('ink'));
        img.ellipse(x, 25.5, 1.5, 1.2, c('stone'));
      }
      img.fill(5, 16, 3, 2, c('wheat')); // farol
    },
  },
  {
    file: 'well',
    width: 32,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 16, 28, 14, 3);
      // Muro de pedra em anel com água escura.
      img.ellipse(16, 19, 13, 8, c('stone_dark'));
      img.ellipse(16, 18, 12, 7, c('stone'));
      img.ellipse(16, 17, 8.5, 4.5, c('shadow'));
      img.ellipse(16, 17.5, 7, 3.5, c('deep_water'));
      img.fill(13, 17, 4, 1, c('water'));
      for (const [x, y] of [
        [6, 20],
        [11, 23],
        [18, 24],
        [24, 22],
        [27, 18],
        [5, 16],
      ] as const) {
        img.fill(x, y, 3, 1, c('stone_dark')); // juntas
      }
      // Postes e trave com balde.
      img.fill(4, 2, 2, 16, c('bark'));
      img.fill(26, 2, 2, 16, c('bark'));
      img.fill(4, 2, 24, 2, c('wood'));
      img.fill(15, 4, 1, 6, c('stone_light'));
      img.fill(13, 10, 5, 4, c('wood_light'));
    },
  },

  {
    file: 'chest',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 14.5, 7, 1.5);
      img.fill(2, 4, 12, 10, c('wood'));
      img.fill(2, 4, 12, 4, c('wood_light')); // tampa
      img.fill(2, 8, 12, 1, c('bark_dark'));
      img.fill(2, 13, 12, 1, c('bark'));
      img.fill(2, 4, 1, 10, c('bark'));
      img.fill(13, 4, 1, 10, c('bark_dark'));
      img.fill(7, 7, 2, 3, c('gold')); // fecho
      img.set(7, 9, c('amber'));
    },
  },

  {
    file: 'campfire',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 13.5, 7, 2);
      // Pedras em anel, lenha cruzada e chama.
      for (const [x, y] of [
        [2, 11],
        [5, 13],
        [9, 13],
        [12, 11],
        [3, 9],
        [12, 9],
      ] as const) {
        img.ellipse(x + 1, y, 1.8, 1.4, c('stone'));
      }
      img.fill(4, 10, 8, 2, c('bark'));
      img.fill(6, 9, 4, 1, c('bark_dark'));
      img.ellipse(8, 7, 3, 4, c('orange'));
      img.ellipse(8, 8, 2, 2.5, c('amber'));
      img.ellipse(8, 9, 1, 1.5, c('gold'));
      img.set(8, 2, c('orange'));
      img.set(6, 4, c('amber'));
    },
  },
  {
    file: 'wood_bench',
    width: 32,
    height: 20,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 16, 18, 14, 1.5);
      img.fill(3, 4, 26, 5, c('wood_light')); // tampo
      img.fill(3, 4, 26, 1, c('wheat'));
      img.fill(3, 8, 26, 1, c('wood'));
      for (const x of [4, 26]) {
        img.fill(x, 9, 2, 9, c('bark'));
        img.fill(x + 1, 9, 1, 9, c('bark_dark'));
      }
      img.fill(6, 13, 20, 1, c('bark')); // travessa
      // Ferramentas e uma serra em cima.
      img.fill(8, 2, 6, 2, c('stone_light'));
      img.fill(12, 1, 1, 1, c('stone'));
      img.fill(19, 3, 5, 1, c('bark_dark'));
      img.fill(23, 2, 2, 2, c('red'));
    },
  },
  {
    // Poste de teletransporte (Etapa E): pilar de pedra com um cristal azul a brilhar em cima.
    file: 'waystone',
    width: 16,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 30.5, 6, 1.5);
      img.fill(4, 26, 8, 4, c('stone_dark'));
      img.fill(5, 12, 6, 15, c('stone'));
      img.fill(5, 12, 2, 15, c('stone_light'));
      img.fill(10, 12, 1, 15, c('stone_dark'));
      img.fill(6, 17, 4, 1, c('sky'));
      img.fill(6, 21, 4, 1, c('sky'));
      // Cristal.
      img.fill(7, 3, 2, 1, c('ice'));
      img.fill(6, 4, 4, 6, c('sky'));
      img.fill(7, 10, 2, 1, c('water'));
      img.fill(6, 4, 1, 5, c('ice'));
      img.fill(9, 5, 1, 5, c('water'));
      img.set(7, 5, c('cream'));
    },
  },
  {
    // Frigorífico (§7.17): alto, branco-creme, duas portas com puxadores e sombra no lado.
    file: 'fridge',
    width: 16,
    height: 30,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 28.5, 7, 1.5);
      img.fill(2, 2, 12, 26, c('parchment'));
      img.fill(2, 2, 12, 1, c('cream'));
      img.fill(2, 2, 1, 26, c('cream'));
      img.fill(12, 3, 2, 25, c('stone_light'));
      img.fill(2, 11, 12, 1, c('stone'));
      img.fill(2, 27, 12, 1, c('stone'));
      // Puxadores e um íman de fruta.
      img.fill(10, 5, 1, 4, c('stone_dark'));
      img.fill(10, 14, 1, 6, c('stone_dark'));
      img.fill(4, 15, 2, 2, c('red'));
      img.set(5, 14, c('leaf'));
      img.fill(4, 5, 3, 1, c('sky'));
    },
  },
  {
    // Banca de comércio: balcão com toldo às riscas e mercadoria em cima.
    file: 'market_stall',
    width: 32,
    height: 30,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 16, 28, 14, 1.5);
      for (const x of [3, 27]) {
        img.fill(x, 6, 2, 22, c('bark'));
        img.fill(x, 6, 1, 22, c('wood'));
      }
      // Toldo às riscas (vermelho e creme), com a aba recortada.
      for (let x = 1; x < 31; x++) {
        const stripe = Math.floor((x - 1) / 3) % 2 === 0 ? 'red' : 'cream';
        img.fill(x, 1, 1, 6, c(stripe));
        if (x % 3 !== 0) img.set(x, 7, c(stripe));
      }
      img.fill(1, 1, 30, 1, c('blood'));
      img.fill(1, 6, 30, 1, c('blood'));
      // Balcão.
      img.fill(3, 16, 26, 11, c('wood'));
      img.fill(3, 16, 26, 2, c('wood_light'));
      img.fill(3, 18, 26, 1, c('bark'));
      for (const x of [9, 16, 23]) img.fill(x, 19, 1, 8, c('bark'));
      // Mercadoria: frascos, uma saca de moedas e flechas.
      img.fill(6, 12, 3, 4, c('red'));
      img.fill(7, 11, 1, 1, c('bark'));
      img.fill(11, 12, 3, 4, c('teal'));
      img.fill(12, 11, 1, 1, c('bark'));
      img.ellipse(19, 14, 3, 2.5, c('wheat'));
      img.set(19, 11, c('bark'));
      img.set(18, 13, c('gold'));
      img.set(20, 14, c('gold'));
      img.fill(23, 10, 1, 6, c('wood_light'));
      img.fill(25, 10, 1, 6, c('wood_light'));
      img.set(23, 10, c('stone_light'));
      img.set(25, 10, c('stone_light'));
    },
  },
];

/**
 * Peças de construção (CLAUDE.md §7.7). Paredes, portas e janelas têm 16×32: o topo (16×16, a
 * espessura vista de cima) nas linhas 0–15 e a face da frente nas 16–31, para parecerem ter
 * altura (vista 3/4). Sem contorno exterior, para as peças encostadas formarem uma parede
 * contínua.
 */
const WALL_FRONT = 16;
const WALL_H = 32;

type WallMaterial = 'wood' | 'stone';

/** Topo da parede: toros de madeira vistos de cima, ou lajes de pedra, com luz em cima-esquerda. */
function wallTop(img: Bitmap, mat: WallMaterial, x0 = 0, x1 = 16): void {
  const w = x1 - x0;
  if (mat === 'wood') {
    img.fill(x0, 0, w, WALL_FRONT, c('wood'));
    // Veios e fendas desencontrados (a parede em fila não parece uma grelha).
    for (const [x, y, len] of [
      [1, 3, 6],
      [9, 3, 5],
      [4, 7, 7],
      [0, 11, 4],
      [8, 11, 7],
    ] as const) {
      for (let i = 0; i < len; i++) if (x + i >= x0 && x + i < x1) img.set(x + i, y, c('bark'));
    }
    for (const [x, y, len] of [
      [2, 1, 5],
      [10, 5, 4],
      [1, 9, 5],
      [9, 13, 4],
    ] as const) {
      for (let i = 0; i < len; i++) if (x + i >= x0 && x + i < x1) img.set(x + i, y, c('wood_light'));
    }
    img.fill(x0, 0, w, 1, c('wood_light'));
    img.fill(x0, WALL_FRONT - 1, w, 1, c('bark'));
  } else {
    img.fill(x0, 0, w, WALL_FRONT, c('stone'));
    // Lajes desencontradas: luz no canto de cima-esquerda, junta escura em baixo-direita.
    const slabs: readonly [number, number, number, number][] = [
      [0, 0, 7, 5],
      [7, 0, 9, 5],
      [0, 5, 4, 5],
      [4, 5, 8, 5],
      [12, 5, 4, 5],
      [0, 10, 9, 6],
      [9, 10, 7, 6],
    ];
    for (const [x, y, sw, sh] of slabs) {
      for (let yy = y; yy < y + sh; yy++)
        for (let xx = x; xx < x + sw; xx++) {
          if (xx < x0 || xx >= x1) continue;
          const joint = xx === x + sw - 1 || yy === y + sh - 1;
          const light = xx === x || yy === y;
          if (joint) img.set(xx, yy, c('stone_dark'));
          else if (light) img.set(xx, yy, c('stone_light'));
        }
    }
    img.fill(x0, 0, w, 1, c('stone_light'));
    img.fill(x0, WALL_FRONT - 1, w, 1, c('stone_dark'));
  }
}

/** Face da frente (linhas 16–31) entre as colunas x0 e x1: toros redondos ou tijolos. */
function wallFront(img: Bitmap, mat: WallMaterial, x0 = 0, x1 = 16): void {
  const w = x1 - x0;
  if (mat === 'wood') {
    // 4 toros de 4 px: luz em cima, madeira, sombra em baixo (parecem redondos); o de baixo
    // mais escuro (a parede escurece para o chão).
    const logs: readonly (readonly [string, string, string, string])[] = [
      ['wood_light', 'wood', 'wood', 'bark'],
      ['wood_light', 'wood', 'wood', 'bark'],
      ['wood', 'wood', 'bark', 'bark_dark'],
      ['wood', 'bark', 'bark', 'bark_dark'],
    ];
    logs.forEach((rows, i) => {
      rows.forEach((color, r) => {
        img.fill(x0, WALL_FRONT + i * 4 + r, w, 1, c(color));
      });
    });
    // Nós e fendas.
    for (const [x, y] of [
      [4, 18],
      [12, 22],
      [7, 26],
      [2, 29],
    ] as const) {
      if (x >= x0 && x < x1) img.set(x, y, c('bark_dark'));
    }
  } else {
    // Tijolos 8×4 desencontrados, cada um com luz em cima e sombra em baixo.
    for (let row = 0; row < 4; row++) {
      const y = WALL_FRONT + row * 4;
      const offset = row % 2 === 0 ? 0 : 4;
      const dark = row >= 2;
      for (let xx = x0; xx < x1; xx++) {
        const mortar = (xx + offset) % 8 === 7;
        img.set(xx, y, c(mortar ? 'shadow' : dark ? 'stone' : 'stone_light'));
        img.set(xx, y + 1, c(mortar ? 'shadow' : dark ? 'stone_dark' : 'stone'));
        img.set(xx, y + 2, c(mortar ? 'shadow' : dark ? 'stone_dark' : 'stone'));
        img.set(xx, y + 3, c('shadow'));
      }
    }
  }
  // Sombra por baixo do beiral (o topo da parede fica "por cima") e base escura.
  img.fill(x0, WALL_FRONT, w, 1, c(mat === 'wood' ? 'bark_dark' : 'shadow'));
  img.fill(x0, WALL_H - 1, w, 1, c('ink'));
}

/** Folha da porta (x 3–12, linhas 18–31): tábuas ao alto com travessas; a de pedra tem ferragens. */
function doorLeaf(img: Bitmap, mat: WallMaterial): void {
  const [edge, body, gap] = mat === 'wood' ? ['wood_light', 'wood', 'bark'] : ['wood', 'bark', 'bark_dark'];
  for (let x = 3; x <= 12; x++) {
    const col = (x - 3) % 3;
    img.fill(x, 18, 1, 14, c(col === 0 ? edge : col === 2 ? gap : body));
  }
  for (const y of [21, 28]) {
    img.fill(3, y, 10, 1, c(mat === 'wood' ? 'bark' : 'stone_dark'));
    img.fill(3, y - 1, 10, 1, c(mat === 'wood' ? 'wood_light' : 'stone'));
    if (mat === 'stone') for (const x of [4, 8, 11]) img.set(x, y, c('stone_light')); // rebites
  }
  img.set(3, 21, c('stone_dark')); // dobradiças
  img.set(3, 28, c('stone_dark'));
  img.set(11, 25, c('gold')); // puxador
  img.set(11, 26, c('amber'));
  img.fill(3, 18, 10, 1, c('ink')); // sombra da verga
}

/** Porta fechada na horizontal: parede de cada lado, ombreiras e verga, e a folha. */
function doorClosed(img: Bitmap, mat: WallMaterial): void {
  wallTop(img, mat);
  wallFront(img, mat);
  img.fill(2, 17, 12, 15, c(mat === 'wood' ? 'bark_dark' : 'shadow')); // moldura
  img.fill(2, 16, 12, 1, c(mat === 'wood' ? 'wood_light' : 'stone_light')); // verga
  doorLeaf(img, mat);
}

/** Porta aberta na horizontal: só as ombreiras e a verga; a folha encostada à esquerda. */
function doorOpen(img: Bitmap, mat: WallMaterial): void {
  wallTop(img, mat, 0, 3);
  wallTop(img, mat, 13, 16);
  wallFront(img, mat, 0, 3);
  wallFront(img, mat, 13, 16);
  // Verga por cima da passagem.
  img.fill(3, 12, 10, 4, c(mat === 'wood' ? 'wood' : 'stone'));
  img.fill(3, 12, 10, 1, c(mat === 'wood' ? 'wood_light' : 'stone_light'));
  img.fill(3, 15, 10, 2, c(mat === 'wood' ? 'bark_dark' : 'shadow'));
  // Sombra no chão da passagem, logo abaixo da verga.
  for (let x = 3; x < 13; x++) for (const y of [17, 18]) img.set(x, y, c('ink'), y === 17 ? 110 : 60);
  // A folha aberta, vista de lado, encostada à ombreira esquerda.
  const [light, dark] = mat === 'wood' ? ['wood_light', 'bark'] : ['wood', 'bark_dark'];
  img.fill(3, 17, 2, 15, c(light));
  img.fill(4, 17, 1, 15, c(dark));
  img.fill(3, WALL_H - 1, 2, 1, c('ink'));
}

/** Porta numa parede ao alto: vista de cima, a folha é uma tábua ao longo da parede. */
function doorVertical(img: Bitmap, mat: WallMaterial, open: boolean): void {
  wallTop(img, mat);
  wallFront(img, mat);
  const frame = mat === 'wood' ? 'bark_dark' : 'shadow';
  if (open) {
    // Passagem aberta (vê-se o chão) com as ombreiras em cima e em baixo.
    for (let y = 2; y < 30; y++) for (let x = 5; x < 11; x++) img.set(x, y, [0, 0, 0], 0);
    img.fill(4, 2, 1, 28, c(frame));
    img.fill(11, 2, 1, 28, c(frame));
    for (let y = 2; y < 30; y++) img.set(5, y, c('ink'), 70); // sombra da ombreira
    img.fill(5, 2, 6, 2, c(mat === 'wood' ? 'wood_light' : 'stone')); // folha aberta
    img.fill(5, 3, 6, 1, c(mat === 'wood' ? 'bark' : 'stone_dark'));
  } else {
    img.fill(4, 1, 8, WALL_FRONT - 2, c(frame));
    img.fill(5, 2, 6, WALL_FRONT - 4, c(mat === 'wood' ? 'wood_light' : 'wood'));
    for (const y of [5, 9]) img.fill(5, y, 6, 1, c(mat === 'wood' ? 'wood' : 'bark'));
    img.set(9, 7, c('gold'));
    // Na face da frente vê-se a espessura da porta (uma tira escura com a folha).
    img.fill(5, 17, 6, 15, c(frame));
    img.fill(6, 17, 4, 14, c(mat === 'wood' ? 'wood' : 'bark'));
    img.fill(6, 17, 1, 14, c(mat === 'wood' ? 'wood_light' : 'wood'));
  }
}

/** Janela na face da frente: moldura, vidro com reflexo, travessas e parapeito. */
function windowFront(img: Bitmap): void {
  img.fill(3, 18, 10, 9, c('bark_dark'));
  img.fill(4, 19, 8, 7, c('sky'));
  img.fill(4, 23, 8, 3, c('water')); // o vidro escurece em baixo
  img.set(5, 20, c('ice'));
  img.set(6, 20, c('ice'));
  img.set(5, 21, c('ice')); // reflexo
  img.fill(7, 19, 2, 7, c('bark')); // travessa ao alto
  img.fill(4, 22, 8, 1, c('bark')); // travessa deitada
  img.fill(2, 27, 12, 1, c('wood_light')); // parapeito
  img.fill(2, 28, 12, 1, c('bark_dark'));
}

const STRUCTURES: Sprite[] = [
  {
    file: 'foundation_wood',
    width: 16,
    height: 16,
    paint: (img) => {
      img.fill(0, 0, 16, 16, c('wood'));
      for (const y of [0, 4, 8, 12]) {
        img.fill(0, y, 16, 1, c('wood_light'));
        img.fill(0, y + 3, 16, 1, c('bark'));
      }
      for (const [x, y] of [
        [4, 1],
        [11, 5],
        [2, 9],
        [13, 13],
      ] as const) {
        img.fill(x, y, 1, 2, c('bark')); // topos das tábuas desencontrados
      }
      for (const [x, y] of [
        [1, 2],
        [14, 2],
        [1, 10],
        [14, 10],
      ] as const) {
        img.set(x, y, c('stone_light')); // pregos
      }
      img.fill(0, 15, 16, 1, c('bark_dark'));
      img.fill(15, 0, 1, 16, c('bark_dark'));
    },
  },
  {
    file: 'foundation_stone',
    width: 16,
    height: 16,
    paint: (img) => {
      img.fill(0, 0, 16, 16, c('stone'));
      img.fill(0, 7, 16, 1, c('stone_dark'));
      img.fill(0, 15, 16, 1, c('stone_dark'));
      img.fill(9, 0, 1, 7, c('stone_dark'));
      img.fill(4, 8, 1, 7, c('stone_dark'));
      img.fill(15, 8, 1, 8, c('stone_dark'));
      for (const [x, y, w] of [
        [1, 1, 3],
        [11, 1, 2],
        [6, 9, 4],
        [1, 9, 2],
      ] as const) {
        img.fill(x, y, w, 1, c('stone_light'));
      }
      img.set(12, 4, c('stone_dark'));
      img.set(8, 12, c('stone_dark'));
    },
  },
  {
    file: 'wall_wood',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      wallTop(img, 'wood');
      wallFront(img, 'wood');
    },
  },
  {
    file: 'wall_stone',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      wallTop(img, 'stone');
      wallFront(img, 'stone');
    },
  },
  {
    file: 'door_wood',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      doorClosed(img, 'wood');
    },
  },
  {
    file: 'door_wood_open',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      doorOpen(img, 'wood');
    },
  },
  {
    file: 'door_wood_v',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      doorVertical(img, 'wood', false);
    },
  },
  {
    file: 'door_wood_v_open',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      doorVertical(img, 'wood', true);
    },
  },
  {
    file: 'door_stone',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      doorClosed(img, 'stone');
    },
  },
  {
    file: 'door_stone_open',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      doorOpen(img, 'stone');
    },
  },
  {
    file: 'door_stone_v',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      doorVertical(img, 'stone', false);
    },
  },
  {
    file: 'door_stone_v_open',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      doorVertical(img, 'stone', true);
    },
  },
  {
    file: 'window_wood',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      wallTop(img, 'wood');
      wallFront(img, 'wood');
      windowFront(img);
    },
  },
  {
    file: 'window_wood_v',
    width: 16,
    height: WALL_H,
    paint: (img) => {
      wallTop(img, 'wood');
      wallFront(img, 'wood');
      // Vista de cima, a janela é uma faixa de vidro ao longo da parede.
      img.fill(6, 1, 4, 14, c('bark_dark'));
      img.fill(7, 2, 2, 12, c('sky'));
      img.fill(7, 2, 1, 5, c('ice'));
      img.fill(7, 8, 2, 1, c('bark'));
    },
  },
  {
    file: 'fence_wood',
    width: 16,
    height: 24,
    paint: (img) => {
      img.ellipse(8, 22.5, 7, 1.2, c('ink'), 60);
      for (const y of [12, 17]) {
        img.fill(0, y, 16, 2, c('wood'));
        img.fill(0, y, 16, 1, c('wood_light'));
      }
      for (const x of [2, 12]) {
        img.fill(x, 9, 3, 14, c('bark'));
        img.fill(x, 9, 1, 14, c('wood'));
        img.fill(x, 9, 3, 1, c('wood_light'));
      }
    },
  },
  {
    file: 'fence_wood_v',
    width: 16,
    height: 24,
    paint: (img) => {
      img.ellipse(8, 22.5, 3, 1.2, c('ink'), 60);
      img.fill(6, 4, 4, 16, c('wood'));
      img.fill(6, 4, 1, 16, c('wood_light'));
      img.fill(9, 4, 1, 16, c('bark'));
      for (const y of [1, 15]) {
        img.fill(6, y, 4, 8, c('bark'));
        img.fill(6, y, 1, 8, c('wood'));
        img.fill(6, y, 4, 1, c('wood_light'));
      }
    },
  },
];

/** Ícones de itens (16×16, sem sombra). */
const ICONS: Sprite[] = [
  {
    file: 'wood',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (const [y, x] of [
        [9, 2],
        [5, 5],
      ] as const) {
        img.fill(x, y, 9, 4, c('bark'));
        img.fill(x, y, 9, 1, c('wood'));
        img.ellipse(x + 9, y + 2, 1.8, 2.2, c('wood_light'));
        img.set(x + 9, y + 2, c('wood'));
      }
    },
  },
  {
    file: 'stone',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      stone(img, 6, 10, 4.5, 3.5);
      stone(img, 11, 7, 3.5, 3);
    },
  },
  {
    file: 'fiber',
    width: 16,
    height: 16,
    outline: 'forest_dark',
    paint: (img) => {
      for (let i = 0; i < 5; i++) {
        for (let y = 2; y < 14; y++) img.set(4 + i * 2 + (y < 7 ? 1 : 0), y, c(i % 2 ? 'lime' : 'leaf'));
      }
      img.fill(3, 9, 11, 2, c('wheat')); // atilho
    },
  },
  {
    file: 'berries',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (const [x, y] of [
        [5, 9],
        [9, 10],
        [7, 6],
        [11, 6],
      ] as const) {
        img.ellipse(x, y, 2.5, 2.5, c('red'));
        img.set(x - 1, y - 1, c('rose'));
      }
      img.fill(8, 2, 1, 3, c('forest'));
      img.fill(9, 2, 3, 1, c('leaf'));
    },
  },
  {
    file: 'water_clean',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      bottle(img, 'sky');
    },
  },
  {
    file: 'water_dirty',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      bottle(img, 'teal');
    },
  },
  {
    file: 'empty_bottle',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      bottle(img, null);
    },
  },
  {
    file: 'stone_axe',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 11; i++) img.set(3 + i, 13 - i, c('wood')); // cabo
      for (let i = 0; i < 10; i++) img.set(4 + i, 13 - i, c('bark'));
      stone(img, 11, 5, 3.5, 3);
    },
  },
  {
    file: 'stone_pickaxe',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 10; i++) img.fill(7 + (i > 6 ? 0 : 0), 4 + i, 2, 1, c(i % 3 ? 'wood' : 'bark'));
      for (let x = 2; x < 14; x++) img.set(x, 4 - Math.round(Math.abs(x - 8) / 3), c('stone'));
      for (let x = 3; x < 13; x++) img.set(x, 5 - Math.round(Math.abs(x - 8) / 3), c('stone_dark'));
    },
  },
  {
    file: 'raw_meat',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 8, 5.5, 4.5, c('red'));
      img.ellipse(7, 7, 3.5, 2.5, c('rose'));
      img.ellipse(11, 10, 1.5, 1.5, c('cream')); // osso
    },
  },
  {
    file: 'cooked_meat',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 8, 5.5, 4.5, c('bark'));
      img.ellipse(7, 7, 3.5, 2.5, c('wood'));
      img.ellipse(11, 10, 1.5, 1.5, c('cream'));
    },
  },
  {
    file: 'wood_plank',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (const y of [4, 8]) {
        img.fill(2, y, 12, 3, c('wood_light'));
        img.fill(2, y + 2, 12, 1, c('wood'));
        img.set(4, y + 1, c('bark'));
      }
    },
  },
  {
    file: 'rope',
    width: 16,
    height: 16,
    outline: 'bark_dark',
    paint: (img) => {
      img.ellipse(8, 8, 5.5, 4.5, c('wheat'));
      img.ellipse(8, 8, 3, 2, c('sand'));
      img.ellipse(8, 8, 1.5, 1, c('wheat'));
    },
  },
  {
    file: 'canned_food',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(4, 4, 8, 10, c('stone_light'));
      img.fill(4, 6, 8, 5, c('red'));
      img.fill(6, 7, 4, 3, c('wheat'));
      img.ellipse(8, 4, 4, 1.5, c('stone'));
    },
  },
  {
    file: 'iron_ore',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      stone(img, 8, 9, 5.5, 4.5, ['shadow', 'stone_dark', 'stone']);
      img.set(6, 8, c('orange'));
      img.set(9, 10, c('orange'));
      img.set(10, 7, c('amber'));
    },
  },
];

/**
 * Zombie (16×32, visto de frente), com a mesma proporção do jogador. `skin`/`shirt` mudam de
 * tipo para tipo; os braços esticados à frente distinguem-no de longe.
 */
function zombie(
  img: Bitmap,
  skin: string,
  skinDark: string,
  shirt: string,
  shirtDark: string,
  pants: string,
): void {
  shadow(img, 8, 30.5, 5.5, 1.5);
  // Pernas (uma mais à frente, a arrastar).
  img.fill(5, 22, 3, 8, c(pants));
  img.fill(9, 23, 3, 7, c(pants));
  img.fill(5, 29, 3, 1, c('ink'));
  img.fill(9, 29, 3, 1, c('ink'));
  // Tronco com a camisa rasgada.
  img.fill(4, 13, 9, 10, c(shirt));
  img.fill(4, 20, 9, 2, c(shirtDark));
  img.set(6, 21, c(skin));
  img.set(10, 17, c(skinDark));
  img.fill(12, 13, 1, 9, c(shirtDark));
  // Braços esticados para a frente.
  img.fill(2, 14, 2, 6, c(skin));
  img.fill(13, 14, 2, 6, c(skinDark));
  img.fill(2, 19, 2, 1, c(skinDark));
  // Cabeça inclinada, olhos vazios.
  img.fill(4, 4, 8, 9, c(skin));
  img.fill(4, 11, 8, 2, c(skinDark));
  img.fill(4, 3, 8, 2, c('bark_dark')); // cabelo ralo
  img.set(5, 5, c('bark_dark'));
  img.fill(5, 7, 2, 2, c('ink'));
  img.fill(9, 7, 2, 2, c('ink'));
  img.set(6, 7, c('red'));
  img.set(10, 7, c('red'));
  img.fill(6, 10, 4, 1, c('shadow')); // boca
}

const CREATURES: Sprite[] = [
  {
    file: 'zombie_walker',
    width: 16,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      zombie(img, 'lime', 'leaf', 'stone', 'stone_dark', 'teal');
    },
  },
  {
    file: 'zombie_runner',
    width: 16,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      zombie(img, 'peach', 'rose', 'red', 'blood', 'shadow');
    },
  },
  {
    file: 'deer',
    width: 24,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 12, 22.5, 9, 1.5);
      // Corpo de lado, a olhar para a direita.
      img.ellipse(11, 13, 7.5, 4, c('wood'));
      img.ellipse(10, 12, 6, 2.5, c('wood_light'));
      img.ellipse(9, 15, 5, 1.5, c('sand')); // barriga
      for (const x of [5, 8, 14, 17]) {
        img.fill(x, 16, 2, 6, c('wood'));
        img.set(x, 21, c('bark_dark'));
      }
      // Pescoço, cabeça e hastes.
      img.fill(16, 6, 3, 7, c('wood'));
      img.ellipse(19.5, 6, 3, 2.2, c('wood_light'));
      img.set(22, 6, c('ink'));
      img.set(19, 5, c('ink'));
      img.fill(17, 1, 1, 4, c('bark'));
      img.fill(20, 1, 1, 4, c('bark'));
      img.set(16, 1, c('bark'));
      img.set(21, 1, c('bark'));
      img.fill(3, 11, 2, 2, c('cream')); // cauda
    },
  },
  {
    file: 'wolf',
    width: 24,
    height: 20,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 12, 18.5, 9, 1.5);
      img.ellipse(11, 11, 7.5, 3.5, c('stone'));
      img.ellipse(10, 10, 6, 2, c('stone_light'));
      img.ellipse(10, 13, 5, 1.2, c('parchment'));
      for (const x of [5, 8, 14, 17]) {
        img.fill(x, 13, 2, 5, c('stone_dark'));
        img.set(x, 17, c('ink'));
      }
      // Cabeça com focinho e orelhas, a olhar para a direita.
      img.ellipse(19, 8, 3.5, 3, c('stone'));
      img.fill(21, 8, 3, 2, c('stone_light'));
      img.set(23, 8, c('ink'));
      img.set(19, 7, c('gold'));
      img.fill(17, 3, 2, 3, c('stone_dark'));
      img.fill(20, 3, 2, 3, c('stone_dark'));
      // Cauda.
      img.fill(1, 8, 3, 2, c('stone_dark'));
      img.set(0, 7, c('stone_dark'));
    },
  },
  {
    file: 'bag_dropped',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 14.5, 7, 1.5);
      img.ellipse(8, 9, 6, 5, c('teal'));
      img.ellipse(7, 8, 4, 3, c('sky'));
      img.fill(4, 10, 8, 3, c('teal'));
      img.fill(5, 4, 6, 2, c('bark')); // alça
      img.fill(6, 3, 4, 1, c('bark'));
      img.fill(7, 9, 2, 2, c('gold')); // fivela
    },
  },
];

const WEAPON_ICONS: Sprite[] = [
  {
    file: 'wooden_club',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 6; i++) img.fill(3 + i, 12 - i, 2, 2, c('bark'));
      img.ellipse(10.5, 5.5, 3.5, 3.5, c('wood'));
      img.ellipse(10, 5, 2, 2, c('wood_light'));
    },
  },
  {
    file: 'spiked_club',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 6; i++) img.fill(3 + i, 12 - i, 2, 2, c('bark'));
      img.ellipse(10.5, 5.5, 3.5, 3.5, c('wood'));
      img.ellipse(10, 5, 2, 2, c('wood_light'));
      for (const [x, y] of [
        [10, 1],
        [14, 4],
        [14, 7],
        [7, 3],
        [12, 9],
      ] as const) {
        img.set(x, y, c('stone_light'));
      }
    },
  },
  {
    file: 'machete',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(2, 11, 4, 2, c('bark')); // cabo
      img.set(2, 13, c('bark_dark'));
      for (let i = 0; i < 8; i++) {
        img.fill(5 + i, 10 - i, 2, 2, c('stone_light'));
        img.set(6 + i, 11 - i, c('stone'));
      }
      img.set(13, 2, c('cream'));
    },
  },
  {
    file: 'cloth_shirt',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(4, 4, 8, 10, c('parchment'));
      img.fill(1, 4, 3, 5, c('parchment'));
      img.fill(12, 4, 3, 5, c('parchment'));
      img.fill(6, 4, 4, 2, c('stone_light')); // gola
      img.fill(4, 12, 8, 2, c('stone_light'));
      img.set(8, 8, c('stone'));
      img.set(8, 10, c('stone'));
    },
  },
  {
    file: 'cloth_hat',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 11, 7, 2.5, c('sand'));
      img.ellipse(8, 8, 4.5, 4, c('parchment'));
      img.fill(4, 9, 8, 1, c('red')); // fita
    },
  },
  {
    file: 'cloth',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(3, 5, 10, 7, c('parchment'));
      img.fill(3, 9, 10, 3, c('stone_light'));
      img.set(5, 12, c('parchment'));
      img.set(9, 12, c('parchment'));
      img.fill(6, 6, 1, 3, c('stone_light'));
    },
  },
  {
    file: 'leather',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 8, 6, 4.5, c('wood'));
      img.ellipse(7, 7, 3.5, 2.5, c('wood_light'));
      img.set(3, 5, c('wood'));
      img.set(13, 11, c('wood'));
    },
  },
  {
    file: 'nails',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (const [x, y] of [
        [4, 3],
        [8, 5],
        [11, 2],
      ] as const) {
        img.fill(x - 1, y, 3, 1, c('stone_light'));
        img.fill(x, y + 1, 1, 8, c('stone'));
        img.set(x, y + 1, c('stone_light'));
      }
    },
  },
  {
    file: 'scrap_metal',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(2, 6, 7, 6, c('stone'));
      img.fill(7, 3, 7, 5, c('stone_dark'));
      img.fill(8, 4, 5, 1, c('stone_light'));
      img.set(4, 8, c('orange'));
      img.set(11, 6, c('orange'));
      img.fill(3, 11, 5, 1, c('stone_dark'));
    },
  },
];

/** Objetos das zonas da Fase 7 (argila, cais de pesca, armário). */
const ZONE_OBJECTS: Sprite[] = [
  {
    file: 'clay_pit',
    width: 16,
    height: 12,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 10.5, 7, 1.5);
      img.ellipse(8, 7, 7, 4, c('bark'));
      img.ellipse(7.5, 6, 5.5, 2.8, c('orange'));
      img.ellipse(6, 5, 2.5, 1.2, c('peach'));
      img.set(11, 7, c('bark_dark'));
      img.set(4, 8, c('bark_dark'));
    },
  },
  {
    file: 'dock',
    width: 32,
    height: 24,
    paint: (img) => {
      // Pontão de tábuas a entrar na água (vista de cima), com estacas.
      img.fill(8, 0, 16, 22, c('wood'));
      for (let y = 0; y < 22; y += 4) {
        img.fill(8, y, 16, 1, c('wood_light'));
        img.fill(8, y + 3, 16, 1, c('bark'));
      }
      img.fill(8, 0, 1, 22, c('bark_dark'));
      img.fill(23, 0, 1, 22, c('bark_dark'));
      for (const [x, y] of [
        [6, 2],
        [24, 2],
        [6, 18],
        [24, 18],
      ] as const) {
        img.fill(x, y, 2, 5, c('bark_dark'));
      }
      img.fill(8, 22, 16, 2, c('shadow'));
    },
  },
  {
    file: 'cabinet',
    width: 16,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 22.5, 7, 1.5);
      img.fill(2, 2, 12, 20, c('wood'));
      img.fill(2, 2, 12, 2, c('wood_light'));
      img.fill(3, 5, 10, 7, c('bark'));
      img.fill(3, 13, 10, 8, c('bark'));
      img.fill(4, 6, 8, 5, c('wood'));
      img.fill(4, 14, 8, 6, c('wood'));
      img.set(11, 8, c('gold'));
      img.set(11, 16, c('gold'));
      img.fill(13, 2, 1, 20, c('bark_dark'));
    },
  },
];

const FOOD_ICONS: Sprite[] = [
  {
    file: 'fish',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(7, 8, 5, 3, c('sky'));
      img.ellipse(6.5, 7, 3.5, 1.5, c('ice'));
      img.fill(12, 5, 2, 7, c('sky'));
      img.set(14, 5, c('sky'));
      img.set(14, 11, c('sky'));
      img.set(4, 7, c('ink'));
    },
  },
  {
    file: 'cooked_fish',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(7, 8, 5, 3, c('wood'));
      img.ellipse(6.5, 7, 3.5, 1.5, c('amber'));
      img.fill(12, 5, 2, 7, c('bark'));
      img.set(14, 5, c('bark'));
      img.set(14, 11, c('bark'));
      for (const x of [6, 8, 10]) img.set(x, 9, c('bark_dark'));
    },
  },
  {
    file: 'fishing_rod',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 12; i++) img.set(2 + i, 14 - i, c(i < 4 ? 'bark' : 'wood'));
      for (let y = 3; y < 12; y++) img.set(14, y, c('stone_light')); // linha
      img.set(14, 12, c('red'));
      img.fill(3, 11, 2, 2, c('stone')); // carreto
    },
  },
  {
    file: 'clay',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 9, 5.5, 4, c('orange'));
      img.ellipse(7, 8, 3, 2, c('peach'));
      img.set(10, 11, c('bark'));
    },
  },
  {
    file: 'bandage',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 8, 5, 5, c('cream'));
      img.ellipse(8, 8, 2, 2, c('parchment'));
      img.fill(7, 3, 2, 3, c('red'));
      img.fill(6, 4, 4, 1, c('red'));
    },
  },
];

/** Fase 8: tocha (luz à noite) e ícone das notas de receita. */
const PHASE8: Sprite[] = [
  {
    file: 'torch',
    width: 16,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 22.5, 3, 1);
      img.fill(7, 9, 2, 14, c('bark'));
      img.fill(7, 9, 1, 14, c('wood'));
      img.fill(6, 8, 4, 2, c('bark_dark'));
      img.ellipse(8, 5, 2.5, 3.5, c('orange'));
      img.ellipse(8, 6, 1.5, 2, c('amber'));
      img.set(8, 6, c('gold'));
      img.set(8, 1, c('orange'));
    },
  },
];

const NOTE_ICONS: Sprite[] = [
  {
    file: 'note',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(3, 2, 10, 12, c('parchment'));
      img.fill(3, 2, 10, 1, c('cream'));
      for (const y of [5, 7, 9]) img.fill(5, y, 6, 1, c('stone'));
      img.fill(5, 11, 3, 1, c('stone'));
      img.fill(10, 10, 2, 3, c('red')); // selo
    },
  },
];

/** Fase 8 (parte B): inchado, javali, fornalha e ferramentas de ferro. */
const PHASE8B: Sprite[] = [
  {
    file: 'zombie_bloated',
    width: 16,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 30.5, 7, 1.5);
      img.fill(4, 25, 3, 5, c('shadow'));
      img.fill(9, 25, 3, 5, c('shadow'));
      // Barriga inchada, esverdeada, com manchas.
      img.ellipse(8, 19, 7, 7, c('leaf'));
      img.ellipse(7, 18, 5, 5, c('lime'));
      for (const [x, y] of [
        [4, 17],
        [10, 21],
        [6, 23],
        [11, 15],
      ] as const) {
        img.fill(x, y, 2, 1, c('plum'));
      }
      img.fill(0, 16, 2, 5, c('leaf'));
      img.fill(14, 16, 2, 5, c('leaf'));
      // Cabeça pequena em cima.
      img.fill(5, 5, 6, 7, c('lime'));
      img.fill(5, 4, 6, 2, c('bark_dark'));
      img.fill(6, 7, 1, 2, c('ink'));
      img.fill(9, 7, 1, 2, c('ink'));
      img.fill(6, 10, 4, 1, c('plum'));
    },
  },
  {
    file: 'boar',
    width: 24,
    height: 20,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 12, 18.5, 9, 1.5);
      img.ellipse(11, 11, 8, 5, c('bark'));
      img.ellipse(10, 9.5, 6.5, 3, c('wood'));
      for (let x = 5; x < 17; x += 2) img.set(x, 6, c('bark_dark')); // crina
      for (const x of [5, 8, 13, 16]) {
        img.fill(x, 14, 2, 4, c('bark_dark'));
      }
      // Cabeça com focinho e presas, a olhar para a direita.
      img.ellipse(19, 11, 4, 3.5, c('bark'));
      img.fill(21, 11, 3, 3, c('rose'));
      img.set(23, 12, c('ink'));
      img.set(20, 14, c('cream'));
      img.set(22, 14, c('cream'));
      img.set(19, 9, c('ink'));
      img.fill(17, 6, 2, 3, c('bark_dark'));
      img.set(1, 9, c('bark_dark'));
    },
  },
  {
    file: 'furnace',
    width: 16,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 22.5, 7, 1.5);
      img.fill(2, 6, 12, 16, c('stone'));
      img.fill(2, 6, 12, 2, c('stone_light'));
      for (const [x, y] of [
        [2, 11],
        [8, 11],
        [5, 16],
        [11, 16],
      ] as const) {
        img.fill(x, y, 4, 1, c('stone_dark'));
      }
      img.fill(5, 15, 6, 6, c('ink')); // boca
      img.fill(6, 17, 4, 4, c('orange'));
      img.fill(7, 18, 2, 3, c('gold'));
      img.fill(6, 1, 4, 5, c('stone_dark')); // chaminé
      img.fill(6, 1, 4, 1, c('stone'));
    },
  },
];

const IRON_ICONS: Sprite[] = [
  {
    file: 'iron_ingot',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(2, 7, 12, 5, c('stone'));
      img.fill(4, 5, 10, 3, c('stone_light'));
      img.fill(4, 5, 10, 1, c('cream'));
      img.fill(2, 11, 12, 1, c('stone_dark'));
    },
  },
  {
    file: 'iron_axe',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 11; i++) img.set(3 + i, 13 - i, c('wood'));
      for (let i = 0; i < 10; i++) img.set(4 + i, 13 - i, c('bark'));
      img.fill(9, 2, 5, 6, c('stone_light'));
      img.fill(9, 2, 5, 1, c('cream'));
      img.fill(13, 3, 1, 4, c('stone'));
    },
  },
  {
    file: 'iron_pickaxe',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 10; i++) img.fill(7, 4 + i, 2, 1, c(i % 3 ? 'wood' : 'bark'));
      for (let x = 2; x < 14; x++) img.set(x, 4 - Math.round(Math.abs(x - 8) / 3), c('stone_light'));
      for (let x = 3; x < 13; x++) img.set(x, 5 - Math.round(Math.abs(x - 8) / 3), c('stone'));
    },
  },
];

/** Canteiro da horta (terra seca ou regada, com moldura de madeira). */
function gardenBed(img: Bitmap, wet: boolean): void {
  img.fill(1, 3, 14, 12, c('bark_dark'));
  img.fill(2, 4, 12, 10, c(wet ? 'bark_dark' : 'bark'));
  const random = rng(wet ? 91 : 90);
  for (let i = 0; i < 18; i++) {
    const x = 2 + Math.floor(random() * 12);
    const y = 4 + Math.floor(random() * 10);
    img.set(x, y, c(wet ? 'shadow' : 'wood'));
  }
  // Moldura: tábuas com luz em cima.
  img.fill(1, 2, 14, 2, c('wood_light'));
  img.fill(1, 3, 14, 1, c('wood'));
  img.fill(1, 14, 14, 1, c('wood'));
  img.fill(1, 2, 1, 13, c('wood'));
  img.fill(14, 2, 1, 13, c('bark'));
}

/** Coletor de água da chuva: barril com funil de pano. */
function rainCollector(img: Bitmap, full: boolean): void {
  shadow(img, 8, 22.5, 6, 1.5);
  img.fill(3, 9, 10, 13, c('wood'));
  img.fill(3, 9, 2, 13, c('wood_light'));
  img.fill(11, 9, 2, 13, c('bark'));
  img.fill(3, 12, 10, 1, c('stone_dark'));
  img.fill(3, 18, 10, 1, c('stone_dark'));
  // Funil de pano esticado em quatro paus.
  img.fill(1, 3, 1, 7, c('bark'));
  img.fill(14, 3, 1, 7, c('bark'));
  img.fill(1, 4, 14, 2, c('parchment'));
  img.fill(3, 6, 10, 2, c('cream'));
  img.fill(5, 8, 6, 1, c('parchment'));
  if (full) {
    img.fill(4, 9, 8, 1, c('sky'));
    img.fill(5, 9, 3, 1, c('ice'));
  }
}

/** Armadilha de caça: laço preso a um pau dobrado; `full` = apanhou alguma coisa. */
function snare(img: Bitmap, full: boolean): void {
  shadow(img, 8, 14.5, 5, 1);
  for (let i = 0; i < 9; i++) img.set(3 + Math.round(i * 0.4), 14 - i, c('bark'));
  for (let i = 0; i < 7; i++) img.set(6 + i, 6 + Math.round((i * i) / 12), c('wood'));
  img.ellipse(11, 12, 2.5, 1.5, c('parchment'));
  img.ellipse(11, 12, 1.5, 0.6, c('bark'));
  img.fill(2, 14, 4, 1, c('stone_dark'));
  if (full) {
    img.ellipse(11, 11.5, 3.5, 2.5, c('wood_light'));
    img.ellipse(10, 11, 2, 1.5, c('sand'));
    img.set(13, 10, c('ink'));
    img.fill(14, 9, 1, 2, c('wood_light'));
  }
}

/** Fase 9: horta, coletor de água, armadilha de caça e saco de sementes (na Quinta). */
const PHASE9: Sprite[] = [
  {
    file: 'garden_bed',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      gardenBed(img, false);
    },
  },
  {
    file: 'garden_bed_wet',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      gardenBed(img, true);
    },
  },
  {
    file: 'crop_sprout',
    width: 16,
    height: 16,
    outline: 'forest_dark',
    paint: (img) => {
      for (const x of [5, 10]) {
        img.fill(x, 9, 1, 3, c('forest'));
        img.set(x - 1, 8, c('leaf'));
        img.set(x + 1, 8, c('lime'));
      }
    },
  },
  {
    file: 'crop_carrot',
    width: 16,
    height: 16,
    outline: 'forest_dark',
    paint: (img) => {
      for (const x of [4, 8, 12]) {
        img.fill(x - 1, 10, 3, 2, c('orange'));
        img.set(x, 10, c('amber'));
        img.fill(x, 5, 1, 5, c('forest'));
        img.set(x - 1, 5, c('leaf'));
        img.set(x + 1, 6, c('leaf'));
        img.set(x - 1, 7, c('grass'));
        img.set(x + 1, 4, c('lime'));
      }
    },
  },
  {
    file: 'crop_tomato',
    width: 16,
    height: 24,
    outline: 'forest_dark',
    paint: (img) => {
      img.fill(8, 3, 1, 17, c('wood'));
      foliage(
        img,
        [
          [6, 10, 3],
          [10, 8, 3],
          [7, 15, 3],
          [10, 14, 3],
        ],
        12,
      );
      for (const [x, y] of [
        [5, 11],
        [11, 9],
        [9, 15],
        [6, 16],
      ] as const) {
        img.ellipse(x, y, 1.5, 1.5, c('red'));
        img.set(x - 1, y - 1, c('peach'));
      }
    },
  },
  {
    file: 'rain_collector',
    width: 16,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      rainCollector(img, false);
    },
  },
  {
    file: 'rain_collector_full',
    width: 16,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      rainCollector(img, true);
    },
  },
  {
    file: 'snare',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      snare(img, false);
    },
  },
  {
    file: 'snare_full',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      snare(img, true);
    },
  },
  {
    file: 'spike_trap',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(1, 6, 14, 8, c('bark'));
      img.fill(1, 6, 14, 1, c('wood'));
      img.fill(1, 10, 14, 1, c('bark_dark'));
      for (const [x, y] of [
        [3, 8],
        [7, 8],
        [11, 8],
        [5, 12],
        [9, 12],
        [13, 12],
      ] as const) {
        img.fill(x, y - 4, 1, 4, c('stone_light'));
        img.set(x, y - 5, c('cream'));
        img.set(x + 1, y - 1, c('stone_dark'));
      }
    },
  },
  {
    file: 'seed_sack',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 14.5, 6, 1.5);
      img.ellipse(8, 10, 5.5, 4.5, c('sand'));
      img.ellipse(7, 9, 3, 2.5, c('wheat'));
      img.fill(6, 3, 4, 3, c('sand'));
      img.fill(5, 5, 6, 1, c('bark'));
      img.set(8, 2, c('wheat'));
      img.fill(10, 11, 2, 2, c('wood'));
    },
  },
];

/** Pacote de sementes com o desenho do fruto. */
function seedPacket(img: Bitmap, fruit: string): void {
  img.fill(3, 2, 10, 12, c('parchment'));
  img.fill(3, 2, 10, 2, c('wood_light'));
  img.fill(12, 4, 1, 10, c('sand'));
  img.ellipse(8, 9, 2.5, 2.5, c(fruit));
  img.set(7, 8, c('cream'));
  img.fill(8, 5, 1, 2, c('forest'));
}

const PHASE9_ICONS: Sprite[] = [
  {
    file: 'carrot_seeds',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      seedPacket(img, 'orange');
    },
  },
  {
    file: 'tomato_seeds',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      seedPacket(img, 'red');
    },
  },
  {
    file: 'carrot',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 9; i++) img.fill(4 + i, 12 - i, Math.max(1, 3 - Math.floor(i / 4)), 2, c('orange'));
      for (let i = 0; i < 6; i++) img.set(5 + i, 12 - i, c('amber'));
      img.fill(12, 2, 1, 3, c('leaf'));
      img.fill(13, 3, 2, 1, c('grass'));
      img.set(11, 2, c('lime'));
    },
  },
  {
    file: 'tomato',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 9, 5, 4.5, c('red'));
      img.ellipse(6.5, 7.5, 1.5, 1.2, c('peach'));
      img.fill(7, 4, 3, 1, c('grass'));
      img.set(8, 3, c('forest'));
    },
  },
];

/** Fase 10 (parte A): brutamontes, gritador, contentores da Zona Industrial e do Hospital. */
const PHASE10A: Sprite[] = [
  {
    file: 'zombie_tank',
    width: 24,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 12, 30.5, 9, 1.5);
      // Pernas grossas.
      img.fill(6, 23, 5, 7, c('night'));
      img.fill(13, 23, 5, 7, c('night'));
      img.fill(6, 29, 5, 1, c('ink'));
      img.fill(13, 29, 5, 1, c('ink'));
      // Tronco enorme com fato-macaco rasgado.
      img.fill(4, 11, 16, 13, c('plum'));
      img.fill(4, 20, 16, 3, c('shadow'));
      img.fill(18, 11, 2, 12, c('shadow'));
      img.fill(9, 14, 3, 4, c('stone'));
      // Braços pesados, punhos grandes.
      img.fill(0, 12, 4, 9, c('stone'));
      img.fill(20, 12, 4, 9, c('stone_dark'));
      img.fill(0, 20, 4, 3, c('stone_light'));
      img.fill(20, 20, 4, 3, c('stone'));
      // Cabeça pequena e careca, afundada nos ombros.
      img.fill(8, 3, 8, 9, c('stone_light'));
      img.fill(8, 10, 8, 2, c('stone'));
      img.fill(9, 6, 2, 2, c('ink'));
      img.fill(13, 6, 2, 2, c('ink'));
      img.set(10, 6, c('red'));
      img.set(14, 6, c('red'));
      img.fill(10, 9, 4, 1, c('blood'));
    },
  },
  {
    file: 'zombie_screamer',
    width: 16,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      zombie(img, 'ice', 'sky', 'plum', 'night', 'shadow');
      // Boca muito aberta (grita) e cabelo comprido.
      img.fill(6, 9, 4, 3, c('ink'));
      img.fill(7, 10, 2, 1, c('blood'));
      img.fill(3, 3, 2, 10, c('bark_dark'));
      img.fill(11, 3, 2, 10, c('bark_dark'));
    },
  },
  {
    file: 'locker',
    width: 16,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 22.5, 7, 1.5);
      img.fill(2, 2, 12, 20, c('teal'));
      img.fill(2, 2, 12, 2, c('sky'));
      img.fill(7, 4, 1, 17, c('forest_dark'));
      for (const y of [6, 8, 10]) {
        img.fill(3, y, 3, 1, c('forest_dark'));
        img.fill(9, y, 3, 1, c('forest_dark'));
      }
      img.set(6, 14, c('stone_light'));
      img.set(9, 14, c('stone_light'));
      img.fill(13, 2, 1, 20, c('forest_dark'));
    },
  },
  {
    file: 'medical_cabinet',
    width: 16,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 22.5, 7, 1.5);
      img.fill(2, 2, 12, 20, c('cream'));
      img.fill(2, 2, 12, 2, c('parchment'));
      img.fill(3, 12, 10, 1, c('stone_light'));
      img.fill(7, 5, 2, 6, c('red'));
      img.fill(5, 7, 6, 2, c('red'));
      img.fill(3, 14, 10, 7, c('parchment'));
      img.set(11, 17, c('stone'));
      img.fill(13, 2, 1, 20, c('stone_light'));
    },
  },
];

const PHASE10A_ICONS: Sprite[] = [
  {
    file: 'electronics',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(2, 4, 12, 8, c('forest'));
      img.fill(2, 4, 12, 1, c('grass'));
      img.fill(4, 6, 3, 3, c('ink'));
      img.fill(9, 7, 3, 2, c('stone_light'));
      for (const x of [3, 6, 9, 12]) img.set(x, 11, c('gold'));
      img.fill(7, 10, 5, 1, c('gold'));
    },
  },
  {
    file: 'chemicals',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(7, 2, 2, 4, c('ice'));
      img.ellipse(8, 10, 5, 4.5, c('ice'));
      img.ellipse(8, 11, 4, 3, c('lime'));
      img.set(6, 10, c('cream'));
      img.fill(6, 1, 4, 1, c('stone'));
    },
  },
  {
    // Moeda: disco dourado com brilho e o bordo mais escuro.
    file: 'coin',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 8.5, 5, 5, c('orange'));
      img.ellipse(7.6, 8, 4.2, 4.2, c('gold'));
      img.ellipse(7.5, 8, 2.5, 2.8, c('amber'));
      img.fill(7, 6, 1, 4, c('gold'));
      img.set(5, 5, c('cream'));
      img.set(6, 5, c('cream'));
      img.set(5, 6, c('cream'));
    },
  },
  {
    // Poção de vida: frasco redondo, líquido vermelho, rolha.
    file: 'health_potion',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(7, 2, 2, 2, c('bark'));
      img.fill(7, 4, 2, 2, c('ice'));
      img.ellipse(8, 10, 4.5, 4.5, c('ice'));
      img.ellipse(8, 10.5, 3.6, 3.4, c('red'));
      img.ellipse(8, 11.5, 3, 2.2, c('blood'));
      img.set(6, 8, c('cream'));
      img.set(6, 9, c('rose'));
    },
  },
  {
    // Poção grande: frasco maior e mais alto, com um laço dourado.
    file: 'big_health_potion',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(6, 1, 4, 2, c('bark'));
      img.fill(6, 3, 4, 2, c('ice'));
      img.fill(5, 5, 6, 1, c('gold'));
      img.ellipse(8, 10.5, 5.5, 5, c('ice'));
      img.ellipse(8, 11, 4.6, 4, c('red'));
      img.ellipse(8, 12, 3.8, 2.6, c('blood'));
      img.set(5, 9, c('cream'));
      img.set(5, 10, c('rose'));
    },
  },
  {
    // Pizza: fatia triangular com queijo, tomate e borda de massa.
    file: 'pizza',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let y = 3; y < 14; y++) {
        const half = Math.round((y - 3) * 0.55);
        img.fill(8 - half, y, half * 2 + 1, 1, c('gold'));
      }
      img.fill(2, 13, 13, 2, c('wood_light'));
      img.fill(2, 14, 13, 1, c('wood'));
      img.fill(8, 6, 2, 2, c('red'));
      img.fill(6, 10, 2, 2, c('red'));
      img.fill(10, 11, 2, 2, c('red'));
      img.set(8, 9, c('forest'));
    },
  },
  {
    // Hambúrguer: pão com sésamo, carne, alface e queijo.
    file: 'burger',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 6, 6, 3.5, c('wood_light'));
      img.fill(2, 6, 13, 2, c('wood_light'));
      img.set(6, 4, c('cream'));
      img.set(9, 5, c('cream'));
      img.set(11, 4, c('cream'));
      img.fill(2, 8, 13, 1, c('leaf'));
      img.fill(2, 9, 13, 1, c('gold'));
      img.fill(2, 10, 13, 2, c('bark'));
      img.fill(2, 12, 13, 2, c('wood'));
    },
  },
  {
    // Frango assado: coxa dourada com osso.
    file: 'roast_chicken',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(7, 9, 5, 4.5, c('orange'));
      img.ellipse(6.5, 8.5, 3.5, 3, c('amber'));
      img.set(5, 7, c('gold'));
      img.fill(11, 4, 2, 4, c('cream'));
      img.fill(12, 3, 2, 2, c('parchment'));
    },
  },
  {
    // Bifana: pão com carne a sair dos lados.
    file: 'bifana',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(2, 5, 12, 3, c('wood_light'));
      img.fill(3, 4, 10, 1, c('wood_light'));
      img.fill(1, 8, 14, 2, c('bark'));
      img.fill(1, 8, 2, 1, c('peach'));
      img.fill(2, 10, 12, 3, c('wood'));
      img.set(5, 5, c('cream'));
      img.set(9, 6, c('cream'));
    },
  },
  {
    // Sopa: tigela com caldo verde e vapor.
    file: 'soup',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(2, 8, 12, 1, c('grass'));
      img.ellipse(8, 10, 6, 4, c('stone_light'));
      img.fill(2, 8, 12, 2, c('grass'));
      img.fill(3, 8, 3, 1, c('lime'));
      img.fill(4, 12, 8, 1, c('stone'));
      img.set(6, 5, c('parchment'));
      img.set(9, 4, c('parchment'));
      img.set(7, 3, c('parchment'));
    },
  },
  {
    // Café: chávena com pires.
    file: 'coffee',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(3, 6, 8, 7, c('cream'));
      img.fill(3, 6, 8, 2, c('bark_dark'));
      img.fill(11, 8, 2, 3, c('cream'));
      img.fill(1, 13, 13, 1, c('stone_light'));
      img.set(6, 3, c('parchment'));
      img.set(8, 4, c('parchment'));
    },
  },
  {
    // Batido de fruta: copo alto cor-de-rosa com palhinha.
    file: 'smoothie',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(5, 5, 6, 9, c('rose'));
      img.fill(5, 5, 6, 1, c('peach'));
      img.fill(5, 5, 1, 9, c('ice'));
      img.fill(9, 1, 1, 5, c('red'));
      img.fill(10, 1, 2, 1, c('red'));
      img.set(7, 8, c('plum'));
    },
  },
  {
    // Limonada: copo com limão e gelo.
    file: 'lemonade',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(4, 5, 8, 9, c('gold'));
      img.fill(4, 5, 8, 1, c('cream'));
      img.fill(5, 7, 2, 2, c('ice'));
      img.fill(8, 10, 2, 2, c('ice'));
      img.ellipse(11.5, 5, 2, 2, c('lime'));
    },
  },
  {
    // Bebida energética: lata verde com risca e anilha.
    file: 'energy_drink',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(5, 3, 6, 11, c('lime'));
      img.fill(5, 3, 6, 1, c('stone_light'));
      img.fill(5, 13, 6, 1, c('stone'));
      img.fill(5, 7, 6, 3, c('forest_dark'));
      img.fill(7, 8, 2, 1, c('gold'));
      img.fill(5, 4, 1, 9, c('leaf'));
      img.set(8, 2, c('stone_light'));
    },
  },
  {
    file: 'medkit',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(2, 4, 12, 10, c('cream'));
      img.fill(2, 4, 12, 1, c('parchment'));
      img.fill(6, 2, 4, 2, c('stone'));
      img.fill(7, 6, 2, 6, c('red'));
      img.fill(5, 8, 6, 2, c('red'));
    },
  },
  {
    file: 'leather_jacket',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(4, 4, 8, 10, c('bark'));
      img.fill(1, 4, 3, 7, c('bark'));
      img.fill(12, 4, 3, 7, c('bark_dark'));
      img.fill(6, 4, 4, 2, c('wood')); // gola
      img.fill(8, 6, 1, 8, c('bark_dark'));
      img.set(7, 8, c('stone_light'));
      img.set(7, 11, c('stone_light'));
    },
  },
  {
    file: 'leather_pants',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(4, 2, 8, 3, c('bark'));
      img.fill(4, 5, 3, 9, c('bark'));
      img.fill(9, 5, 3, 9, c('bark_dark'));
      img.fill(4, 2, 8, 1, c('wood'));
      img.set(8, 3, c('gold'));
    },
  },
];

/** Fase 10 (parte B): bancada de trabalho e armas à distância. */
const PHASE10B: Sprite[] = [
  {
    file: 'workbench',
    width: 32,
    height: 20,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 16, 18, 14, 1.5);
      img.fill(3, 4, 26, 5, c('stone'));
      img.fill(3, 4, 26, 1, c('stone_light'));
      img.fill(3, 8, 26, 1, c('stone_dark'));
      for (const x of [4, 26]) {
        img.fill(x, 9, 2, 9, c('stone_dark'));
        img.fill(x + 1, 9, 1, 9, c('shadow'));
      }
      img.fill(6, 13, 20, 1, c('stone_dark'));
      // Torno de bancada e ferramentas.
      img.fill(7, 1, 5, 3, c('teal'));
      img.fill(8, 0, 3, 1, c('stone_light'));
      img.fill(16, 3, 6, 1, c('bark_dark'));
      img.fill(20, 2, 2, 1, c('stone_light'));
      img.fill(24, 2, 3, 2, c('gold'));
    },
  },
];

const PHASE10B_ICONS: Sprite[] = [
  {
    file: 'crossbow',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 11; i++) img.set(3 + i, 13 - i, c('wood'));
      for (let i = 0; i < 10; i++) img.set(3 + i, 12 - i, c('bark'));
      // Arco atravessado.
      for (let i = 0; i < 9; i++) img.set(4 + i, 3 + i, c('stone_light'));
      img.set(3, 2, c('stone'));
      img.set(13, 12, c('stone'));
      img.fill(7, 9, 2, 2, c('bark_dark'));
    },
  },
  {
    file: 'pistol',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(2, 5, 12, 3, c('stone_dark'));
      img.fill(2, 5, 12, 1, c('stone'));
      img.fill(4, 8, 4, 5, c('bark'));
      img.fill(4, 8, 1, 5, c('wood'));
      img.set(9, 8, c('stone_dark'));
      img.set(9, 9, c('stone_dark'));
      img.set(13, 4, c('stone'));
    },
  },
  {
    file: 'bolt',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (const o of [0, 4]) {
        for (let i = 0; i < 9; i++) img.set(3 + i + o, 12 - i, c('wood_light'));
        img.fill(11 + o, 2, 2, 2, c('stone_light'));
        img.set(3 + o, 12, c('red'));
      }
    },
  },
  {
    file: 'pistol_ammo',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (const x of [3, 7, 11]) {
        img.fill(x, 6, 3, 7, c('gold'));
        img.fill(x, 4, 3, 2, c('orange'));
        img.set(x, 7, c('wheat'));
      }
    },
  },
  {
    file: 'gunpowder',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 10, 5.5, 4, c('shadow'));
      img.ellipse(7, 9, 3, 2, c('stone_dark'));
      img.fill(6, 3, 4, 4, c('sand'));
      img.fill(5, 6, 6, 1, c('bark'));
    },
  },
];

/** Fase 10 (parte C): guarda do bunker, cofre, caixa militar e chaves. */
const PHASE10C: Sprite[] = [
  {
    file: 'boss_warden',
    width: 32,
    height: 40,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 16, 38, 12, 2);
      // Botas e pernas com calças militares.
      img.fill(9, 28, 6, 9, c('forest'));
      img.fill(17, 28, 6, 9, c('forest_dark'));
      img.fill(8, 36, 7, 2, c('ink'));
      img.fill(17, 36, 7, 2, c('ink'));
      // Colete à prova de bala sobre o tronco largo.
      img.fill(6, 13, 20, 16, c('forest'));
      img.fill(8, 14, 16, 12, c('forest_dark'));
      img.fill(10, 16, 4, 3, c('stone'));
      img.fill(18, 16, 4, 3, c('stone'));
      img.fill(8, 24, 16, 2, c('bark_dark')); // cinto
      img.set(15, 24, c('gold'));
      // Braços enormes, pele cinzenta, com ligaduras.
      img.fill(1, 14, 5, 12, c('stone_light'));
      img.fill(26, 14, 5, 12, c('stone'));
      img.fill(1, 18, 5, 2, c('cream'));
      img.fill(0, 24, 6, 4, c('stone'));
      img.fill(26, 24, 6, 4, c('stone_dark'));
      // Capacete e cara.
      img.fill(10, 4, 12, 10, c('stone_light'));
      img.fill(9, 2, 14, 4, c('forest_dark'));
      img.fill(8, 5, 16, 1, c('forest'));
      img.fill(12, 8, 3, 2, c('ink'));
      img.fill(18, 8, 3, 2, c('ink'));
      img.set(13, 8, c('red'));
      img.set(19, 8, c('red'));
      img.fill(13, 12, 6, 1, c('blood'));
    },
  },
  {
    file: 'safe',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 14.5, 7, 1.5);
      img.fill(2, 2, 12, 12, c('stone_dark'));
      img.fill(2, 2, 12, 1, c('stone'));
      img.fill(3, 4, 10, 8, c('shadow'));
      img.ellipse(8, 8, 2.5, 2.5, c('stone_light'));
      img.set(8, 8, c('ink'));
      img.fill(11, 6, 1, 4, c('gold'));
    },
  },
  {
    file: 'military_crate',
    width: 24,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 12, 14.5, 11, 1.5);
      img.fill(1, 3, 22, 11, c('forest'));
      img.fill(1, 3, 22, 2, c('grass'));
      img.fill(1, 8, 22, 1, c('forest_dark'));
      for (const x of [3, 19]) img.fill(x, 3, 2, 11, c('forest_dark'));
      img.fill(9, 5, 6, 2, c('wheat'));
      img.set(12, 10, c('stone_light'));
    },
  },
];

const PHASE10C_ICONS: Sprite[] = [
  {
    file: 'bunker_key',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(5, 8, 3.5, 3.5, c('gold'));
      img.ellipse(5, 8, 1.5, 1.5, c('ink'));
      img.fill(8, 7, 7, 2, c('gold'));
      img.fill(12, 9, 1, 3, c('amber'));
      img.fill(14, 9, 1, 2, c('amber'));
    },
  },
  {
    file: 'military_keycard',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(2, 4, 12, 9, c('forest'));
      img.fill(2, 4, 12, 1, c('grass'));
      img.fill(3, 6, 4, 4, c('cream'));
      img.fill(8, 6, 5, 1, c('lime'));
      img.fill(8, 8, 4, 1, c('stone_light'));
      img.fill(2, 11, 12, 1, c('gold'));
    },
  },
];

/** Mochila (ícone): `big` = a grande, com bolsos dos lados. */
function backpack(img: Bitmap, big: boolean): void {
  const [x, w] = big ? [2, 12] : [4, 8];
  img.fill(x, 4, w, 10, c(big ? 'forest' : 'wood'));
  img.fill(x, 4, w, 2, c(big ? 'grass' : 'wood_light'));
  img.fill(x + 2, 8, w - 4, 4, c(big ? 'forest_dark' : 'bark'));
  img.fill(6, 2, 4, 2, c('bark_dark')); // pega
  if (big) {
    img.fill(0, 7, 2, 5, c('forest_dark'));
    img.fill(14, 7, 2, 5, c('forest_dark'));
  }
  img.set(8, 10, c('gold'));
}

/** Fase 10 (parte D): equipamento militar e mochilas. */
const PHASE10D_ICONS: Sprite[] = [
  {
    file: 'small_backpack',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      backpack(img, false);
    },
  },
  {
    file: 'large_backpack',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      backpack(img, true);
    },
  },
  {
    // Bolsa: a primeira "mochila" (+5), de pano atado.
    file: 'pouch',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(5, 7, 6, 7, c('parchment'));
      img.fill(4, 9, 8, 4, c('parchment'));
      img.fill(5, 7, 6, 1, c('cream'));
      img.fill(10, 9, 2, 4, c('wheat'));
      img.fill(6, 5, 4, 2, c('wheat')); // boca franzida
      img.fill(5, 7, 6, 1, c('bark')); // atilho
      img.set(11, 8, c('bark'));
      img.set(12, 9, c('bark'));
    },
  },
  {
    // Mochila de expedição (+40): grande, azul-petróleo, com um saco-cama enrolado em cima.
    file: 'expedition_backpack',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      backpack(img, true);
      img.fill(2, 5, 12, 9, c('teal'));
      img.fill(2, 5, 12, 1, c('sky'));
      img.fill(4, 8, 8, 4, c('deep_water'));
      img.fill(0, 7, 2, 5, c('deep_water'));
      img.fill(14, 7, 2, 5, c('deep_water'));
      img.fill(3, 1, 10, 3, c('orange')); // saco-cama
      img.fill(3, 1, 10, 1, c('amber'));
      img.set(8, 10, c('gold'));
    },
  },
  {
    // Mochila de sobrevivente (+50): a maior, de couro, com cantil e corda.
    file: 'survivor_backpack',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      backpack(img, true);
      img.fill(1, 3, 14, 11, c('bark'));
      img.fill(1, 3, 14, 2, c('wood'));
      img.fill(3, 7, 10, 5, c('bark_dark'));
      img.fill(0, 6, 1, 7, c('bark_dark'));
      img.fill(15, 6, 1, 7, c('bark_dark'));
      img.fill(12, 8, 3, 4, c('stone_light')); // cantil
      img.fill(2, 12, 12, 1, c('wheat')); // corda
      img.set(8, 9, c('gold'));
    },
  },
  {
    // Mochila militar (+30): grande, camuflada, com fivelas.
    file: 'military_backpack',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      backpack(img, true);
      img.fill(2, 4, 12, 10, c('sand'));
      img.fill(2, 4, 12, 2, c('wheat'));
      img.set(3, 7, c('forest'));
      img.set(12, 6, c('forest'));
      img.set(11, 12, c('forest'));
      img.fill(4, 8, 8, 4, c('bark'));
      img.fill(0, 7, 2, 5, c('bark'));
      img.fill(14, 7, 2, 5, c('bark'));
      img.fill(5, 9, 1, 2, c('stone_light'));
      img.fill(10, 9, 1, 2, c('stone_light'));
      img.set(8, 10, c('gold'));
    },
  },
  {
    file: 'military_helmet',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 9, 6.5, 5, c('forest'));
      img.ellipse(7, 7, 3.5, 2, c('grass'));
      img.fill(1, 11, 14, 2, c('forest_dark'));
      img.fill(4, 13, 1, 2, c('bark_dark'));
      img.fill(11, 13, 1, 2, c('bark_dark'));
    },
  },
  {
    file: 'military_vest',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(3, 3, 10, 11, c('forest'));
      img.fill(6, 3, 4, 3, c('ink')); // gola aberta
      img.fill(4, 7, 3, 3, c('forest_dark'));
      img.fill(9, 7, 3, 3, c('forest_dark'));
      img.fill(3, 12, 10, 1, c('bark_dark'));
      img.set(5, 8, c('stone_light'));
      img.set(10, 8, c('stone_light'));
    },
  },
];

/** Fase 10 (parte E): zonas-evento, comerciante e moto. */
const PHASE10E: Sprite[] = [
  {
    file: 'plane_wreck',
    width: 64,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 32, 29, 30, 2.5);
      // Fuselagem partida ao meio, de lado.
      img.fill(4, 14, 26, 12, c('stone_light'));
      img.fill(34, 12, 26, 12, c('stone_light'));
      img.fill(4, 22, 26, 4, c('stone'));
      img.fill(34, 20, 26, 4, c('stone'));
      img.fill(30, 13, 4, 12, c('ink')); // a fratura
      for (const x of [8, 14, 20, 40, 46, 52]) img.fill(x, 16, 3, 3, c('sky'));
      img.fill(56, 4, 6, 10, c('stone')); // cauda
      img.fill(56, 4, 6, 2, c('red'));
      img.fill(10, 24, 16, 3, c('stone_dark')); // asa
      img.fill(2, 18, 3, 6, c('stone_dark'));
      img.set(32, 11, c('shadow'));
      img.set(33, 9, c('stone'));
    },
  },
  {
    file: 'locomotive',
    width: 48,
    height: 28,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 24, 26, 22, 2);
      img.fill(2, 10, 44, 12, c('blood'));
      img.fill(2, 10, 44, 2, c('red'));
      img.fill(30, 2, 14, 10, c('blood'));
      img.fill(32, 4, 4, 4, c('sky'));
      img.fill(38, 4, 4, 4, c('sky'));
      img.fill(6, 4, 4, 6, c('shadow')); // chaminé
      for (const x of [6, 16, 26, 36]) img.ellipse(x + 3, 23, 3, 3, c('stone_dark'));
      img.fill(0, 18, 2, 4, c('stone'));
    },
  },
  {
    file: 'wagon',
    width: 32,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 16, 22, 15, 1.5);
      img.fill(1, 4, 30, 14, c('wood'));
      img.fill(1, 4, 30, 2, c('wood_light'));
      for (const x of [8, 16, 24]) img.fill(x, 6, 1, 12, c('bark'));
      img.fill(12, 8, 8, 8, c('bark_dark')); // porta
      for (const x of [5, 25]) img.ellipse(x, 20, 2.5, 2.5, c('stone_dark'));
    },
  },
  {
    file: 'tent',
    width: 32,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 16, 22, 15, 1.5);
      for (let y = 0; y < 18; y++) {
        const half = Math.round((y * 14) / 18);
        img.fill(16 - half, 3 + y, half * 2, 1, c(y % 5 === 0 ? 'forest' : 'grass'));
      }
      for (let y = 8; y < 21; y++) {
        const half = Math.round(((y - 8) * 4) / 12);
        img.fill(16 - half, y, half * 2, 1, c('forest_dark'));
      }
      img.fill(15, 1, 2, 3, c('bark'));
    },
  },
  {
    file: 'trader',
    width: 16,
    height: 32,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 8, 30.5, 5.5, 1.5);
      img.fill(5, 22, 3, 8, c('bark'));
      img.fill(9, 22, 3, 8, c('bark'));
      img.fill(5, 29, 3, 1, c('ink'));
      img.fill(9, 29, 3, 1, c('ink'));
      // Casaco comprido com mochila grande.
      img.fill(4, 12, 9, 11, c('teal'));
      img.fill(4, 12, 9, 1, c('sky'));
      img.fill(12, 12, 1, 11, c('forest_dark'));
      img.fill(2, 13, 2, 7, c('peach'));
      img.fill(13, 13, 2, 7, c('rose'));
      img.fill(6, 16, 5, 1, c('gold'));
      // Cabeça com chapéu de abas.
      img.fill(5, 5, 7, 7, c('peach'));
      img.fill(3, 4, 11, 2, c('wood'));
      img.fill(5, 2, 7, 3, c('wood_light'));
      img.set(7, 8, c('ink'));
      img.set(10, 8, c('ink'));
      img.fill(7, 10, 4, 1, c('bark')); // barba
    },
  },
  {
    file: 'motorcycle',
    width: 32,
    height: 24,
    outline: 'ink',
    paint: (img) => {
      shadow(img, 16, 22, 14, 1.5);
      for (const x of [6, 26]) {
        img.ellipse(x, 17, 5, 5, c('ink'));
        img.ellipse(x, 17, 2.5, 2.5, c('stone'));
      }
      img.fill(8, 11, 16, 4, c('red'));
      img.fill(8, 11, 16, 1, c('rose'));
      img.fill(12, 15, 7, 4, c('stone_dark')); // motor
      img.fill(10, 8, 8, 3, c('ink')); // assento
      img.fill(23, 5, 2, 8, c('stone'));
      img.fill(21, 4, 6, 1, c('stone_light')); // guiador
      img.fill(26, 8, 2, 2, c('gold'));
    },
  },
];

const PHASE10E_ICONS: Sprite[] = [
  {
    file: 'moto_engine',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.fill(3, 5, 10, 8, c('stone_dark'));
      img.fill(3, 5, 10, 1, c('stone'));
      for (const y of [7, 9, 11]) img.fill(2, y, 12, 1, c('stone'));
      img.fill(6, 2, 4, 3, c('stone_light'));
      img.set(12, 12, c('gold'));
    },
  },
  {
    file: 'moto_frame',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 10; i++) img.set(3 + i, 12 - Math.floor(i / 2), c('red'));
      for (let i = 0; i < 8; i++) img.set(3 + i, 12, c('red'));
      for (let i = 0; i < 6; i++) img.set(12, 7 - i, c('stone_light'));
      img.fill(10, 2, 5, 1, c('stone'));
    },
  },
  {
    file: 'moto_wheel',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      img.ellipse(8, 8, 6, 6, c('ink'));
      img.ellipse(8, 8, 4, 4, c('stone_dark'));
      img.ellipse(8, 8, 1.5, 1.5, c('stone_light'));
      img.fill(8, 3, 1, 10, c('stone'));
      img.fill(3, 8, 10, 1, c('stone'));
    },
  },
];

/** Armas à distância leves (fisga, arcos) e munição recuperável. */
const RANGED_ICONS: Sprite[] = [
  {
    file: 'slingshot',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      // Cabo e forquilha em Y.
      img.fill(7, 8, 2, 6, c('wood'));
      img.fill(7, 8, 1, 6, c('wood_light'));
      for (let i = 0; i < 5; i++) {
        img.set(6 - i, 7 - i, c('wood'));
        img.set(9 + i, 7 - i, c('bark'));
      }
      // Elástico com a bolsa.
      for (let x = 3; x <= 12; x++) img.set(x, 3, c('red'));
      img.fill(7, 3, 2, 2, c('bark_dark'));
    },
  },
  {
    file: 'pebble',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (const [x, y] of [
        [5, 6],
        [10, 8],
        [6, 11],
      ] as const) {
        img.ellipse(x, y, 2.2, 1.8, c('stone'));
        img.set(x - 1, y - 1, c('stone_light'));
        img.set(x + 1, y + 1, c('stone_dark'));
      }
    },
  },
  {
    file: 'short_bow',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      // Arco curvo (madeira) e corda reta.
      for (let y = 2; y <= 13; y++) {
        const x = 4 + Math.round(4 * Math.sin(((y - 2) / 11) * Math.PI));
        img.set(x, y, c('wood'));
        img.set(x - 1, y, c('bark'));
      }
      for (let y = 2; y <= 13; y++) img.set(4, y, c('wheat'));
      img.fill(7, 7, 2, 2, c('bark_dark'));
    },
  },
  {
    file: 'hunting_bow',
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let y = 1; y <= 14; y++) {
        const x = 3 + Math.round(6 * Math.sin(((y - 1) / 13) * Math.PI));
        img.set(x, y, c('bark'));
        img.set(x + 1, y, c('bark_dark'));
      }
      for (let y = 1; y <= 14; y++) img.set(3, y, c('wheat'));
      // Punho de couro.
      img.fill(9, 6, 2, 4, c('bark_dark'));
      img.set(9, 6, c('orange'));
    },
  },
  // Flechas: a mesma haste de madeira e penas; só a ponta muda (madeira, pedra, ferro).
  ...(
    [
      ['arrow', 'bark', 'wood'],
      ['stone_arrow', 'stone_dark', 'stone'],
      ['iron_arrow', 'stone_light', 'ice'],
    ] as const
  ).map(([file, tipDark, tipLight]): Sprite => ({
    file,
    width: 16,
    height: 16,
    outline: 'ink',
    paint: (img) => {
      for (let i = 0; i < 9; i++) img.set(3 + i, 12 - i, c('wood'));
      // Penas.
      img.set(2, 12, c('cream'));
      img.set(3, 13, c('cream'));
      img.set(2, 13, c('red'));
      // Ponta (triângulo 4×4, luz em cima).
      img.fill(11, 2, 3, 3, c(tipDark));
      img.set(14, 1, c(tipLight));
      img.set(13, 1, c(tipLight));
      img.set(13, 2, c(tipLight));
      img.set(12, 2, c(tipLight));
      img.set(14, 2, c(tipDark));
      img.set(11, 4, c(tipDark));
      img.set(10, 3, c(tipDark));
    },
  })),
];

const outDir = new URL('public/assets/sprites/', ROOT);
const iconDir = new URL('icons/', outDir);
mkdirSync(iconDir, { recursive: true });
const rendered: Bitmap[] = [];
for (const [dir, list] of [
  [outDir, SPRITES],
  [outDir, STRUCTURES],
  [outDir, CREATURES],
  [outDir, ZONE_OBJECTS],
  [outDir, PHASE8],
  [outDir, PHASE8B],
  [outDir, PHASE9],
  [outDir, PHASE10A],
  [outDir, PHASE10B],
  [outDir, PHASE10C],
  [outDir, PHASE10E],
  [iconDir, ICONS],
  [iconDir, WEAPON_ICONS],
  [iconDir, FOOD_ICONS],
  [iconDir, NOTE_ICONS],
  [iconDir, IRON_ICONS],
  [iconDir, PHASE9_ICONS],
  [iconDir, PHASE10A_ICONS],
  [iconDir, PHASE10B_ICONS],
  [iconDir, PHASE10C_ICONS],
  [iconDir, PHASE10D_ICONS],
  [iconDir, PHASE10E_ICONS],
  [iconDir, RANGED_ICONS],
] as const) {
  for (const sprite of list) {
    const img = new Bitmap(sprite.width, sprite.height);
    sprite.paint(img);
    if (sprite.outline) img.outline(c(sprite.outline));
    writeFileSync(new URL(`${sprite.file}.png`, dir), img.toPng());
    rendered.push(img);
  }
}
console.log(
  `sprites/: ${String(SPRITES.length + STRUCTURES.length + CREATURES.length + ZONE_OBJECTS.length + PHASE8.length + PHASE8B.length + PHASE9.length + PHASE10A.length + PHASE10B.length + PHASE10C.length + PHASE10E.length)} sprites + ${String(ICONS.length + WEAPON_ICONS.length + FOOD_ICONS.length + NOTE_ICONS.length + IRON_ICONS.length + PHASE9_ICONS.length + PHASE10A_ICONS.length + PHASE10B_ICONS.length + PHASE10C_ICONS.length + PHASE10D_ICONS.length + PHASE10E_ICONS.length + RANGED_ICONS.length)} ícones`,
);

// Prancha de pré-visualização ampliada (para rever a arte sem abrir o jogo).
const previewIndex = process.argv.indexOf('--preview');
const previewPath = previewIndex >= 0 ? process.argv[previewIndex + 1] : undefined;
if (previewPath) {
  const SCALE = 6;
  const PAD = 4;
  const width = rendered.reduce((sum, img) => sum + img.width * SCALE + PAD, PAD);
  const height = Math.max(...rendered.map((img) => img.height)) * SCALE + PAD * 2;
  const sheet = new Bitmap(width, height);
  sheet.fill(0, 0, width, height, c('grass'));
  let x = PAD;
  for (const img of rendered) {
    sheet.blit(img, x, PAD, SCALE);
    x += img.width * SCALE + PAD;
  }
  writeFileSync(previewPath, sheet.toPng());
  console.log(`pré-visualização: ${previewPath}`);
}

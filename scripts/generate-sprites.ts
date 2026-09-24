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
      img.set(10, 11, c('stone_dark'));
      img.set(11, 10, c('stone_dark'));
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
];

/**
 * Peças de construção (CLAUDE.md §7.7). As de cima têm 16×24: o tile (16×16) visto de cima fica
 * nas linhas 0–15 e a face da frente nas 16–23, para parecerem ter altura (vista 3/4). Sem
 * contorno exterior, para as peças encostadas formarem uma parede contínua.
 */
const WALL_FRONT = 16;

type Palette3 = readonly [dark: string, mid: string, light: string];
const WOOD: Palette3 = ['bark', 'wood', 'wood_light'];
const STONE: Palette3 = ['stone_dark', 'stone', 'stone_light'];

/**
 * Topo de uma parede de madeira: troncos deitados, mais escuros do que o chão de tábuas, com
 * uma aresta clara em cima (luz de cima-esquerda) e escura em baixo.
 */
function woodTop(img: Bitmap): void {
  img.fill(0, 0, 16, WALL_FRONT, c('bark'));
  for (const y of [1, 5, 9, 13]) {
    img.fill(0, y, 16, 2, c('wood'));
    img.fill(0, y, 16, 1, c('wood_light'));
  }
  for (const [x, y] of [
    [4, 2],
    [11, 6],
    [2, 10],
    [9, 14],
  ] as const) {
    img.set(x, y, c('bark')); // nós na madeira
  }
  img.fill(0, 0, 16, 1, c('bark_dark'));
  img.fill(0, WALL_FRONT - 1, 16, 1, c('bark_dark'));
}

/** Topo de uma parede de pedra: blocos com juntas desencontradas. */
function stoneTop(img: Bitmap): void {
  img.fill(0, 0, 16, WALL_FRONT, c('stone_light'));
  for (const y of [0, 5, 10]) img.fill(0, y, 16, 1, c('stone'));
  for (const [x, y] of [
    [7, 1],
    [3, 6],
    [11, 6],
    [7, 11],
    [15, 1],
  ] as const) {
    img.fill(x, y, 1, 4, c('stone'));
  }
  img.fill(0, 0, 16, 1, c('stone_dark'));
  img.fill(0, WALL_FRONT - 1, 16, 1, c('stone_dark'));
}

/** Face da frente (linhas 16–23): troncos na horizontal ou blocos de pedra. */
function front(img: Bitmap, colors: Palette3, logs: boolean): void {
  const [dark, mid, light] = colors;
  img.fill(0, WALL_FRONT, 16, 8, c(mid));
  if (logs) {
    for (const y of [WALL_FRONT + 3, WALL_FRONT + 6]) img.fill(0, y, 16, 1, c(dark));
    img.fill(0, WALL_FRONT, 16, 1, c(light));
    img.fill(0, WALL_FRONT + 4, 16, 1, c(light));
  } else {
    img.fill(0, WALL_FRONT + 3, 16, 1, c(dark));
    for (const [x, y] of [
      [5, 0],
      [12, 0],
      [2, 4],
      [9, 4],
    ] as const) {
      img.fill(x, WALL_FRONT + y, 1, 3, c(dark));
    }
    img.fill(1, WALL_FRONT + 1, 3, 1, c(light));
  }
  img.fill(0, 23, 16, 1, c('bark_dark'));
}

/** Porta vista de cima: moldura escura e a folha em tábuas claras, com o puxador. */
function doorTop(img: Bitmap, vertical: boolean): void {
  const [x, y, w, h] = vertical ? [4, 0, 8, WALL_FRONT] : [0, 3, 16, 10];
  img.fill(x, y, w, h, c('bark_dark'));
  img.fill(x + 1, y + 1, w - 2, h - 2, c('wood_light'));
  if (vertical) for (const py of [y + 4, y + 8, y + 12]) img.fill(x + 1, py, w - 2, 1, c('wood'));
  else for (const px of [x + 4, x + 8, x + 12]) img.fill(px, y + 1, 1, h - 2, c('wood'));
  img.set(vertical ? x + 5 : x + 10, vertical ? y + 7 : y + 5, c('gold'));
}

/** Porta fechada na horizontal: moldura por cima e a porta na face da frente. */
function doorFront(img: Bitmap): void {
  img.fill(3, WALL_FRONT, 10, 8, c('bark'));
  img.fill(4, WALL_FRONT + 1, 8, 7, c('wood'));
  img.fill(7, WALL_FRONT + 1, 1, 7, c('bark'));
  img.fill(4, WALL_FRONT + 1, 8, 1, c('wood_light'));
  img.set(10, WALL_FRONT + 4, c('gold'));
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
    height: 24,
    paint: (img) => {
      woodTop(img);
      front(img, WOOD, true);
    },
  },
  {
    file: 'wall_stone',
    width: 16,
    height: 24,
    paint: (img) => {
      stoneTop(img);
      front(img, STONE, false);
    },
  },
  {
    file: 'door_wood',
    width: 16,
    height: 24,
    paint: (img) => {
      woodTop(img);
      doorTop(img, false);
      front(img, WOOD, true);
      doorFront(img);
    },
  },
  {
    file: 'door_wood_open',
    width: 16,
    height: 24,
    paint: (img) => {
      // Só a moldura (ombreiras e verga): o jogador passa pelo meio e vê-se o chão.
      for (const x of [0, 13]) {
        img.fill(x, 0, 3, 24, c('wood'));
        img.fill(x, 0, 1, 24, c('wood_light'));
        img.fill(x + 2, 0, 1, 24, c('bark'));
      }
      img.fill(0, 0, 16, 3, c('wood_light'));
      img.fill(0, 3, 16, 1, c('bark'));
      img.fill(0, 23, 16, 1, c('bark_dark'));
      img.fill(3, 4, 2, 18, c('wood')); // a porta, aberta contra a ombreira
      img.fill(3, 4, 1, 18, c('wood_light'));
    },
  },
  {
    file: 'door_wood_v',
    width: 16,
    height: 24,
    paint: (img) => {
      woodTop(img);
      doorTop(img, true);
      front(img, WOOD, true);
      img.fill(4, WALL_FRONT, 8, 7, c('bark_dark'));
      img.fill(5, WALL_FRONT, 6, 7, c('wood'));
    },
  },
  {
    file: 'door_wood_v_open',
    width: 16,
    height: 24,
    paint: (img) => {
      // Moldura a norte e a sul; a porta aberta encostada a norte.
      img.fill(0, 0, 16, 4, c('wood_light'));
      img.fill(0, 0, 16, 1, c('bark_dark'));
      img.fill(0, 3, 16, 1, c('bark'));
      img.fill(0, 4, 3, 2, c('wood'));
      img.fill(13, 4, 3, 2, c('wood'));
      img.fill(3, 4, 10, 2, c('wood')); // porta aberta
      img.fill(3, 4, 10, 1, c('wood_light'));
      img.fill(0, WALL_FRONT - 2, 16, 2, c('wood_light'));
      img.fill(0, WALL_FRONT, 16, 8, c('wood'));
      img.fill(0, WALL_FRONT, 16, 1, c('bark'));
      img.fill(0, 23, 16, 1, c('bark_dark'));
    },
  },
  {
    file: 'window_wood',
    width: 16,
    height: 24,
    paint: (img) => {
      woodTop(img);
      front(img, WOOD, true);
      img.fill(3, WALL_FRONT + 1, 10, 6, c('bark'));
      img.fill(4, WALL_FRONT + 2, 8, 4, c('sky'));
      img.fill(4, WALL_FRONT + 2, 3, 1, c('ice'));
      img.fill(7, WALL_FRONT + 2, 1, 4, c('bark'));
    },
  },
  {
    file: 'window_wood_v',
    width: 16,
    height: 24,
    paint: (img) => {
      woodTop(img);
      front(img, WOOD, true);
      img.fill(5, 2, 6, 12, c('bark'));
      img.fill(6, 3, 4, 10, c('sky'));
      img.fill(6, 3, 1, 4, c('ice'));
      img.fill(6, 7, 4, 1, c('bark'));
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

const outDir = new URL('public/assets/sprites/', ROOT);
const iconDir = new URL('icons/', outDir);
mkdirSync(iconDir, { recursive: true });
const rendered: Bitmap[] = [];
for (const [dir, list] of [
  [outDir, SPRITES],
  [outDir, STRUCTURES],
  [outDir, CREATURES],
  [outDir, ZONE_OBJECTS],
  [iconDir, ICONS],
  [iconDir, WEAPON_ICONS],
  [iconDir, FOOD_ICONS],
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
  `sprites/: ${String(SPRITES.length + STRUCTURES.length + CREATURES.length + ZONE_OBJECTS.length)} sprites + ${String(ICONS.length + WEAPON_ICONS.length + FOOD_ICONS.length)} ícones`,
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

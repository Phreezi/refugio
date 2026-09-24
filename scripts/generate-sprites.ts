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

const outDir = new URL('public/assets/sprites/', ROOT);
const iconDir = new URL('icons/', outDir);
mkdirSync(iconDir, { recursive: true });
const rendered: Bitmap[] = [];
for (const [dir, list] of [
  [outDir, SPRITES],
  [iconDir, ICONS],
] as const) {
  for (const sprite of list) {
    const img = new Bitmap(sprite.width, sprite.height);
    sprite.paint(img);
    if (sprite.outline) img.outline(c(sprite.outline));
    writeFileSync(new URL(`${sprite.file}.png`, dir), img.toPng());
    rendered.push(img);
  }
}
console.log(`sprites/: ${String(SPRITES.length)} sprites + ${String(ICONS.length)} ícones`);

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

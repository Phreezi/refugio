// Gera o ícone do jogo (cabana acolhedora numa noite pós-apocalíptica) e a imagem de partilha,
// em pixel art desenhada por código, só com cores da paleta (CLAUDE.md §12, guia de estilo):
// favicons 16/32, apple-touch-icon 180, ícones 192/512 (+ maskable com margem) e og-image
// 1200×630, em public/icons/. Desenha-se a 16 e a 32 px e amplia-se por inteiros.
// Uso: `npm run icons` (com `-- --preview <ficheiro.png>` escreve também uma prancha).

import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { Bitmap, hexToRgb, type Rgb } from './png.ts';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('public/icons/', ROOT);

const palette = JSON.parse(readFileSync(new URL('src/assets/palette.json', ROOT), 'utf8')) as Record<
  string,
  string
>;
function c(name: string): Rgb {
  const hex = palette[name];
  if (hex === undefined) throw new Error(`Cor fora da paleta: ${name}`);
  return hexToRgb(hex);
}

/** Grelha de letras → píxeis (`.` = transparente). */
function grid(img: Bitmap, ox: number, oy: number, rows: readonly string[], legend: Record<string, string>) {
  rows.forEach((row, y) => {
    Array.from(row).forEach((ch, x) => {
      const name = legend[ch];
      if (name !== undefined) img.set(ox + x, oy + y, c(name));
    });
  });
}

/** Quadrado de cantos redondos (raio em píxeis), cheio. */
function roundedMask(size: number, radius: number): (x: number, y: number) => boolean {
  return (x, y) => {
    const dx = Math.max(radius - x - 0.5, 0, x + 0.5 - (size - radius));
    const dy = Math.max(radius - y - 0.5, 0, y + 0.5 - (size - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
}

/** Céu da noite (escuro em cima, ameixa no horizonte), estrelas e lua. */
function sky(img: Bitmap, w: number, h: number, horizon: number, inside: (x: number, y: number) => boolean) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      // Faixas com um degrau em xadrez entre elas (sem cores "quase iguais").
      const t = y / horizon;
      const band =
        t < 0.45 ? 'night' : t < 0.75 ? ((x + y) % 2 === 0 && t < 0.55 ? 'night' : 'plum') : 'plum';
      img.set(x, y, c(band));
    }
  }
}

// --- Ícone 32×32 -------------------------------------------------------------------------------

/** Cabana com a janela acesa (camada própria, com contorno `ink`). */
function cabin32(): Bitmap {
  const img = new Bitmap(32, 32);
  // Chaminé de pedra (luz à esquerda), por trás do telhado.
  img.fill(19, 7, 3, 7, c('stone'));
  img.fill(19, 7, 1, 7, c('stone_light'));
  img.fill(21, 7, 1, 7, c('stone_dark'));
  img.fill(19, 7, 3, 1, c('stone_light'));
  // Paredes de troncos: cada tronco 2 linhas (luz em cima), lado direito à sombra.
  for (let y = 16; y < 26; y++) {
    const top = (y - 16) % 2 === 0;
    img.fill(9, y, 14, 1, c(top ? 'wood_light' : 'wood'));
    img.fill(21, y, 2, 1, c(top ? 'wood' : 'bark'));
    if (!top) img.set(9, y, c('bark')); // ponta dos troncos
  }
  // Sombra do beiral.
  img.fill(9, 16, 14, 1, c('bark'));
  // Telhado: triângulo com o lado esquerdo à luz.
  for (let y = 8; y <= 16; y++) {
    const half = y - 7;
    for (let x = 16 - half; x < 16 + half; x++) {
      const left = x < 16;
      const edge = y === 16;
      const shingle = (y % 2 === 0 && (x + y) % 4 === 0) || edge;
      const color = edge ? 'blood' : left ? (shingle ? 'red' : 'orange') : shingle ? 'blood' : 'red';
      img.set(x, y, c(color));
    }
  }
  img.set(15, 8, c('amber')); // cumeeira apanha a luz
  // Janela acesa (âmbar, centro dourado) com caixilho em cruz.
  img.fill(11, 19, 5, 4, c('amber'));
  img.fill(12, 20, 1, 1, c('gold'));
  img.fill(14, 20, 1, 1, c('gold'));
  img.fill(13, 19, 1, 4, c('bark_dark'));
  img.fill(11, 21, 5, 1, c('bark_dark'));
  img.fill(11, 23, 5, 1, c('bark')); // parapeito
  // Porta.
  img.fill(17, 20, 3, 6, c('bark_dark'));
  img.fill(17, 20, 1, 6, c('bark'));
  img.set(19, 23, c('gold'));
  img.outline(c('ink'));
  return img;
}

/** Pinheiro escuro (silhueta, à esquerda da cabana). */
function pine(img: Bitmap, cx: number, top: number, layers: number): void {
  for (let i = 0; i < layers; i++) {
    const y0 = top + i * 3;
    for (let r = 0; r < 4; r++) {
      const half = 1 + r + i;
      for (let x = cx - half; x <= cx + half; x++) img.set(x, y0 + r, c(x < cx ? 'forest' : 'forest_dark'));
    }
  }
  img.fill(cx, top + layers * 3 + 1, 1, 2, c('bark_dark'));
}

function icon32(): Bitmap {
  const img = new Bitmap(32, 32);
  const inside = roundedMask(32, 6);
  sky(img, 32, 32, 22, inside);
  // Estrelas e lua (luz de cima-esquerda: a lua no canto).
  for (const [x, y] of [
    [10, 4],
    [26, 9],
    [14, 2],
    [28, 3],
    [3, 13],
  ] as const)
    img.set(x, y, c('cream'));
  img.ellipse(6, 6, 2.6, 2.6, c('wheat'));
  img.ellipse(7, 5.4, 2, 2, c('night'));
  // Fumo da chaminé.
  img.set(21, 5, c('stone_light'));
  img.set(22, 4, c('stone_light'));
  img.set(22, 3, c('stone'));
  img.set(23, 2, c('stone'));
  // Chão: relva com luz quente da janela.
  for (let y = 24; y < 32; y++)
    for (let x = 0; x < 32; x++) if (inside(x, y)) img.set(x, y, c(y === 24 ? 'grass' : 'forest'));
  for (let x = 0; x < 32; x += 3) img.set(x, 25, c('grass'));
  pine(img, 5, 11, 4);
  pine(img, 27, 15, 3);
  // Brilho da janela no chão.
  img.fill(10, 27, 7, 1, c('leaf'));
  img.fill(12, 28, 3, 1, c('lime'));
  const cabin = cabin32();
  img.blit(cabin, 0, 0);
  // Contorno do ícone.
  edge(img, inside, 32);
  return img;
}

/** Contorno `ink` de 1 px na borda da máscara. */
function edge(img: Bitmap, inside: (x: number, y: number) => boolean, size: number): void {
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) continue;
      const border = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx = 0, ny = 0]) => nx < 0 || ny < 0 || nx >= size || ny >= size || !inside(nx, ny));
      if (border) img.set(x, y, c('ink'));
    }
}

// --- Ícone 16×16 (desenhado à parte: legível no separador do browser) --------------------------

function icon16(): Bitmap {
  const img = new Bitmap(16, 16);
  grid(
    img,
    0,
    0,
    [
      '..kkkkkkkkkkkk..',
      '.kmnnnnnnnnnnSk.',
      'knmnnnnnnnnkSnnk',
      'knnnnnnkknktknnk',
      'knnnnnkORkktknnk',
      'knnnnkOORrktknnk',
      'knnnkOORRrrknnnk',
      'knnkOOORRRrrknnk',
      'knkrrrrrrrrrrknk',
      'kppkBBBBBBBBkppk',
      'kppkwyywwddWkppk',
      'kffkWyyWWddBkffk',
      'kffkwwwwwdgWkffk',
      'kffkkkkkkkkkkffk',
      '.kfLllLfffffffk.',
      '..kkkkkkkkkkkk..',
    ],
    {
      k: 'ink',
      n: 'night',
      p: 'plum',
      m: 'wheat',
      S: 'stone_light',
      t: 'stone',
      R: 'red',
      r: 'blood',
      O: 'orange',
      B: 'bark',
      w: 'wood_light',
      W: 'wood',
      y: 'amber',
      d: 'bark_dark',
      g: 'gold',
      f: 'forest',
      L: 'leaf',
      l: 'lime',
    },
  );
  return img;
}

// --- Ampliações --------------------------------------------------------------------------------

/** `src` ampliado por um inteiro e centrado numa tela `size` (fundo opcional, cheio). */
function scaled(src: Bitmap, size: number, scale: number, background?: Rgb): Bitmap {
  const img = new Bitmap(size, size);
  if (background) img.fill(0, 0, size, size, background);
  const off = Math.round((size - src.width * scale) / 2);
  img.blit(src, off, off, scale);
  return img;
}

/**
 * Ícone "maskable" (Android recorta-o num círculo/forma): fundo da cor do céu até às bordas e o
 * ícone dentro da zona segura (círculo de 80% do lado).
 */
function maskable(size: number, scale: number): Bitmap {
  const src = icon32();
  const img = new Bitmap(size, size);
  img.fill(0, 0, size, size, c('night'));
  img.fill(0, Math.round(size * 0.62), size, size, c('forest'));
  const off = Math.round((size - 32 * scale) / 2);
  img.blit(src, off, off, scale);
  return img;
}

// --- Imagem de partilha (Open Graph) 200×105 → ×6 = 1200×630 -----------------------------------

const FONT: Record<string, readonly string[]> = {
  R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  F: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'X....'],
  U: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  G: ['.XXX.', 'X...X', 'X....', 'X.XXX', 'X...X', 'X...X', '.XXX.'],
  I: ['XXX', '.X.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
};

/** Escreve em letras de 5×7 ampliadas `s` vezes, com sombra `ink`; `Ú` leva acento. */
function title(img: Bitmap, text: string, cx: number, y: number, s: number): void {
  const letters = Array.from(text);
  const widths = letters.map((ch) => (FONT[ch === 'Ú' ? 'U' : ch]?.[0]?.length ?? 3) * s);
  const total = widths.reduce((a, b) => a + b, 0) + (letters.length - 1) * s;
  let x = Math.round(cx - total / 2);
  letters.forEach((ch, i) => {
    const rows = FONT[ch === 'Ú' ? 'U' : ch] ?? [];
    const draw = (dx: number, dy: number, color: Rgb): void => {
      rows.forEach((row, ry) => {
        Array.from(row).forEach((p, rx) => {
          if (p === 'X') img.fill(x + rx * s + dx, y + ry * s + dy, s, s, color);
        });
      });
      if (ch === 'Ú') {
        img.fill(x + 3 * s + dx, y - 3 * s + dy, s, s, color);
        img.fill(x + 2 * s + dx, y - 2 * s + dy, s, s, color);
      }
    };
    draw(s, s, c('ink'));
    draw(0, 0, c('wheat'));
    x += (widths[i] ?? 0) + s;
  });
}

function ogImage(): Bitmap {
  const w = 200;
  const h = 105;
  const img = new Bitmap(w, h);
  // Céu do anoitecer: noite → ameixa → laranja no horizonte (faixas com degrau em xadrez).
  const bands: [number, string][] = [
    [0, 'night'],
    [40, 'plum'],
    [62, 'blood'],
    [70, 'orange'],
  ];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let name = 'night';
      for (const [from, band] of bands) {
        if (y >= from) name = band;
        // Linha de transição em xadrez.
        if (y === from - 1 && (x + y) % 2 === 0) name = band;
      }
      img.set(x, y, c(name));
    }
  for (const [x, y] of [
    [12, 8],
    [40, 20],
    [71, 6],
    [130, 12],
    [160, 28],
    [184, 9],
    [101, 30],
    [25, 34],
    [150, 4],
  ] as const)
    img.set(x, y, c('cream'));
  img.ellipse(20, 20, 7, 7, c('wheat'));
  img.ellipse(23, 18, 6, 6, c('night'));
  // Colinas ao longe e pinhal.
  for (let x = 0; x < w; x++) {
    const hill = Math.round(72 + 4 * Math.sin(x / 13) + 2 * Math.sin(x / 5));
    for (let y = hill; y < h; y++) img.set(x, y, c('forest_dark'));
  }
  for (const [x, top, layers] of [
    [8, 58, 4],
    [20, 62, 3],
    [34, 56, 4],
    [150, 60, 4],
    [164, 64, 3],
    [178, 55, 5],
    [192, 62, 3],
  ] as const)
    pine(img, x, top, layers);
  // Prado.
  for (let y = 82; y < h; y++)
    for (let x = 0; x < w; x++)
      img.set(x, y, c(y === 82 ? 'grass' : ((x * 37 + y * 101) ^ (x * y)) % 13 === 0 ? 'grass' : 'forest'));
  // Cabana (×2) com o brilho da janela no chão e uma fogueira.
  const cabin = cabin32();
  img.blit(cabin, 52, 11, 3);
  img.fill(82, 92, 20, 1, c('leaf'));
  img.fill(86, 93, 12, 1, c('lime'));
  // Fumo da chaminé.
  for (const [x, y, n] of [
    [112, 29, 'stone_light'],
    [115, 26, 'stone'],
    [119, 24, 'shadow'],
  ] as const)
    img.fill(x, y, 2, 2, c(n));
  // Fogueira.
  const fire = new Bitmap(9, 9);
  grid(fire, 1, 0, ['...g...', '..gag..', '..aoa..', '.aoroa.', '.aooa..', 'BWWWWWB', '.BBBBB.'], {
    g: 'gold',
    a: 'amber',
    o: 'orange',
    r: 'red',
    W: 'wood',
    B: 'bark',
  });
  fire.outline(c('ink'));
  img.ellipse(141, 94, 11, 3, c('forest_dark'));
  img.blit(fire, 132, 78, 2);
  title(img, 'REFÚGIO', 100, 9, 3);
  return img;
}

// --- Escrever ----------------------------------------------------------------------------------

const outputs: [string, Bitmap][] = [
  ['favicon-16.png', icon16()],
  ['favicon-32.png', icon32()],
  ['apple-touch-icon.png', scaled(icon32(), 180, 5, c('night'))],
  ['icon-192.png', scaled(icon32(), 192, 6)],
  ['icon-512.png', scaled(icon32(), 512, 16)],
  ['icon-maskable-192.png', maskable(192, 4)],
  ['icon-maskable-512.png', maskable(512, 10)],
];
const og = ogImage();
const ogScaled = new Bitmap(og.width * 6, og.height * 6);
ogScaled.blit(og, 0, 0, 6);
outputs.push(['og-image.png', ogScaled]);

mkdirSync(OUT, { recursive: true });
for (const [name, img] of outputs) {
  writeFileSync(new URL(name, OUT), img.toPng());
  console.log(`icons/${name} (${String(img.width)}×${String(img.height)})`);
}

const previewIndex = process.argv.indexOf('--preview');
const previewPath = previewIndex >= 0 ? process.argv[previewIndex + 1] : undefined;
if (previewPath) {
  // Prancha: 16 (×8), 32 (×4), maskable 192 com a máscara circular simulada e a og-image ×2.
  const sheet = new Bitmap(4 + 128 + 4 + 128 + 4 + 192 + 4 + 400 + 4, 4 + 210 + 4);
  sheet.fill(0, 0, sheet.width, sheet.height, c('stone_light'));
  sheet.blit(icon16(), 4, 4, 8);
  sheet.blit(icon32(), 136, 4, 4);
  const m = maskable(192, 4);
  for (let y = 0; y < 192; y++)
    for (let x = 0; x < 192; x++) {
      const dx = x + 0.5 - 96;
      const dy = y + 0.5 - 96;
      if (dx * dx + dy * dy > 96 * 96 * 0.64) m.set(x, y, c('stone_light'));
    }
  sheet.blit(m, 268, 4);
  sheet.blit(og, 464, 4, 2);
  writeFileSync(previewPath, sheet.toPng());
  console.log(`prancha: ${previewPath}`);
}

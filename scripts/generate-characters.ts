// Gera as spritesheets das personagens em pixel art (CLAUDE.md §6, Fase 12): o layout é o de
// `src/assets/characterSheet.ts` — 10 colunas (parado, andar ×4, atacar ×2, agachado parado,
// agachado a andar ×2) × 4 linhas (baixo, esquerda, direita, cima), frames de 16×32 com os pés
// na última linha. Só cores da paleta; luz de cima-esquerda; contorno escuro.
// Uso: `npm run characters` (com `-- --preview <ficheiro.png>` escreve também uma prancha ×6).

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

const W = 16;
const H = 32;
const COLUMNS = 10;
const ROWS = ['down', 'left', 'right', 'up'] as const;
type View = (typeof ROWS)[number];

/** Cores de uma personagem, por letra das grelhas. */
interface Look {
  o: string; // contorno
  h: string; // cabelo
  l: string; // cabelo (luz)
  d: string; // cabelo (sombra)
  s: string; // pele
  k: string; // pele (sombra)
  b: string; // camisola
  B: string; // camisola (sombra)
  c: string; // camisola (luz)
  t: string; // cinto / alça
  g: string; // fivela
  p: string; // calças
  P: string; // calças (sombra)
  f: string; // botas
  w: string; // mochila
  T: string; // mochila (luz)
  W: string; // mochila (sombra)
}

/** A menina: cabelo ruivo comprido, camisola rosa, calças de ganga. */
const PLAYER_GIRL: Look = {
  o: 'ink',
  h: 'orange',
  l: 'amber',
  d: 'blood',
  s: 'peach',
  k: 'wood_light',
  b: 'rose',
  B: 'plum',
  c: 'peach',
  t: 'bark',
  g: 'gold',
  p: 'water',
  P: 'deep_water',
  f: 'bark_dark',
  w: 'wood',
  T: 'wood_light',
  W: 'bark',
};

const PLAYER: Look = {
  o: 'ink',
  h: 'bark',
  l: 'wood',
  d: 'bark_dark',
  s: 'peach',
  k: 'wood_light',
  b: 'water',
  B: 'deep_water',
  c: 'sky',
  t: 'bark',
  g: 'gold',
  p: 'shadow',
  P: 'night',
  f: 'bark_dark',
  w: 'wood',
  T: 'wood_light',
  W: 'bark',
};

// ——— Grelhas (16 colunas; '.' = transparente) ———

const HEAD: Record<'down' | 'up' | 'side', string[]> = {
  down: [
    '....oooooooo....',
    '...ohhhhhhhho...',
    '..ohhlhhhhhhho..',
    '..ohlhhhhhhhho..',
    '..ohhhhhhhhhho..',
    '..ohhsshhsshho..',
    '..odssssssssdo..',
    '..odsossssosdo..',
    '...osssssssso...',
    '...okssssssko...',
    '....okkkkkko....',
  ],
  up: [
    '....oooooooo....',
    '...ohhhhhhhho...',
    '..ohhlhhhhhhho..',
    '..ohlhhhhhhhho..',
    '..ohhhhhhhhhho..',
    '..ohhhhhhhhhho..',
    '..odhhhhhhhhdo..',
    '..odhhhhhhhhdo..',
    '...ohhhhhhhho...',
    '...okhhhhhhko...',
    '....okkkkkko....',
  ],
  // Virado para a direita (a esquerda é o espelho).
  side: [
    '....oooooooo....',
    '...ohhhhhhhho...',
    '..ohhlhhhhhhho..',
    '..ohlhhhhhhhho..',
    '..ohhhhhhhhhso..',
    '..ohhhhhhhssso..',
    '..odhhhhhsssso..',
    '..odhhhhssosso..',
    '...ohhhkssssso..',
    '...ohhksssssko..',
    '....okkkkkko....',
  ],
};

/** Cabelo comprido (a menina): pinta-se por cima da cabeça e dos ombros, a partir da cabeça. */
const LONG_HAIR: Record<'down' | 'up' | 'side', string[]> = {
  down: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..od........do..',
    '..od........do..',
    '..oh........ho..',
    '..oh........ho..',
    '..ohh......hho..',
    '..ohh......hho..',
    '...oh......ho...',
    '...oo......oo...',
  ],
  up: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..ohhhhhhhhhho..',
    '..ohhhlhhhhhho..',
    '..ohhlhhhhhhho..',
    '..ohhhhhhhhhho..',
    '...oddddddddo...',
    '....oooooooo....',
  ],
  side: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..od............',
    '..od............',
    '..oh............',
    '..ohh...........',
    '..ohhh..........',
    '..ohho..........',
    '..ohho..........',
    '...oo...........',
  ],
};

const TORSO: Record<'down' | 'up' | 'side', string[]> = {
  down: [
    '..ooobbbbbbooo..',
    '.obBcbbtbbbbBbo.',
    '.obBcbbbtbbbBbo.',
    '.obBcbbbbtbbBbo.',
    '.obBbbbbbbtbBbo.',
    '.osBttttgtttBso.',
    '.okoppppppppoko.',
  ],
  up: [
    '..ooobbbbbbooo..',
    '.obBoTTTTTToBbo.',
    '.obBoTwwwwWoBbo.',
    '.obBoTwwwwWoBbo.',
    '.obBoWWWWWWoBbo.',
    '.osBooooooooBso.',
    '.okoppppppppoko.',
  ],
  side: [
    '....oooooooo....',
    '...ocbbbbbbBo...',
    '...ocbbbbbbBo...',
    '...ocbbbbbbBo...',
    '...ocbbbbbbBo...',
    '...otttttgtto...',
    '...oppppppppo...',
  ],
};

/** Mochila vista de lado (atrás das costas). */
const PACK_SIDE = ['ooooo', 'oTwWo', 'oTwWo', 'oTwWo', 'oWWWo', 'ooooo'];

function paintGrid(
  img: Bitmap,
  rows: readonly string[],
  ox: number,
  oy: number,
  look: Look,
  flip = false,
): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row.charAt(x);
      if (ch === '.') continue;
      const name = look[ch as keyof Look] as string | undefined;
      if (name === undefined) throw new Error(`Letra sem cor: ${ch}`);
      const px = flip ? ox + row.length - 1 - x : ox + x;
      if (px >= 0 && px < img.width && oy + y >= 0 && oy + y < img.height) img.set(px, oy + y, c(name));
    }
  });
}

/** Uma perna vista de frente/costas: calças e botas; `lift` encurta-a (passo). */
function frontLeg(
  img: Bitmap,
  x: number,
  top: number,
  bottom: number,
  lift: number,
  look: Look,
  shade = false,
): void {
  const end = bottom - lift;
  img.fill(x, top, 4, end - top + 1, c(look.o));
  const inner = end - top; // linhas interiores (a de baixo é contorno)
  img.fill(x + 1, top, 2, inner, c(shade ? look.P : look.p));
  const boots = Math.min(2, inner);
  img.fill(x + 1, end - boots, 2, boots, c(look.f));
}

/** Uma perna vista de lado (virada para a direita): a bota tem a biqueira à frente. */
function sideLeg(img: Bitmap, x: number, top: number, bottom: number, look: Look, back: boolean): void {
  img.fill(x, top, 4, bottom - top + 1, c(look.o));
  img.fill(x + 1, top, 2, bottom - top - 2, c(back ? look.P : look.p));
  img.fill(x + 1, bottom - 2, 2, 2, c(look.f));
  // Biqueira.
  img.set(x + 4, bottom - 1, c(look.o));
  img.set(x + 3, bottom - 1, c(look.f));
  img.set(x + 4, bottom, c(look.o));
}

/** Braço visto de lado (à frente do corpo), com a mão; `dx` balança-o ao andar. */
function sideArm(img: Bitmap, x: number, y: number, look: Look): void {
  img.fill(x, y, 4, 6, c(look.o));
  img.fill(x + 1, y + 1, 2, 3, c(look.b));
  img.fill(x + 1, y + 4, 2, 1, c(look.s));
}

/** Pau/arma na mão: uma linha de 2 px (madeira clara com sombra), de (x0,y0) a (x1,y1). */
function stick(img: Bitmap, x0: number, y0: number, x1: number, y1: number): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    pts.push([Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t)]);
  }
  // Contorno à volta, depois o miolo.
  for (const [x, y] of pts)
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const)
      if (img.alpha(x + dx, y + dy) === 0) img.set(x + dx, y + dy, c('ink'));
  pts.forEach(([x, y], i) => {
    img.set(x, y, c(i < 2 ? 'bark' : 'wood_light'));
  });
}

const WALK_LIFTS: readonly (readonly [number, number])[] = [
  [2, 0],
  [1, 0],
  [0, 2],
  [0, 1],
];

/** Um frame da personagem. */
function frame(view: View, column: number, look: Look, longHair: boolean): Bitmap {
  const img = new Bitmap(W, H);
  const walk = [1, 2, 3, 4].indexOf(column);
  const attack = [5, 6].indexOf(column);
  const sneakWalk = [8, 9].indexOf(column);
  const crouch = column === 7 || sneakWalk >= 0;
  const bob = walk === 1 || walk === 3 ? 1 : 0; // no cruzamento das pernas o corpo desce 1 px
  const drop = crouch ? 4 : 0;
  const headY = 6 + bob + drop;
  const torsoY = 17 + bob + drop;
  const side = view === 'left' || view === 'right';
  const flip = view === 'left';
  const legTop = torsoY + 7;

  // Pernas (por baixo de tudo).
  if (!side) {
    if (crouch) {
      const [a, b] = sneakWalk === 0 ? [1, 0] : sneakWalk === 1 ? [0, 1] : [0, 0];
      frontLeg(img, 2, legTop, 31, a, look);
      frontLeg(img, 10, legTop, 31, b, look);
    } else {
      const [a, b] = WALK_LIFTS[walk] ?? [0, 0];
      frontLeg(img, 3, legTop, 31, a, look);
      frontLeg(img, 9, legTop, 31, b, look);
    }
  } else {
    // De lado: a perna de trás e a da frente afastam-se ao andar.
    const spread = crouch ? [3, 8] : walk === 0 ? [3, 8] : walk === 2 ? [8, 3] : [5, 6];
    const [backX = 5, frontX = 6] = crouch && sneakWalk === 1 ? [8, 3] : spread;
    const legs = new Bitmap(W, H);
    sideLeg(legs, backX, legTop, 31, look, true);
    sideLeg(legs, frontX, legTop, 31, look, false);
    img.blit(flip ? mirror(legs) : legs, 0, 0);
  }

  // Tronco, mochila (de lado fica atrás), cabeça e braço (de lado fica à frente).
  const body = new Bitmap(W, H);
  if (side) paintGrid(body, PACK_SIDE, 0, torsoY, look);
  paintGrid(body, side ? TORSO.side : view === 'up' ? TORSO.up : TORSO.down, 0, torsoY, look);
  paintGrid(body, side ? HEAD.side : view === 'up' ? HEAD.up : HEAD.down, 0, headY, look);
  if (longHair)
    paintGrid(body, side ? LONG_HAIR.side : view === 'up' ? LONG_HAIR.up : LONG_HAIR.down, 0, headY, look);
  if (side && attack < 0) {
    const swing = walk === 0 ? 1 : walk === 2 ? -1 : 0;
    sideArm(body, 6 + swing, torsoY + 1, look);
  }
  // Ataque: o pau levanta-se e depois estende-se na direção em que olha.
  if (attack >= 0) {
    if (side) {
      if (attack === 0) stick(body, 7, torsoY + 1, 4, torsoY - 8);
      else stick(body, 9, torsoY + 3, 15, torsoY + 3);
      sideArm(body, attack === 0 ? 6 : 8, torsoY + 1, look);
    } else if (view === 'down') {
      if (attack === 0) stick(body, 13, torsoY + 4, 14, torsoY - 5);
      else stick(body, 13, torsoY + 5, 13, torsoY + 12);
    } else if (attack === 0) stick(body, 13, torsoY + 4, 14, torsoY - 6);
    else stick(body, 13, torsoY + 2, 13, torsoY - 8);
  }
  img.blit(flip ? mirror(body) : body, 0, 0);
  return img;
}

function mirror(src: Bitmap): Bitmap {
  const out = new Bitmap(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const a = src.data[i + 3] ?? 0;
      if (a === 0) continue;
      out.set(src.width - 1 - x, y, [src.data[i] ?? 0, src.data[i + 1] ?? 0, src.data[i + 2] ?? 0], a);
    }
  }
  return out;
}

function sheet(look: Look, longHair = false): Bitmap {
  const out = new Bitmap(W * COLUMNS, H * ROWS.length);
  ROWS.forEach((view, row) => {
    for (let column = 0; column < COLUMNS; column++)
      out.blit(frame(view, column, look, longHair), column * W, row * H);
  });
  return out;
}

// Validação das grelhas: todas com 16 colunas (um erro aqui estraga a personagem inteira).
for (const [name, rows] of Object.entries({ ...HEAD, ...TORSO, ...LONG_HAIR })) {
  rows.forEach((row, i) => {
    if (row.length !== W)
      throw new Error(`Grelha ${name}, linha ${String(i)}: ${String(row.length)} colunas`);
  });
}

const dir = new URL('public/assets/sprites/', ROOT);
mkdirSync(dir, { recursive: true });
const sheets: [string, Bitmap][] = [
  ['player', sheet(PLAYER)],
  ['player_girl', sheet(PLAYER_GIRL, true)],
];
for (const [name, img] of sheets) {
  writeFileSync(new URL(`${name}.png`, dir), img.toPng());
  console.log(`sprites/${name}.png (10×4 frames de 16×32)`);
}

const previewIndex = process.argv.indexOf('--preview');
const previewPath = previewIndex >= 0 ? process.argv[previewIndex + 1] : undefined;
if (previewPath) {
  const SCALE = 6;
  const first = sheets[0]?.[1];
  if (!first) throw new Error('sem personagens');
  const out = new Bitmap(first.width * SCALE, first.height * SCALE * sheets.length);
  out.fill(0, 0, out.width, out.height, c('grass'));
  sheets.forEach(([, img], i) => {
    out.blit(img, 0, i * first.height * SCALE, SCALE);
  });
  writeFileSync(previewPath, out.toPng());
  console.log(`pré-visualização: ${previewPath}`);
}

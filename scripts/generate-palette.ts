// Gera public/assets/palette.png a partir de src/assets/palette.json (CLAUDE.md §6.3):
// 8 × 4 amostras de 8 × 8 px, pela ordem do JSON. Para importar no Aseprite/LibreSprite.
// Uso: `npm run palette`.

import { readFileSync, writeFileSync } from 'node:fs';
import { Bitmap, hexToRgb } from './png.ts';

const ROOT = new URL('../', import.meta.url);
const COLUMNS = 8;
const SWATCH = 8;

const palette = JSON.parse(readFileSync(new URL('src/assets/palette.json', ROOT), 'utf8')) as Record<
  string,
  string
>;
const colors = Object.values(palette).map(hexToRgb);

const rows = Math.ceil(colors.length / COLUMNS);
const image = new Bitmap(COLUMNS * SWATCH, rows * SWATCH);
for (const [i, color] of colors.entries()) {
  image.fill((i % COLUMNS) * SWATCH, Math.floor(i / COLUMNS) * SWATCH, SWATCH, SWATCH, color);
}

writeFileSync(new URL('public/assets/palette.png', ROOT), image.toPng());
console.log(`palette.png: ${String(colors.length)} cores, ${String(image.width)}×${String(image.height)} px`);

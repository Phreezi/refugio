// Gera public/assets/palette.png a partir de src/assets/palette.json (CLAUDE.md §6.3):
// 8 × 4 amostras de 8 × 8 px, pela ordem do JSON. Para importar no Aseprite/LibreSprite.
// Uso: `npm run palette` (sem dependências: PNG escrito à mão com zlib do Node).

import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const ROOT = new URL('../', import.meta.url);
const COLUMNS = 8;
const SWATCH = 8;

const palette = JSON.parse(readFileSync(new URL('src/assets/palette.json', ROOT), 'utf8')) as Record<
  string,
  string
>;
const colors = Object.values(palette).map((hex) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff] as const;
});

const rows = Math.ceil(colors.length / COLUMNS);
const width = COLUMNS * SWATCH;
const height = rows * SWATCH;

// Cada linha: 1 byte de filtro (0 = nenhum) + RGB por píxel. Células vazias ficam pretas.
const raw = Buffer.alloc(height * (1 + width * 3));
for (let y = 0; y < height; y++) {
  const rowStart = y * (1 + width * 3);
  for (let x = 0; x < width; x++) {
    const color = colors[Math.floor(y / SWATCH) * COLUMNS + Math.floor(x / SWATCH)] ?? [0, 0, 0];
    raw.set(color, rowStart + 1 + x * 3);
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header.writeUInt8(8, 8); // bits por canal
header.writeUInt8(2, 9); // RGB
// compressão, filtro e interlace = 0 (já a zeros)

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = new URL('public/assets/palette.png', ROOT);
writeFileSync(out, png);
console.log(`palette.png: ${String(colors.length)} cores, ${String(width)}×${String(height)} px`);

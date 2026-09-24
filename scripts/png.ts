// Codificador PNG mínimo (RGBA 8 bits, sem dependências: zlib do Node).
// Usado pelos scripts que geram imagens (paleta, tilesets placeholder).

import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param rgba width × height × 4 bytes, linha a linha. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: tamanho do buffer errado');
  // Cada linha: 1 byte de filtro (0 = nenhum) + RGBA por píxel.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bits por canal
  header.writeUInt8(6, 9); // RGBA
  // compressão, filtro e interlace = 0 (já a zeros)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Imagem RGBA simples para desenhar píxel a píxel. */
export class Bitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, rgb: Rgb, alpha = 255): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = rgb[0];
    this.data[i + 1] = rgb[1];
    this.data[i + 2] = rgb[2];
    this.data[i + 3] = alpha;
  }

  /** Opacidade (0–255) do píxel; fora da imagem = 0. */
  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[(y * this.width + x) * 4 + 3] ?? 0;
  }

  /** Elipse cheia (centro e raios em píxeis; aceita meios píxeis). */
  ellipse(cx: number, cy: number, rx: number, ry: number, rgb: Rgb, alpha = 255): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, rgb, alpha);
      }
    }
  }

  /** Contorno de 1 px por fora de tudo o que é opaco (vizinhança de 4). */
  outline(rgb: Rgb): void {
    const edge: [number, number][] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.alpha(x, y) === 255) continue;
        const near = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ].some(([nx = 0, ny = 0]) => this.alpha(nx, ny) === 255);
        if (near) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) this.set(x, y, rgb);
  }

  /** Copia outra imagem para (ox, oy), ampliada `scale` vezes (vizinho mais próximo). */
  blit(src: Bitmap, ox: number, oy: number, scale = 1): void {
    for (let y = 0; y < src.height * scale; y++) {
      for (let x = 0; x < src.width * scale; x++) {
        const sx = Math.floor(x / scale);
        const sy = Math.floor(y / scale);
        const i = (sy * src.width + sx) * 4;
        const a = src.data[i + 3] ?? 0;
        if (a === 0) continue;
        this.set(ox + x, oy + y, [src.data[i] ?? 0, src.data[i + 1] ?? 0, src.data[i + 2] ?? 0], a);
      }
    }
  }

  fill(x: number, y: number, w: number, h: number, rgb: Rgb): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, rgb);
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.data);
  }
}

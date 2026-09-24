// Ajudas partilhadas pelos geradores de mapas das zonas (Tiled JSON, CLAUDE.md §8.4).
// Cada gerador desenha o terreno, coloca objetos e chama `write()`. Os mapas gerados são só o
// ponto de partida: depois editam-se no Tiled, por isso `write()` não substitui sem `--force`.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  BASE_TILES,
  BASE_TILESET_FILE,
  BASE_TILESET_NAME,
  baseTileIndex,
  type BaseTile,
} from '../src/world/tileset.ts';

export const TILE = 16;

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Placement {
  name: string;
  x: number;
  y: number;
}

export class MapBuilder {
  readonly w: number;
  readonly h: number;
  readonly random: () => number;
  readonly ground: (BaseTile | null)[];
  readonly collision: (BaseTile | null)[];
  /** Tiles onde não se espalham objetos (caminhos, casas, clareiras marcadas). */
  readonly reserved = new Set<number>();
  private readonly taken = new Set<number>();
  private readonly placements: Placement[] = [];
  private readonly points: Placement[] = [];

  constructor(w: number, h: number, seed: number) {
    this.w = w;
    this.h = h;
    this.random = rng(seed);
    this.ground = new Array<BaseTile | null>(w * h).fill('grass');
    this.collision = new Array<BaseTile | null>(w * h).fill(null);
  }

  at(x: number, y: number): number {
    return y * this.w + x;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  fill(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    tile: BaseTile,
    layer: 'ground' | 'collision' = 'ground',
  ): void {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.inside(x, y)) continue;
        (layer === 'ground' ? this.ground : this.collision)[this.at(x, y)] = tile;
        this.reserved.add(this.at(x, y));
      }
    }
  }

  /** Borda do mapa com `tile` (colisão), com aberturas nas saídas. */
  border(tile: BaseTile, gaps: readonly [number, number][]): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const edge = x === 0 || y === 0 || x === this.w - 1 || y === this.h - 1;
        if (edge && !gaps.some(([gx, gy]) => gx === x && gy === y)) this.collision[this.at(x, y)] = tile;
      }
    }
  }

  /** Caminho de terra (2 tiles de largura) de (x0,y0) a (x1,y1), com curvas aleatórias. */
  path(x0: number, y0: number, x1: number, y1: number): void {
    let x = x0;
    let y = y0;
    for (;;) {
      for (const [dx, dy] of [
        [0, 0],
        [0, 1],
        [1, 0],
      ] as const) {
        if (!this.inside(x + dx, y + dy)) continue;
        const i = this.at(x + dx, y + dy);
        if (this.collision[i] === null) this.ground[i] = 'dirt';
        this.reserved.add(i);
      }
      if (x === x1 && y === y1) break;
      if (x !== x1 && (y === y1 || this.random() < 0.6)) x += Math.sign(x1 - x);
      else y += Math.sign(y1 - y);
    }
  }

  /** Casa em ruínas: chão, paredes à volta e uma porta (abertura) a sul. */
  house(x0: number, y0: number, x1: number, y1: number, floor: BaseTile, doorX: number): void {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = this.at(x, y);
        this.ground[i] = floor;
        this.reserved.add(i);
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        const door = y === y1 && (x === doorX || x === doorX + 1);
        if (edge && !door) this.collision[i] = 'wall';
      }
    }
  }

  /** Flores soltas na relva. */
  flowers(chance: number): void {
    for (let i = 0; i < this.ground.length; i++) {
      if (this.ground[i] === 'grass' && !this.reserved.has(i) && this.random() < chance)
        this.ground[i] = 'grass_flowers';
    }
  }

  private free(x0: number, y0: number, x1: number, y1: number): boolean {
    if (x0 < 2 || y0 < 2 || x1 > this.w - 3 || y1 > this.h - 3) return false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = this.at(x, y);
        if (this.taken.has(i) || this.collision[i] !== null || this.reserved.has(i)) return false;
      }
    }
    return true;
  }

  private take(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.taken.add(this.at(x, y));
  }

  /** Objeto num tile exato (pés ao meio da base do tile); ocupa-o. */
  put(name: string, tx: number, ty: number): void {
    this.placements.push({ name, x: tx * TILE + TILE / 2, y: (ty + 1) * TILE - 2 });
    this.take(tx - 1, ty - 1, tx + 1, ty);
  }

  /** Ponto (player_spawn, exit, enemy_spawn) ao centro de um tile. */
  point(name: string, tx: number, ty: number): void {
    this.points.push({ name, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
    this.take(tx - 1, ty - 1, tx + 1, ty + 1);
  }

  /** Espalha `count` objetos por tiles livres. `avoid` = não pôr dentro deste retângulo. */
  scatter(
    name: string,
    count: number,
    clearance: number,
    hTiles = 1,
    avoid?: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    let placed = 0;
    for (let attempt = 0; placed < count && attempt < count * 400; attempt++) {
      const tx = 2 + Math.floor(this.random() * (this.w - 4));
      const ty = 2 + Math.floor(this.random() * (this.h - 4));
      if (avoid && tx >= avoid.x0 && tx <= avoid.x1 && ty >= avoid.y0 && ty <= avoid.y1) continue;
      if (!this.free(tx - clearance, ty - hTiles + 1 - clearance, tx + clearance, ty + clearance)) continue;
      this.take(tx, ty - hTiles + 1, tx, ty);
      this.placements.push({
        name,
        x: tx * TILE + 4 + Math.floor(this.random() * 9),
        y: (ty + 1) * TILE - 1 - Math.floor(this.random() * 4),
      });
      placed++;
    }
    if (placed < count) throw new Error(`Só coube ${String(placed)}/${String(count)} de ${name}`);
  }

  /** Escreve o JSON do Tiled (recusa substituir sem `--force`). */
  write(file: string): void {
    const out = new URL(`../public/assets/maps/${file}`, import.meta.url);
    if (existsSync(out) && !process.argv.includes('--force')) {
      console.error(`maps/${file} já existe (pode ter edições do Tiled). Usar --force para o substituir.`);
      process.exit(1);
    }
    const gid = (tile: BaseTile | null): number => (tile === null ? 0 : baseTileIndex(tile) + 1);
    let nextObjectId = 1;
    const obj = (p: Placement) => ({
      id: nextObjectId++,
      name: p.name,
      type: '',
      x: p.x,
      y: p.y,
      width: 0,
      height: 0,
      rotation: 0,
      point: true,
      visible: true,
    });
    const objects = [
      ...this.points.map(obj),
      ...this.placements.sort((a, b) => a.y - b.y || a.x - b.x).map(obj),
    ];
    let nextLayerId = 1;
    const tileLayer = (name: string, data: readonly (BaseTile | null)[]) => ({
      id: nextLayerId++,
      name,
      type: 'tilelayer',
      x: 0,
      y: 0,
      width: this.w,
      height: this.h,
      opacity: 1,
      visible: true,
      data: data.map(gid),
    });
    const empty = new Array<BaseTile | null>(this.w * this.h).fill(null);
    const map = {
      type: 'map',
      version: '1.10',
      tiledversion: '1.11.2',
      orientation: 'orthogonal',
      renderorder: 'right-down',
      infinite: false,
      compressionlevel: -1,
      width: this.w,
      height: this.h,
      tilewidth: TILE,
      tileheight: TILE,
      layers: [
        tileLayer('ground', this.ground),
        tileLayer('decor_low', empty),
        tileLayer('collision', this.collision),
        tileLayer('decor_high', empty),
        {
          id: nextLayerId++,
          name: 'objects',
          type: 'objectgroup',
          draworder: 'topdown',
          x: 0,
          y: 0,
          opacity: 1,
          visible: true,
          objects,
        },
      ],
      tilesets: [
        {
          firstgid: 1,
          name: BASE_TILESET_NAME,
          image: `../${BASE_TILESET_FILE}`,
          imagewidth: TILE * BASE_TILES.length,
          imageheight: TILE,
          tilewidth: TILE,
          tileheight: TILE,
          tilecount: BASE_TILES.length,
          columns: BASE_TILES.length,
          margin: 0,
          spacing: 0,
        },
      ],
      nextlayerid: nextLayerId,
      nextobjectid: nextObjectId,
    };
    mkdirSync(new URL('./', out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(map)}\n`);
    console.log(`maps/${file}: ${String(this.w)}×${String(this.h)} tiles, ${String(objects.length)} objetos`);
  }
}

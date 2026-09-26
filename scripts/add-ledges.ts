// Degraus (estilo Pokémon, pedido do jogador: "algumas zonas posso pular para baixo mas não posso
// subir"): em cada Caminho do mundo contínuo põe 1–2 degraus (tile `ledge` na camada collision:
// só bloqueia quem sobe) que cortam parte do caminho — a descer são um atalho; a subir dá-se a
// volta. Confirma que continua a dar para subir e descer o Caminho todo; se não, tira o degrau.
// Também atualiza o tileset embebido de todos os mapas (tiles acrescentados no fim).
// Uso: `npm run map:ledges` (uma vez; os Caminhos que já têm degraus ficam como estão).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE_TILES, baseTileIndex } from '../src/world/tileset.ts';

const MAPS = new URL('../public/assets/maps/', import.meta.url);
const SIZE = 16;

interface TiledMap {
  width: number;
  height: number;
  layers: {
    name: string;
    type: string;
    data?: number[];
    objects?: { name: string; x: number; y: number }[];
  }[];
  tilesets: { firstgid: number; tilecount: number; columns: number; imagewidth: number }[];
}
const load = (file: string): TiledMap => JSON.parse(readFileSync(new URL(file, MAPS), 'utf8')) as TiledMap;
const save = (file: string, map: TiledMap): void => {
  writeFileSync(new URL(file, MAPS), JSON.stringify(map));
};

// 1) Tileset embebido de todos os mapas.
for (const file of readdirSync(MAPS).filter((f) => f.endsWith('.json'))) {
  const map = load(file);
  const ts = map.tilesets[0];
  if (!ts || ts.tilecount === BASE_TILES.length) continue;
  ts.tilecount = BASE_TILES.length;
  ts.columns = BASE_TILES.length;
  ts.imagewidth = BASE_TILES.length * SIZE;
  save(file, map);
}

const LEDGE = baseTileIndex('ledge') + 1;

/**
 * Dá para ir de uma borda à outra? Movimento em 4 direções; num degrau só se entra de cima
 * (a descer). `from`/`to`: 'south' = linha de baixo, 'north' = linha de cima.
 */
function crosses(w: number, h: number, collision: readonly number[], from: 'south' | 'north'): boolean {
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  const seen = new Uint8Array(w * h);
  const queue: [number, number][] = [];
  const startY = from === 'south' ? h - 1 : 0;
  const goalY = from === 'south' ? 0 : h - 1;
  for (let x = 0; x < w; x++)
    if (collision[startY * w + x] === 0) {
      seen[startY * w + x] = 1;
      queue.push([x, startY]);
    }
  while (queue.length > 0) {
    const [x, y] = queue.shift() ?? [0, 0];
    if (y === goalY) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!open(nx, ny)) continue;
      const i = ny * w + nx;
      if (seen[i]) continue;
      const tile = collision[i] ?? 0;
      if (tile !== 0 && !(tile === LEDGE && dy === 1)) continue;
      seen[i] = 1;
      queue.push([nx, ny]);
    }
  }
  return false;
}

// 2) Degraus nos Caminhos.
for (const file of readdirSync(MAPS).filter((f) => /^route_\d+\.json$/.test(f))) {
  const map = load(file);
  const collision = map.layers.find((l) => l.name === 'collision')?.data;
  if (!collision || collision.includes(LEDGE)) continue;
  const objects = map.layers.find((l) => l.type === 'objectgroup')?.objects ?? [];
  const { width: w, height: h } = map;
  const near = (tx: number, ty: number): boolean =>
    objects.some((o) => Math.abs(o.x / SIZE - (tx + 0.5)) < 1.5 && Math.abs(o.y / SIZE - (ty + 0.5)) < 1.5);
  let placed = 0;
  // Linhas candidatas (longe das bordas), de cima para baixo, com espaço à volta.
  for (let ty = 6; ty < h - 6 && placed < 2; ty += 1) {
    let run: number[] = [];
    let best: number[] = [];
    for (let tx = 1; tx < w - 1; tx++) {
      const ok =
        collision[ty * w + tx] === 0 &&
        collision[(ty - 1) * w + tx] === 0 &&
        collision[(ty + 1) * w + tx] === 0 &&
        !near(tx, ty);
      if (ok) run.push(tx);
      else run = [];
      if (run.length > best.length) best = [...run];
    }
    if (best.length < 8) continue;
    // Um degrau de 5–7 tiles a meio do troço livre (fica sempre espaço para dar a volta).
    const length = Math.min(7, best.length - 3);
    const start = best[Math.floor((best.length - length) / 2)] ?? 0;
    for (let tx = start; tx < start + length; tx++) collision[ty * w + tx] = LEDGE;
    if (crosses(w, h, collision, 'south') && crosses(w, h, collision, 'north')) {
      placed++;
      ty += 12; // o próximo degrau mais abaixo
    } else {
      for (let tx = start; tx < start + length; tx++) collision[ty * w + tx] = 0;
    }
  }
  if (placed > 0) {
    save(file, map);
    console.log(`${file}: ${String(placed)} degrau(s)`);
  }
}

// Tileset placeholder da base (CLAUDE.md §6.2). Módulo puro: também é usado por scripts/
// (generate-tiles.ts, generate-base-map.ts, validate-data.ts), por isso não importa nada em runtime.

/** Nome do tileset dentro dos mapas Tiled (o Phaser liga-o à textura com a mesma chave). */
export const BASE_TILESET_NAME = 'base_tiles';

/** Ficheiro do tileset, relativo a `public/assets/`. */
export const BASE_TILESET_FILE = 'tiles/base_tiles.png';

/**
 * Tiles pela ordem em que aparecem no PNG (uma linha, 16 px cada). O índice é o id local do
 * tile no Tiled (gid = firstgid + índice). Acrescentar sempre no fim, para não baralhar mapas.
 */
export const BASE_TILES = [
  'grass',
  'grass_flowers',
  'dirt',
  'sand',
  'water',
  'road',
  'floor_wood',
  'floor_concrete',
  'wall',
  'fence',
  'boulder',
] as const;

export type BaseTile = (typeof BASE_TILES)[number];

/** Id local (0…n-1) de um tile do tileset da base. */
export function baseTileIndex(tile: BaseTile): number {
  return BASE_TILES.indexOf(tile);
}

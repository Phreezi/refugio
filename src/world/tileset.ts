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
  // Fase 10: bunker (chão escuro e escadas; as escadas marcam as saídas entre pisos).
  'floor_dark',
  'stairs_down',
  'stairs_up',
  // Divisórias naturais (em vez de cercas): monte de terra com erva, rochas, tronco caído,
  // cascata e penhasco. Todos bloqueiam na camada `collision`.
  'mound',
  'rocks',
  'log',
  'waterfall',
  'cliff',
  // Degrau (estilo Pokémon): só se passa a descer (para sul). Entrada de caverna (chão escuro).
  'ledge',
  'cave_mouth',
] as const;

export type BaseTile = (typeof BASE_TILES)[number];

/** Id local (0…n-1) de um tile do tileset da base. */
export function baseTileIndex(tile: BaseTile): number {
  return BASE_TILES.indexOf(tile);
}

/** Tiles da camada `collision` que só bloqueiam a subir (degraus: salta-se para baixo). */
export const BASE_LEDGE_TILES: readonly BaseTile[] = ['ledge'];

/** Tiles do chão que contam como fundação (o chão da casa em ruínas, CLAUDE.md §7.7). */
export const BASE_FLOOR_TILES: readonly BaseTile[] = ['floor_wood', 'floor_concrete'];

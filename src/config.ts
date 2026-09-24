// Constantes globais de motor e ecrã. Valores de balanceamento NÃO vêm para aqui
// (vão para src/data/balance.json, Fase 2).

/** Tamanho de um tile, em píxeis de jogo. */
export const TILE_SIZE = 16;

/** Resolução interna (16:9), escalada por inteiros em píxeis do dispositivo. */
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

/** Passo fixo da lógica: 50 ms = 20 ticks/s (CLAUDE.md §5.2). */
export const FIXED_STEP_MS = 50;

/** Máximo de ticks por frame; o atraso acima disto é descartado (evita a "espiral da morte"). */
export const MAX_STEPS_PER_FRAME = 5;

/** Caixa de colisão do jogador (px), centrada nos pés: só a base do corpo bate nas coisas. */
export const PLAYER_FOOTPRINT = { width: 10, height: 6 } as const;

/** Mapa Tiled da base, relativo a `public/assets/`. */
export const BASE_MAP_FILE = 'maps/base.json';

/** Chave do mapa da base na cache de tilemaps do Phaser. */
export const BASE_MAP_KEY = 'map_base';

/** Caminho do manifest de assets, relativo ao index.html. */
export const ASSET_MANIFEST_URL = 'assets/manifest.json';

/** Parâmetro de URL que mostra o overlay de debug ao arrancar (ex.: `?debug`), útil no telemóvel. */
export const DEBUG_QUERY_PARAM = 'debug';

/** Parâmetro de URL para forçar a língua (ex.: `?lang=en`), até existirem definições (Fase 11). */
export const LANGUAGE_QUERY_PARAM = 'lang';

import Phaser from 'phaser';
import type { AssetManifest } from '../assets/manifest';
import { PALETTE, paletteNumber } from '../assets/palette';
import { ensurePlaceholderTextures } from '../assets/placeholders';
import { BASE_MAP_FILE, BASE_MAP_KEY, TILE_SIZE } from '../config';
import { BASE_ZONE_ID } from '../core/GameState';
import resourcesJson from '../data/resources.json';
import { parseResources } from '../data/types';
import { t } from '../i18n';
import { content } from '../world/content';
import { BASE_TILES, BASE_TILESET_NAME } from '../world/tileset';
import { parseZoneMap } from '../world/zoneMap';
import { showFatalError } from '../ui/fatalError';
import { SceneKey } from './keys';

export interface PreloadSceneData {
  manifest: AssetManifest;
}

const BAR_WIDTH = 160;
const BAR_HEIGHT = 6;

/**
 * Carrega os ficheiros listados no manifest e, no fim, gera placeholders para
 * todas as chaves sem textura (sem ficheiro, 404, ou ficheiro inválido).
 */
export class PreloadScene extends Phaser.Scene {
  private manifest: AssetManifest | null = null;

  constructor() {
    super(SceneKey.Preload);
  }

  init(data: Partial<PreloadSceneData>): void {
    this.manifest = data.manifest ?? null;
  }

  preload(): void {
    const { width, height } = this.scale;
    const x = Math.round((width - BAR_WIDTH) / 2);
    const y = Math.round(height / 2);
    this.add
      .text(Math.round(width / 2), y - 16, t('boot.loading'), {
        fontFamily: 'monospace',
        fontSize: 8,
        color: PALETTE.parchment,
      })
      .setOrigin(0.5, 0);
    this.add.rectangle(x, y, BAR_WIDTH, BAR_HEIGHT, paletteNumber('shadow')).setOrigin(0);
    const bar = this.add.rectangle(x, y, 0, BAR_HEIGHT, paletteNumber('amber')).setOrigin(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, (progress: number) => {
      bar.width = Math.round(BAR_WIDTH * progress);
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[assets] "${file.key}" falhou (${file.src}) — a usar placeholder.`);
    });

    if (!this.manifest) return;
    this.load.setPath('assets/');
    for (const [key, entry] of Object.entries(this.manifest.assets)) {
      if (entry.file === undefined) continue;
      if (entry.type === 'image') this.load.image(key, entry.file);
      else
        this.load.spritesheet(key, entry.file, {
          frameWidth: entry.frameWidth,
          frameHeight: entry.frameHeight,
        });
    }
    this.load.tilemapTiledJSON(BASE_MAP_KEY, BASE_MAP_FILE);
  }

  create(): void {
    try {
      if (!this.manifest) throw new Error('PreloadScene iniciada sem manifest.');
      const generated = ensurePlaceholderTextures(this.textures, this.manifest);
      this.loadContent(this.manifest);
      if (import.meta.env.DEV && generated.length > 0) {
        console.info(`[assets] ${String(generated.length)} placeholders gerados por código.`);
      }
      this.scene.start(SceneKey.MainMenu, {});
    } catch (error) {
      showFatalError(this, error);
    }
  }

  /** Valida o conteúdo data-driven (recursos, mapas) e deixa-o pronto para as cenas. */
  private loadContent(manifest: AssetManifest): void {
    const resources = parseResources(resourcesJson, Object.keys(manifest.assets));
    content.setResources(resources);

    const cached: unknown = this.cache.tilemap.get(BASE_MAP_KEY);
    const data = typeof cached === 'object' && cached !== null && 'data' in cached ? cached.data : undefined;
    if (data === undefined) throw new Error(`Não foi possível carregar ${BASE_MAP_FILE}.`);
    const map = parseZoneMap(
      data,
      {
        tileSize: TILE_SIZE,
        tilesets: { [BASE_TILESET_NAME]: BASE_TILES.length },
        resourceIds: Object.keys(resources),
      },
      BASE_MAP_FILE,
    );
    content.setZoneMap(BASE_ZONE_ID, map);
  }
}

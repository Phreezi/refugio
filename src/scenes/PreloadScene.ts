import Phaser from 'phaser';
import type { AssetManifest } from '../assets/manifest';
import { PALETTE, paletteNumber } from '../assets/palette';
import { ensurePlaceholderTextures } from '../assets/placeholders';
import { t } from '../i18n';
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
      if (entry.file !== undefined) this.load.image(key, entry.file);
    }
  }

  create(): void {
    try {
      if (!this.manifest) throw new Error('PreloadScene iniciada sem manifest.');
      const generated = ensurePlaceholderTextures(this.textures, this.manifest);
      if (import.meta.env.DEV && generated.length > 0) {
        console.info(`[assets] ${String(generated.length)} placeholders gerados por código.`);
      }
      this.scene.start(SceneKey.MainMenu, {});
    } catch (error) {
      showFatalError(this, error);
    }
  }
}

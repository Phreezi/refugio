import Phaser from 'phaser';
import { parseManifest } from '../assets/manifest';
import { PALETTE_NAMES } from '../assets/palette';
import { ASSET_MANIFEST_URL } from '../config';
import { showFatalError } from '../ui/fatalError';
import { SceneKey } from './keys';
import type { PreloadSceneData } from './PreloadScene';

const MANIFEST_CACHE_KEY = 'asset_manifest';

/** Carrega e valida o manifest de assets; passa-o ao PreloadScene. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  preload(): void {
    this.load.json(MANIFEST_CACHE_KEY, ASSET_MANIFEST_URL);
  }

  create(): void {
    try {
      if (!this.cache.json.exists(MANIFEST_CACHE_KEY)) {
        throw new Error(`Não foi possível carregar ${ASSET_MANIFEST_URL}.`);
      }
      const raw: unknown = this.cache.json.get(MANIFEST_CACHE_KEY);
      const data: PreloadSceneData = { manifest: parseManifest(raw, PALETTE_NAMES) };
      this.scene.start(SceneKey.Preload, data);
    } catch (error) {
      showFatalError(this, error);
    }
  }
}

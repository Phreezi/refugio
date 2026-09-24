import type Phaser from 'phaser';
import { PALETTE } from '../assets/palette';
import { getView, setupFixedCamera } from '../display/view';
import { t } from '../i18n';
import { Label } from './text';

/**
 * Mostra um erro de arranque no próprio ecrã do jogo (útil no telemóvel, sem consola)
 * e regista-o na consola com a stack completa.
 */
export function showFatalError(scene: Phaser.Scene, error: unknown): void {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  setupFixedCamera(scene.cameras.main);
  scene.cameras.main.setBackgroundColor(PALETTE.blood);
  new Label(scene, 8, 8, `${t('boot.error')}\n\n${message}`, { size: 8, wrap: getView().width - 16 });
}

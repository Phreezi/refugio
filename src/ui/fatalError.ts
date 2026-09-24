import type Phaser from 'phaser';
import { PALETTE } from '../assets/palette';
import { t } from '../i18n';

/**
 * Mostra um erro de arranque no próprio ecrã do jogo (útil no telemóvel, sem consola)
 * e regista-o na consola com a stack completa.
 */
export function showFatalError(scene: Phaser.Scene, error: unknown): void {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  scene.cameras.main.setBackgroundColor(PALETTE.blood);
  scene.add.text(8, 8, `${t('boot.error')}\n\n${message}`, {
    fontFamily: 'monospace',
    fontSize: 8,
    color: PALETTE.cream,
    wordWrap: { width: scene.scale.width - 16 },
  });
}

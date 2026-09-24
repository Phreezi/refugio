import Phaser from 'phaser';
import { SceneKey } from './keys';

/**
 * HUD por cima da cena de jogo (corre em paralelo com Base/Zona).
 * Fase 2: barras de vida/fome/sede e relógio do dia.
 */
export class UIScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.UI);
  }

  create(): void {
    // Ainda sem HUD na Fase 0 — a cena existe para fixar a arquitetura (Base + UI).
  }
}

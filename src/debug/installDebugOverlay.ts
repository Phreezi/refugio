import type Phaser from 'phaser';
import { gameState } from '../core/GameState';
import type { PixelScaling } from '../display/installPixelScaling';
import { DebugOverlay } from './DebugOverlay';

const TOGGLE_KEY = 'F3';

/** Cria o overlay de debug e liga-o à tecla F3 (em qualquer cena, incluindo o menu). */
export function installDebugOverlay(
  game: Phaser.Game,
  scaling: PixelScaling,
  startVisible: boolean,
): DebugOverlay {
  const overlay = new DebugOverlay(() => ({
    fps: game.loop.actualFps,
    tick: gameState.hasGame ? gameState.data.world.tick : null,
    player: gameState.hasGame ? { x: gameState.data.player.x, y: gameState.data.player.y } : null,
    scenes: game.scene.getScenes(true).map((scene) => scene.scene.key),
    deviceZoom: scaling.current.deviceZoom,
    devicePixelRatio: scaling.devicePixelRatio,
    gameWidth: scaling.current.gameWidth,
    gameHeight: scaling.current.gameHeight,
  }));

  window.addEventListener('keydown', (event) => {
    if (event.code !== TOGGLE_KEY || event.repeat) return;
    event.preventDefault(); // F3 abre a pesquisa no browser; o Phaser não usa esta tecla
    overlay.toggle();
  });

  if (startVisible) overlay.show();
  return overlay;
}

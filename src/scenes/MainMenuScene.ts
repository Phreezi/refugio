import Phaser from 'phaser';
import { PALETTE, paletteNumber } from '../assets/palette';
import { eventBus } from '../core/EventBus';
import { BASE_ZONE_ID, gameState } from '../core/GameState';
import { t } from '../i18n';
import { content } from '../world/content';
import { SceneKey } from './keys';

const BUTTON_WIDTH = 112;
const BUTTON_HEIGHT = 22;

/** Menu inicial: título e botão "Novo jogo" (rato, toque, Enter ou Espaço). */
export class MainMenuScene extends Phaser.Scene {
  private starting = false;

  constructor() {
    super(SceneKey.MainMenu);
  }

  create(): void {
    this.starting = false;
    const { width, height } = this.scale;
    const cx = Math.round(width / 2);
    this.cameras.main.setBackgroundColor(PALETTE.night);

    this.add
      .text(cx, 64, t('game.title'), { fontFamily: 'monospace', fontSize: 32, color: PALETTE.wheat })
      .setOrigin(0.5, 0);

    this.createButton(cx, 150, t('menu.new_game'), () => {
      this.startNewGame();
    });

    this.add
      .text(cx, height - 36, t('menu.hint'), {
        fontFamily: 'monospace',
        fontSize: 8,
        color: PALETTE.stone_light,
      })
      .setOrigin(0.5, 0);
    this.add
      .text(width - 4, height - 12, `v${__APP_VERSION__} · ${__BUILD_ID__}`, {
        fontFamily: 'monospace',
        fontSize: 8,
        color: PALETTE.stone,
      })
      .setOrigin(1, 0);

    // Eventos nomeados (sem addKey) não capturam as teclas globalmente.
    this.input.keyboard?.on('keydown-ENTER', () => {
      this.startNewGame();
    });
    this.input.keyboard?.on('keydown-SPACE', () => {
      this.startNewGame();
    });
  }

  /**
   * Botão feito de dois retângulos (contorno + fundo), com tamanhos pares e centro
   * inteiro: as Shapes não são arredondadas ao píxel pelo Phaser 4.
   */
  private createButton(x: number, y: number, label: string, onClick: () => void): void {
    this.add.rectangle(x, y, BUTTON_WIDTH + 2, BUTTON_HEIGHT + 2, paletteNumber('bark_dark'));
    const fill = this.add.rectangle(x, y, BUTTON_WIDTH, BUTTON_HEIGHT, paletteNumber('wood'));
    this.add
      .text(x, y, label, { fontFamily: 'monospace', fontSize: 12, color: PALETTE.cream })
      .setOrigin(0.5);

    // Só conta como clique se o toque começar E acabar no botão.
    let pressed = false;
    fill
      .setInteractive({ useHandCursor: true })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => fill.setFillStyle(paletteNumber('wood_light')))
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
        pressed = false;
        fill.setFillStyle(paletteNumber('wood'));
      })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
        pressed = true;
      })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        if (pressed) onClick();
        pressed = false;
      });
  }

  private startNewGame(): void {
    // Enter com a tecla presa repete o evento; só o primeiro conta.
    if (this.starting) return;
    this.starting = true;
    const state = gameState.newGame(content.zoneMap(BASE_ZONE_ID).playerSpawn);
    eventBus.emit('game:started', { zoneId: state.player.zoneId });
    this.scene.start(SceneKey.Base, {});
  }
}

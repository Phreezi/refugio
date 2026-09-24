import Phaser from 'phaser';
import { PALETTE } from './assets/palette';
import { DEBUG_QUERY_PARAM, GAME_HEIGHT, GAME_WIDTH, LANGUAGE_QUERY_PARAM } from './config';
import { installDebugOverlay } from './debug/installDebugOverlay';
import { installOrientationNotice } from './display/orientationNotice';
import { installPixelScaling } from './display/installPixelScaling';
import { getLanguage, isLanguage, setLanguage, t } from './i18n';
import { BaseScene } from './scenes/BaseScene';
import { BootScene } from './scenes/BootScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { PreloadScene } from './scenes/PreloadScene';
import { UIScene } from './scenes/UIScene';

const params = new URLSearchParams(window.location.search);
const language = params.get(LANGUAGE_QUERY_PARAM);
if (language !== null && isLanguage(language)) setLanguage(language);
document.documentElement.lang = getLanguage();

const host = document.getElementById('game');
if (!host) throw new Error('index.html sem o elemento #game.');

const game = new Phaser.Game({
  type: Phaser.AUTO,
  title: 'Refúgio',
  version: __APP_VERSION__,
  parent: host,
  backgroundColor: PALETTE.ink,
  // antialias desligado + roundPixels: cada píxel de jogo fica alinhado à grelha (Pixel Art Guide).
  pixelArt: true,
  scale: {
    // Sem modo automático: installPixelScaling aplica a escala inteira em píxeis do dispositivo.
    mode: Phaser.Scale.NONE,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    autoRound: false,
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  disableContextMenu: true,
  scene: [BootScene, PreloadScene, MainMenuScene, BaseScene, UIScene],
});

const scaling = installPixelScaling(game, host);
installDebugOverlay(game, scaling, params.has(DEBUG_QUERY_PARAM));

const rotateNotice = document.getElementById('rotate-notice');
if (rotateNotice) installOrientationNotice(game, rotateNotice, t('display.rotate'));

import Phaser from 'phaser';
import { PALETTE } from './assets/palette';
import { DEBUG_QUERY_PARAM, LANGUAGE_QUERY_PARAM } from './config';
import { installDebugOverlay } from './debug/installDebugOverlay';
import { installPixelScaling, measurePixelScale } from './display/installPixelScaling';
import { getLanguage, isLanguage, setLanguage } from './i18n';
import { WorldMapScene } from './scenes/WorldMapScene';
import { ZoneScene } from './scenes/ZoneScene';
import { BootScene } from './scenes/BootScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { PreloadScene } from './scenes/PreloadScene';
import { UIScene } from './scenes/UIScene';
import { installSaveOnHide } from './save';
import { preferences } from './ui/preferences';
import { installSfx } from './audio/sfx';
import { installRuntimeErrors } from './ui/runtimeErrors';

installRuntimeErrors();

const params = new URLSearchParams(window.location.search);
const language = params.get(LANGUAGE_QUERY_PARAM);
// ?lang= manda (testes); senão, a língua escolhida nas definições.
setLanguage(language !== null && isLanguage(language) ? language : preferences().language);
document.documentElement.lang = getLanguage();

const host = document.getElementById('game');
if (!host) throw new Error('index.html sem o elemento #game.');

// O jogo já nasce com a resolução certa para este ecrã (depois, installPixelScaling acompanha).
const initial = measurePixelScale(host);

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
    // O canvas tem a resolução do dispositivo; as câmaras ampliam o mundo (src/display/view.ts).
    width: initial.canvasWidth,
    height: initial.canvasHeight,
    autoRound: false,
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  disableContextMenu: true,
  // Os sons são sintetizados à parte (src/audio/sfx.ts): o Phaser não precisa de áudio.
  audio: { noAudio: true },
  scene: [BootScene, PreloadScene, MainMenuScene, ZoneScene, WorldMapScene, UIScene],
});

const scaling = installPixelScaling(game, host);
installDebugOverlay(game, scaling, params.has(DEBUG_QUERY_PARAM));

installSaveOnHide();
installSfx();

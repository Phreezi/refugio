import Phaser from 'phaser';
import { paletteNumber, type PaletteColor } from '../assets/palette';
import { clockAt } from '../core/Clock';
import { eventBus } from '../core/EventBus';
import { gameState, type PlayerState } from '../core/GameState';
import { BALANCE } from '../data/balance';
import { getView, setupFixedCamera } from '../display/view';
import { t, type MessageKey } from '../i18n';
import { readJoystick } from '../input/joystick';
import { moveInput } from '../input/moveInput';
import { Label } from '../ui/text';
import { SceneKey } from './keys';

/** Raio do joystick virtual e do manípulo, em píxeis de jogo. */
const JOYSTICK_RADIUS = 24;
const KNOB_RADIUS = 10;
/** Fração do raio sem movimento (evita andar com um toque acidental). */
const JOYSTICK_DEAD_ZONE = 0.25;
/** Margem entre o joystick em repouso e os cantos do ecrã. */
const JOYSTICK_MARGIN = 12;
const IDLE_ALPHA = 0.35;
const ACTIVE_ALPHA = 0.7;
/** Ponteiros em simultâneo: rato + 2 dedos (joystick agora, botão de ação na Fase 3). */
const TOUCH_POINTERS = 2;

/** Barras do HUD (px de jogo; pares, porque as Shapes não são arredondadas). */
const HUD_MARGIN = 6;
const BAR_X = 34;
const BAR_WIDTH = 60;
const BAR_HEIGHT = 6;
const BAR_SPACING = 11;
/** Piscar das barras abaixo de BALANCE.lowStatPct (CLAUDE.md §2: aviso aos 30%). */
const BLINK_MS = 400;
const DEATH_NOTICE_MS = 3500;

interface StatBar {
  key: keyof Pick<PlayerState, 'hp' | 'hunger' | 'thirst'>;
  label: Label;
  fill: Phaser.GameObjects.Rectangle;
}

const STATS: readonly { key: StatBar['key']; label: MessageKey; color: PaletteColor }[] = [
  { key: 'hp', label: 'hud.hp', color: 'red' },
  { key: 'hunger', label: 'hud.hunger', color: 'amber' },
  { key: 'thirst', label: 'hud.thirst', color: 'sky' },
];

/**
 * HUD por cima da cena de jogo (corre em paralelo com Base/Zona): vida, fome, sede, relógio
 * do dia e joystick virtual (só toque).
 */
export class UIScene extends Phaser.Scene {
  private joystickPointer: number | null = null;
  private joystickCenter = { x: 0, y: 0 };
  private joystickBase: Phaser.GameObjects.Arc | null = null;
  private joystickKnob: Phaser.GameObjects.Arc | null = null;
  private bars: StatBar[] = [];
  private clock: Label | null = null;
  private notice: Label | null = null;

  constructor() {
    super(SceneKey.UI);
  }

  create(): void {
    this.joystickPointer = null;
    setupFixedCamera(this.cameras.main);
    this.createBars();
    const { width, height } = getView();
    this.clock = new Label(
      this,
      width - HUD_MARGIN,
      HUD_MARGIN,
      '',
      { size: 8, color: 'cream', bold: true },
      [1, 0],
    );
    this.notice = new Label(
      this,
      Math.round(width / 2),
      Math.round(height * 0.3),
      t('hud.died'),
      {
        size: 10,
        color: 'wheat',
        bold: true,
      },
      [0.5, 0.5],
    ).setVisible(false);
    this.createJoystick();

    const offDied = eventBus.on('player:died', () => {
      this.notice?.setVisible(true);
      this.time.delayedCall(DEATH_NOTICE_MS, () => this.notice?.setVisible(false));
    });
    // Mudou a resolução ou o zoom: refazer o HUD com a vista nova.
    const onResize = (): void => {
      this.scene.restart({});
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offDied();
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      moveInput.joystick = { x: 0, y: 0 };
      this.joystickBase = null;
      this.joystickKnob = null;
      this.bars = [];
      this.clock = null;
      this.notice = null;
    });
  }

  override update(time: number): void {
    if (!gameState.hasGame) return;
    const { player, world } = gameState.data;
    const low = (BALANCE.statMax * BALANCE.lowStatPct) / 100;
    const blinkOff = Math.floor(time / BLINK_MS) % 2 === 1;
    for (const bar of this.bars) {
      const value = player[bar.key];
      bar.fill.width = Math.round((BAR_WIDTH * value) / BALANCE.statMax);
      const warn = value <= low;
      bar.fill.setAlpha(warn && blinkOff ? 0.35 : 1);
      bar.label.setColor(warn ? 'gold' : 'cream');
    }
    const clock = clockAt(world.tick, BALANCE.dayLengthSec, BALANCE.dayStartHour);
    const pad = (n: number): string => String(n).padStart(2, '0');
    this.clock?.setText(t('hud.clock', { day: clock.day, time: `${pad(clock.hour)}:${pad(clock.minute)}` }));
  }

  private createBars(): void {
    this.bars = STATS.map((stat, i) => {
      const y = HUD_MARGIN + i * BAR_SPACING;
      const label = new Label(this, HUD_MARGIN, y - 1, t(stat.label), {
        size: 7,
        color: 'cream',
        bold: true,
      });
      // Contorno (retângulo maior por trás), fundo e enchimento; origem 0 e posições inteiras.
      this.add.rectangle(BAR_X - 1, y - 1, BAR_WIDTH + 2, BAR_HEIGHT + 2, paletteNumber('ink')).setOrigin(0);
      this.add.rectangle(BAR_X, y, BAR_WIDTH, BAR_HEIGHT, paletteNumber('shadow')).setOrigin(0);
      const fill = this.add
        .rectangle(BAR_X, y, BAR_WIDTH, BAR_HEIGHT, paletteNumber(stat.color))
        .setOrigin(0);
      return { key: stat.key, label, fill };
    });
  }

  /**
   * Joystick flutuante: aparece onde o dedo toca na metade esquerda do ecrã.
   * Em dispositivos com toque fica visível (esbatido) no canto, para se saber que existe.
   */
  private createJoystick(): void {
    if (this.input.manager.pointersTotal < TOUCH_POINTERS + 1) this.input.addPointer(TOUCH_POINTERS);

    this.joystickBase = this.add.circle(0, 0, JOYSTICK_RADIUS, paletteNumber('ink'));
    this.joystickKnob = this.add.circle(0, 0, KNOB_RADIUS, paletteNumber('cream'));
    this.placeJoystick(this.restPosition());
    this.setJoystickVisible(this.sys.game.device.input.touch, IDLE_ALPHA);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch || this.joystickPointer !== null) return;
      const p = this.toGame(pointer);
      if (p.x >= getView().width / 2) return; // metade direita: botão de ação (Fase 3)
      this.joystickPointer = pointer.id;
      this.placeJoystick(this.clampToScreen(p.x, p.y));
      this.setJoystickVisible(true, ACTIVE_ALPHA);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joystickPointer) return;
      const p = this.toGame(pointer);
      const center = this.joystickCenter;
      const reading = readJoystick(p.x - center.x, p.y - center.y, JOYSTICK_RADIUS, JOYSTICK_DEAD_ZONE);
      this.joystickKnob?.setPosition(center.x + reading.knob.x, center.y + reading.knob.y);
      moveInput.joystick = reading.direction;
    });
    const release = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.id !== this.joystickPointer) return;
      this.joystickPointer = null;
      moveInput.joystick = { x: 0, y: 0 };
      this.placeJoystick(this.restPosition());
      this.setJoystickVisible(true, IDLE_ALPHA);
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, release);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, release);
  }

  /** Coordenadas do ponteiro em píxeis de jogo (o canvas está em píxeis do dispositivo). */
  private toGame(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: point.x, y: point.y };
  }

  private restPosition(): { x: number; y: number } {
    const offset = JOYSTICK_MARGIN + JOYSTICK_RADIUS;
    return { x: offset, y: getView().height - offset };
  }

  /** O joystick nunca fica cortado pelos bordos do ecrã. */
  private clampToScreen(x: number, y: number): { x: number; y: number } {
    const r = JOYSTICK_RADIUS;
    const { width, height } = getView();
    return {
      x: Phaser.Math.Clamp(Math.round(x), r, width - r),
      y: Phaser.Math.Clamp(Math.round(y), r, height - r),
    };
  }

  private placeJoystick(center: { x: number; y: number }): void {
    this.joystickCenter = center;
    this.joystickBase?.setPosition(center.x, center.y);
    this.joystickKnob?.setPosition(center.x, center.y);
  }

  private setJoystickVisible(visible: boolean, alpha: number): void {
    this.joystickBase?.setVisible(visible).setAlpha(alpha);
    this.joystickKnob?.setVisible(visible).setAlpha(alpha);
  }
}

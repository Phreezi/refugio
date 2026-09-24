import Phaser from 'phaser';
import { paletteNumber } from '../assets/palette';
import { readJoystick } from '../input/joystick';
import { moveInput } from '../input/moveInput';
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

/**
 * HUD por cima da cena de jogo (corre em paralelo com Base/Zona).
 * Fase 1: joystick virtual (só toque). Fase 2: barras de vida/fome/sede e relógio do dia.
 */
export class UIScene extends Phaser.Scene {
  private joystickPointer: number | null = null;
  private joystickCenter = { x: 0, y: 0 };
  private joystickBase: Phaser.GameObjects.Arc | null = null;
  private joystickKnob: Phaser.GameObjects.Arc | null = null;

  constructor() {
    super(SceneKey.UI);
  }

  create(): void {
    this.joystickPointer = null;
    this.createJoystick();
    // A resolução muda com o ecrã: o joystick em repouso acompanha o canto inferior esquerdo.
    const onResize = (): void => {
      if (this.joystickPointer === null) this.placeJoystick(this.restPosition());
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      moveInput.joystick = { x: 0, y: 0 };
      this.joystickBase = null;
      this.joystickKnob = null;
    });
  }

  /**
   * Joystick flutuante: aparece onde o dedo toca na metade esquerda do ecrã.
   * Em dispositivos com toque fica visível (esbatido) no canto, para se saber que existe.
   */
  private createJoystick(): void {
    if (this.input.manager.pointersTotal < TOUCH_POINTERS + 1) this.input.addPointer(TOUCH_POINTERS);

    // Posições inteiras: as Shapes não são arredondadas ao píxel pelo Phaser 4.
    this.joystickBase = this.add.circle(0, 0, JOYSTICK_RADIUS, paletteNumber('ink'));
    this.joystickKnob = this.add.circle(0, 0, KNOB_RADIUS, paletteNumber('cream'));
    this.placeJoystick(this.restPosition());
    this.setJoystickVisible(this.sys.game.device.input.touch, IDLE_ALPHA);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch || this.joystickPointer !== null) return;
      if (pointer.x >= this.scale.width / 2) return; // metade direita: botão de ação (Fase 3)
      this.joystickPointer = pointer.id;
      this.placeJoystick(this.clampToScreen(pointer.x, pointer.y));
      this.setJoystickVisible(true, ACTIVE_ALPHA);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joystickPointer) return;
      const center = this.joystickCenter;
      const reading = readJoystick(
        pointer.x - center.x,
        pointer.y - center.y,
        JOYSTICK_RADIUS,
        JOYSTICK_DEAD_ZONE,
      );
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

  private restPosition(): { x: number; y: number } {
    const offset = JOYSTICK_MARGIN + JOYSTICK_RADIUS;
    return { x: offset, y: this.scale.height - offset };
  }

  /** O joystick nunca fica cortado pelos bordos do ecrã. */
  private clampToScreen(x: number, y: number): { x: number; y: number } {
    const r = JOYSTICK_RADIUS;
    return {
      x: Phaser.Math.Clamp(Math.round(x), r, this.scale.width - r),
      y: Phaser.Math.Clamp(Math.round(y), r, this.scale.height - r),
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

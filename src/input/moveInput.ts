import { isZero, ZERO, type Vec2 } from '../systems/movement/geometry';

/**
 * Ponto de encontro das fontes de movimento: a UIScene escreve o joystick, a cena de jogo
 * escreve o teclado e lê o resultado. Não é estado do jogo (não se grava).
 */
class MoveInput {
  joystick: Vec2 = ZERO;
  keyboard: Vec2 = ZERO;
  /** Andar agachado: Shift ou Ctrl (teclado) ou joystick pouco empurrado (toque). */
  keyboardSneak = false;
  joystickSneak = false;

  /** O teclado tem prioridade; senão, o joystick. */
  get direction(): Vec2 {
    return isZero(this.keyboard) ? this.joystick : this.keyboard;
  }

  /** Agachado: Shift/Ctrl premido, ou o joystick (quando é ele que manda) pouco empurrado. */
  get sneak(): boolean {
    return this.keyboardSneak || (isZero(this.keyboard) && this.joystickSneak);
  }

  reset(): void {
    this.joystick = ZERO;
    this.keyboard = ZERO;
    this.keyboardSneak = false;
    this.joystickSneak = false;
  }
}

export const moveInput = new MoveInput();

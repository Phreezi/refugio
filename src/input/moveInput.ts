import { isZero, ZERO, type Vec2 } from '../systems/movement/geometry';

/**
 * Ponto de encontro das fontes de movimento: a UIScene escreve o joystick, a cena de jogo
 * escreve o teclado e lê o resultado. Não é estado do jogo (não se grava).
 */
class MoveInput {
  joystick: Vec2 = ZERO;
  keyboard: Vec2 = ZERO;

  /** O teclado tem prioridade; senão, o joystick. */
  get direction(): Vec2 {
    return isZero(this.keyboard) ? this.joystick : this.keyboard;
  }

  reset(): void {
    this.joystick = ZERO;
    this.keyboard = ZERO;
  }
}

export const moveInput = new MoveInput();

import { isZero, ZERO, type Vec2 } from '../systems/movement/geometry';

/**
 * Ponto de encontro das fontes de movimento: a UIScene escreve o joystick, a cena de jogo
 * escreve o teclado e lê o resultado. Não é estado do jogo (não se grava).
 */
/** Premir e largar mais depressa do que isto conta como toque (liga/desliga a corrida). */
const RUN_TAP_MS = 250;

class MoveInput {
  joystick: Vec2 = ZERO;
  keyboard: Vec2 = ZERO;
  /** Andar agachado: Ctrl (teclado) ou joystick pouco empurrado (toque). */
  keyboardSneak = false;
  joystickSneak = false;
  /**
   * Correr (Shift ou botão "Correr"): um toque curto liga/desliga; manter premido corre só
   * enquanto se segura.
   */
  private runToggle = false;
  private runHeldSince: number | null = null;

  get run(): boolean {
    return this.runToggle || this.runHeldSince !== null;
  }

  runDown(now: number): void {
    this.runHeldSince ??= now;
  }

  runUp(now: number): void {
    if (this.runHeldSince === null) return;
    if (now - this.runHeldSince < RUN_TAP_MS) this.runToggle = !this.runToggle;
    this.runHeldSince = null;
  }

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
    this.runHeldSince = null;
  }
}

export const moveInput = new MoveInput();

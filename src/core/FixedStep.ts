/**
 * Acumulador de passo fixo: converte o delta variável de cada frame num número
 * inteiro de ticks de lógica (CLAUDE.md §5.2). O render usa `alpha` para interpolar.
 */
export class FixedStep {
  readonly stepMs: number;
  readonly maxStepsPerFrame: number;
  private accumulator = 0;

  constructor(stepMs: number, maxStepsPerFrame: number) {
    if (!(stepMs > 0)) throw new RangeError(`FixedStep: stepMs inválido (${String(stepMs)})`);
    if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
      throw new RangeError(`FixedStep: maxStepsPerFrame inválido (${String(maxStepsPerFrame)})`);
    }
    this.stepMs = stepMs;
    this.maxStepsPerFrame = maxStepsPerFrame;
  }

  /**
   * Soma `deltaMs` ao acumulador e chama `step` uma vez por cada tick completo.
   * Deltas inválidos (negativos, NaN, infinitos) são ignorados.
   * @returns número de ticks executados neste frame.
   */
  advance(deltaMs: number, step: () => void): number {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
    this.accumulator += deltaMs;

    let steps = 0;
    while (this.accumulator >= this.stepMs && steps < this.maxStepsPerFrame) {
      step();
      this.accumulator -= this.stepMs;
      steps++;
    }
    // Atrasos maiores do que o limite são descartados; mantém-se só a fração do tick seguinte.
    if (this.accumulator >= this.stepMs) this.accumulator %= this.stepMs;
    return steps;
  }

  /** Fração [0, 1) do tempo decorrido entre o último tick e o próximo. */
  get alpha(): number {
    return this.accumulator / this.stepMs;
  }

  reset(): void {
    this.accumulator = 0;
  }
}

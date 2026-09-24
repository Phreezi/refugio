import { describe, expect, it } from 'vitest';
import { FixedStep } from '../../src/core/FixedStep';

function run(clock: FixedStep, deltas: number[]): number {
  let ticks = 0;
  for (const delta of deltas) clock.advance(delta, () => ticks++);
  return ticks;
}

describe('FixedStep', () => {
  it('converte deltas variáveis num número exato de ticks', () => {
    const clock = new FixedStep(50, 5);
    // 60 frames de ~16,67 ms = 1000 ms → 20 ticks
    expect(
      run(
        clock,
        Array.from({ length: 60 }, () => 1000 / 60),
      ),
    ).toBe(20);
  });

  it('não corre ticks enquanto não completar um passo', () => {
    const clock = new FixedStep(50, 5);
    expect(run(clock, [20, 20])).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.8);
    expect(run(clock, [10])).toBe(1);
    expect(clock.alpha).toBeCloseTo(0);
  });

  it('limita os ticks por frame e descarta o atraso excedente', () => {
    const clock = new FixedStep(50, 5);
    let ticks = 0;
    const steps = clock.advance(10_025, () => ticks++);
    expect(steps).toBe(5);
    expect(ticks).toBe(5);
    // Fica só a fração do próximo tick (25 ms), não 9 775 ms em atraso.
    expect(clock.alpha).toBeCloseTo(0.5);
    expect(run(clock, [25])).toBe(1);
  });

  it('ignora deltas inválidos', () => {
    const clock = new FixedStep(50, 5);
    expect(run(clock, [-10, 0, Number.NaN, Number.POSITIVE_INFINITY])).toBe(0);
    expect(clock.alpha).toBe(0);
  });

  it('reset() descarta o tempo acumulado', () => {
    const clock = new FixedStep(50, 5);
    clock.advance(40, () => undefined);
    clock.reset();
    expect(clock.alpha).toBe(0);
    expect(run(clock, [40])).toBe(0);
  });

  it('rejeita configurações inválidas', () => {
    expect(() => new FixedStep(0, 5)).toThrow(RangeError);
    expect(() => new FixedStep(50, 0)).toThrow(RangeError);
    expect(() => new FixedStep(50, 1.5)).toThrow(RangeError);
  });
});

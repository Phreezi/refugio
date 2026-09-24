import { describe, expect, it } from 'vitest';
import { keyboardDirection, readJoystick } from '../../src/input/joystick';

describe('readJoystick', () => {
  it('dentro da zona morta não há movimento', () => {
    expect(readJoystick(3, 2, 24, 0.25).direction).toEqual({ x: 0, y: 0 });
    expect(readJoystick(0, 0, 24, 0.25).direction).toEqual({ x: 0, y: 0 });
  });

  it('arredonda para uma das 8 direções, com vetor unitário', () => {
    expect(readJoystick(20, 3, 24, 0.25).direction).toEqual({ x: 1, y: 0 });
    expect(readJoystick(-2, -20, 24, 0.25).direction).toEqual({ x: 0, y: -1 });
    const diag = readJoystick(15, 14, 24, 0.25).direction;
    expect(diag.x).toBeCloseTo(Math.SQRT1_2);
    expect(diag.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('o manípulo fica limitado ao raio, em píxeis inteiros', () => {
    expect(readJoystick(100, 0, 24, 0.25).knob).toEqual({ x: 24, y: 0 });
    const knob = readJoystick(30, 40, 24, 0.25).knob;
    expect(knob).toEqual({ x: 14, y: 19 });
    expect(Number.isInteger(knob.x) && Number.isInteger(knob.y)).toBe(true);
  });
});

describe('keyboardDirection', () => {
  it('combina as teclas; opostas anulam-se', () => {
    expect(keyboardDirection({ up: true, down: false, left: false, right: true })).toEqual({ x: 1, y: -1 });
    expect(keyboardDirection({ up: true, down: true, left: false, right: false })).toEqual({ x: 0, y: 0 });
  });
});

describe('readJoystick: agachado', () => {
  it('pouco empurrado (entre a zona morta e a de agachar) = agachado; mais = normal', () => {
    expect(readJoystick(10, 0, 24, 0.25, 0.55).sneak).toBe(true);
    expect(readJoystick(20, 0, 24, 0.25, 0.55).sneak).toBe(false);
    expect(readJoystick(3, 0, 24, 0.25, 0.55).sneak).toBe(false); // zona morta: parado
  });
});

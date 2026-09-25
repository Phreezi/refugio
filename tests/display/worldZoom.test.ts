import { describe, expect, it } from 'vitest';
import { pinchStep, zoomLevels } from '../../src/display/worldZoom';

describe('zoomLevels', () => {
  it('só um nível abaixo do zoom da vista, nunca abaixo de ×2', () => {
    expect(zoomLevels(4)).toEqual([4, 3]);
    expect(zoomLevels(3)).toEqual([3, 2]);
    expect(zoomLevels(2)).toEqual([2]);
    expect(zoomLevels(1)).toEqual([1]);
    expect(zoomLevels(6)).toEqual([6, 5]);
  });

  it('com zoom fracionário (ecrã minúsculo) não há alternativas', () => {
    expect(zoomLevels(0.75)).toEqual([0.75]);
  });
});

describe('pinchStep', () => {
  it('afastar os dedos aproxima, juntar afasta, pequenos movimentos não fazem nada', () => {
    expect(pinchStep(100, 140)).toBe(1);
    expect(pinchStep(100, 70)).toBe(-1);
    expect(pinchStep(100, 110)).toBe(0);
    expect(pinchStep(0, 50)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { pinchStep, zoomLevels } from '../../src/display/worldZoom';

describe('zoomLevels', () => {
  it('do zoom da vista até metade, só inteiros', () => {
    expect(zoomLevels(4)).toEqual([4, 3, 2]);
    expect(zoomLevels(3)).toEqual([3, 2]);
    expect(zoomLevels(2)).toEqual([2, 1]);
    expect(zoomLevels(1)).toEqual([1]);
    expect(zoomLevels(6)).toEqual([6, 5, 4, 3]);
    // Ao alto: um nível abaixo no mais perto e mais um para afastar.
    expect(zoomLevels(4, true)).toEqual([3, 2, 1]);
    expect(zoomLevels(3, true)).toEqual([2, 1]);
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

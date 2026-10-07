import { describe, expect, it } from 'vitest';
import { boxOutside, cullRect, pointOutside } from '../../src/display/culling';

describe('culling', () => {
  const area = cullRect({ x: 100, y: 50, width: 480, height: 270 }, 80);

  it('alarga a vista pela margem', () => {
    expect(area).toEqual({ x0: 20, y0: -30, x1: 660, y1: 400 });
  });

  it('pontos dentro da margem desenham-se; fora não', () => {
    expect(pointOutside(area, 20, -30)).toBe(false);
    expect(pointOutside(area, 660, 400)).toBe(false);
    expect(pointOutside(area, 19, 100)).toBe(true);
    expect(pointOutside(area, 300, 401)).toBe(true);
  });

  it('uma zona que toca na área vê-se', () => {
    expect(boxOutside(area, 600, 300, 768, 768)).toBe(false);
    expect(boxOutside(area, -768, -768, 788, 738)).toBe(false);
    expect(boxOutside(area, 661, 0, 100, 100)).toBe(true);
    expect(boxOutside(area, 0, -200, 100, 169)).toBe(true);
  });
});

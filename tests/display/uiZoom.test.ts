import { describe, expect, it } from 'vitest';
import { uiZoomFor } from '../../src/display/view';

describe('tamanho da interface', () => {
  it('grande = zoom do mundo; médio e pequeno descem um e dois níveis', () => {
    expect(uiZoomFor(4, 'large', 1080)).toBe(4);
    expect(uiZoomFor(4, 'medium', 1080)).toBe(3);
    expect(uiZoomFor(4, 'small', 1080)).toBe(2);
  });

  it('nunca abaixo de metade, nem com letras ilegíveis; zoom fracionário fica igual', () => {
    expect(uiZoomFor(3, 'small', 810)).toBe(2);
    expect(uiZoomFor(2, 'small', 540)).toBe(1);
    expect(uiZoomFor(2, 'small', 1000)).toBe(2);
    expect(uiZoomFor(6, 'small', 1620)).toBe(4);
    expect(uiZoomFor(0.8, 'small', 200)).toBe(0.8);
  });
});

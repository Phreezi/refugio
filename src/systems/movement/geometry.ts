export interface Vec2 {
  x: number;
  y: number;
}

/** Retângulo alinhado aos eixos; (x, y) = canto superior esquerdo. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ZERO: Readonly<Vec2> = Object.freeze({ x: 0, y: 0 });

export function isZero(v: Vec2): boolean {
  return v.x === 0 && v.y === 0;
}

/** Interseção estrita: retângulos que só se tocam na aresta não se sobrepõem. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Caixa de colisão com `size` centrada horizontalmente em `feet` e a acabar nos pés. */
export function footprintRect(feet: Vec2, size: { width: number; height: number }): Rect {
  return { x: feet.x - size.width / 2, y: feet.y - size.height, w: size.width, h: size.height };
}

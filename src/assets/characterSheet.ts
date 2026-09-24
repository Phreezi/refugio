import type { Facing } from '../systems/movement/movement';
import type { PaletteColor } from './palette';

// Layout das spritesheets de personagens (CLAUDE.md §6.2: 4 direções × parado, andar 4 frames,
// atacar 2 frames) e o desenho do placeholder, frame a frame. Lógica pura: devolve retângulos,
// que o placeholders.ts pinta num canvas.

/** Uma linha por direção, por esta ordem. */
export const CHARACTER_ROWS: readonly Facing[] = ['down', 'left', 'right', 'up'];

export const CHARACTER_COLUMNS = {
  idle: 0,
  walk: [1, 2, 3, 4],
  attack: [5, 6],
} as const;

export const CHARACTER_COLUMN_COUNT = 7;

/** Índice do frame (numeração do Phaser: linha a linha, da esquerda para a direita). */
export function characterFrame(facing: Facing, column: number): number {
  return CHARACTER_ROWS.indexOf(facing) * CHARACTER_COLUMN_COUNT + column;
}

export interface PaintRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: PaletteColor;
}

export interface CharacterColors {
  body: PaletteColor;
  outline: PaletteColor;
}

const SKIN: PaletteColor = 'peach';
const HAIR: PaletteColor = 'bark';
const LEGS: PaletteColor = 'shadow';
const TOOL: PaletteColor = 'wood_light';

/** Retângulo com contorno de 1 px (dois retângulos: contorno + interior). */
function boxed(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: PaletteColor,
  outline: PaletteColor,
): PaintRect[] {
  return [
    { x, y, w, h, color: outline },
    { x: x + 1, y: y + 1, w: w - 2, h: h - 2, color: fill },
  ];
}

/**
 * Retângulos (por ordem de pintura) de um frame 16×32 de personagem placeholder:
 * cabeça, olhos a indicar a direção, corpo, pernas que alternam ao andar e um pau ao atacar.
 */
export function paintCharacterFrame(facing: Facing, column: number, colors: CharacterColors): PaintRect[] {
  const walkIndex = (CHARACTER_COLUMNS.walk as readonly number[]).indexOf(column);
  const attackIndex = (CHARACTER_COLUMNS.attack as readonly number[]).indexOf(column);
  // Ao andar, o corpo sobe 1 px nos frames em que as pernas se cruzam.
  const bob = walkIndex === 1 || walkIndex === 3 ? -1 : 0;
  const rects: PaintRect[] = [];

  // Pernas (por baixo do corpo): passo esquerdo (0), passagem (1), passo direito (2), passagem (3).
  const LIFTS: readonly (readonly [number, number])[] = [
    [2, 0],
    [1, 0],
    [0, 2],
    [0, 1],
  ];
  const [leftLift, rightLift] = LIFTS[walkIndex] ?? [0, 0];
  rects.push({ x: 4, y: 25, w: 3, h: 7 - leftLift, color: LEGS });
  rects.push({ x: 9, y: 25, w: 3, h: 7 - rightLift, color: LEGS });

  // Corpo e cabeça.
  rects.push(...boxed(3, 13 + bob, 10, 13, colors.body, colors.outline));
  rects.push(...boxed(3, 3 + bob, 10, 11, SKIN, colors.outline));

  // Cabelo e olhos conforme a direção.
  const eyeY = 8 + bob;
  if (facing === 'up') {
    rects.push({ x: 4, y: 4 + bob, w: 8, h: 9, color: HAIR });
  } else {
    rects.push({ x: 4, y: 4 + bob, w: 8, h: 3, color: HAIR });
    if (facing === 'down') {
      rects.push({ x: 5, y: eyeY, w: 1, h: 2, color: colors.outline });
      rects.push({ x: 10, y: eyeY, w: 1, h: 2, color: colors.outline });
    } else {
      const eyeX = facing === 'left' ? 4 : 11;
      rects.push({ x: eyeX, y: eyeY, w: 1, h: 2, color: colors.outline });
      // Cabelo na nuca (do lado oposto aos olhos).
      rects.push({ x: facing === 'left' ? 8 : 4, y: 4 + bob, w: 4, h: 6, color: HAIR });
    }
  }

  // Ataque: um pau à frente (frame 0 levantado, frame 1 estendido).
  if (attackIndex >= 0) {
    const reach = attackIndex === 0 ? 3 : 6;
    if (facing === 'left') rects.push({ x: 3 - reach, y: 16, w: reach, h: 2, color: TOOL });
    else if (facing === 'right') rects.push({ x: 13, y: 16, w: reach, h: 2, color: TOOL });
    else if (facing === 'down') rects.push({ x: 12, y: 17, w: 2, h: reach + 2, color: TOOL });
    else rects.push({ x: 12, y: 13 - reach, w: 2, h: reach, color: TOOL });
  }

  return rects.map(clipToFrame).filter((r) => r.w > 0 && r.h > 0);
}

export const CHARACTER_FRAME_WIDTH = 16;
export const CHARACTER_FRAME_HEIGHT = 32;

/** Nada pode sair do frame: na folha, pintaria o frame vizinho. */
function clipToFrame(r: PaintRect): PaintRect {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const right = Math.min(CHARACTER_FRAME_WIDTH, r.x + r.w);
  const bottom = Math.min(CHARACTER_FRAME_HEIGHT, r.y + r.h);
  return { x, y, w: right - x, h: bottom - y, color: r.color };
}

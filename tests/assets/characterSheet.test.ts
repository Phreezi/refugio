import { describe, expect, it } from 'vitest';
import {
  CHARACTER_COLUMN_COUNT,
  CHARACTER_COLUMNS,
  CHARACTER_FRAME_HEIGHT,
  CHARACTER_FRAME_WIDTH,
  CHARACTER_ROWS,
  characterFrame,
  paintCharacterFrame,
} from '../../src/assets/characterSheet';
import { CHARACTER_SHEET_LAYOUT } from '../../src/assets/manifest';
import { isPaletteColor } from '../../src/assets/palette';

const COLORS = { body: 'sky', outline: 'ink' } as const;

describe('characterSheet', () => {
  it('o layout coincide com o que o manifest exige para style "character"', () => {
    expect(CHARACTER_SHEET_LAYOUT).toEqual({
      frameWidth: CHARACTER_FRAME_WIDTH,
      frameHeight: CHARACTER_FRAME_HEIGHT,
      columns: CHARACTER_COLUMN_COUNT,
      rows: CHARACTER_ROWS.length,
    });
    const used = [CHARACTER_COLUMNS.idle, ...CHARACTER_COLUMNS.walk, ...CHARACTER_COLUMNS.attack];
    expect(used.sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('numera os frames linha a linha, como o Phaser', () => {
    expect(characterFrame('down', 0)).toBe(0);
    expect(characterFrame('left', 1)).toBe(8);
    expect(characterFrame('up', 6)).toBe(27);
  });

  it('todos os frames ficam dentro dos 16×32 px e usam só cores da paleta', () => {
    for (const facing of CHARACTER_ROWS) {
      for (let column = 0; column < CHARACTER_COLUMN_COUNT; column++) {
        for (const r of paintCharacterFrame(facing, column, COLORS)) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(CHARACTER_FRAME_WIDTH);
          expect(r.y + r.h).toBeLessThanOrEqual(CHARACTER_FRAME_HEIGHT);
          expect(isPaletteColor(r.color)).toBe(true);
        }
      }
    }
  });

  it('cada direção e cada frame de andar têm um desenho diferente', () => {
    const idle = CHARACTER_ROWS.map((f) => JSON.stringify(paintCharacterFrame(f, 0, COLORS)));
    expect(new Set(idle).size).toBe(4);
    const walk = CHARACTER_COLUMNS.walk.map((c) => JSON.stringify(paintCharacterFrame('down', c, COLORS)));
    expect(new Set(walk).size).toBe(4);
  });
});

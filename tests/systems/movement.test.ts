import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../../src/systems/movement/CollisionWorld';
import { footprintRect, overlaps } from '../../src/systems/movement/geometry';
import { facingFromIntent, moveWithCollision, normalize } from '../../src/systems/movement/movement';

const FOOT = { width: 10, height: 6 };

/** Mundo a partir de linhas de texto: '#' = tile sólido. */
function world(rows: string[], obstacles: { x: number; y: number; w: number; h: number }[] = []) {
  const solid = rows.flatMap((row) => Array.from({ length: row.length }, (_, i) => row.charAt(i) === '#'));
  return new CollisionWorld(rows[0]?.length ?? 0, rows.length, 16, solid, obstacles);
}

const OPEN = world(['.....', '.....', '.....', '.....', '.....']);

describe('normalize', () => {
  it('devolve um vetor unitário ou zero', () => {
    expect(normalize({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(normalize({ x: Number.NaN, y: 1 })).toEqual({ x: 0, y: 0 });
  });
});

describe('facingFromIntent', () => {
  it('escolhe o eixo dominante', () => {
    expect(facingFromIntent({ x: 1, y: 0.2 }, 'down')).toBe('right');
    expect(facingFromIntent({ x: -0.1, y: -1 }, 'down')).toBe('up');
  });

  it('sem intenção mantém a direção', () => {
    expect(facingFromIntent({ x: 0, y: 0 }, 'left')).toBe('left');
  });

  it('na diagonal mantém a direção atual se for uma das componentes', () => {
    const d = Math.SQRT1_2;
    expect(facingFromIntent({ x: d, y: d }, 'down')).toBe('down');
    expect(facingFromIntent({ x: d, y: d }, 'right')).toBe('right');
    expect(facingFromIntent({ x: d, y: d }, 'up')).toBe('right');
  });
});

describe('moveWithCollision', () => {
  it('move livremente em espaço aberto', () => {
    expect(moveWithCollision({ x: 40, y: 40 }, FOOT, { x: 3, y: -2 }, OPEN)).toEqual({ x: 43, y: 38 });
  });

  it('para encostado a um tile sólido', () => {
    const w = world(['..#..', '..#..', '..#..', '.....', '.....']);
    // Parede em x = 32; a caixa vai de x-5 a x+5.
    expect(moveWithCollision({ x: 20, y: 20 }, FOOT, { x: 20, y: 0 }, w)).toEqual({ x: 27, y: 20 });
  });

  it('desliza ao longo da parede quando anda na diagonal', () => {
    const w = world(['..#..', '..#..', '..#..', '.....', '.....']);
    expect(moveWithCollision({ x: 27, y: 20 }, FOOT, { x: 3, y: 3 }, w)).toEqual({ x: 27, y: 23 });
  });

  it('os limites do mapa contam como parede', () => {
    expect(moveWithCollision({ x: 8, y: 8 }, FOOT, { x: -10, y: -10 }, OPEN)).toEqual({ x: 5, y: 6 });
    expect(moveWithCollision({ x: 70, y: 70 }, FOOT, { x: 20, y: 20 }, OPEN)).toEqual({ x: 75, y: 80 });
  });

  it('não atravessa paredes finas mesmo com passos grandes', () => {
    const obstacle = { x: 50, y: 0, w: 2, h: 80 };
    const w = world(['.....', '.....', '.....', '.....', '.....'], [obstacle]);
    expect(moveWithCollision({ x: 20, y: 40 }, FOOT, { x: 60, y: 0 }, w)).toEqual({ x: 45, y: 40 });
  });

  it('bate nas caixas dos recursos (obstáculos)', () => {
    const tree = footprintRect({ x: 40, y: 60 }, { width: 8, height: 6 });
    const w = world(['.....', '.....', '.....', '.....', '.....'], [tree]);
    // A andar para baixo a partir de cima da árvore: para quando o fundo da caixa toca o topo dela.
    const end = moveWithCollision({ x: 40, y: 40 }, FOOT, { x: 0, y: 30 }, w);
    expect(end).toEqual({ x: 40, y: 54 });
    expect(overlaps(footprintRect(end, FOOT), tree)).toBe(false);
  });

  it('se já estiver metido num sólido consegue sair (nunca fica preso)', () => {
    const w = world(['.....', '.....', '.#...', '.....', '.....']);
    // Caixa sobreposta ao tile (16..32, 32..48): pode afastar-se.
    const end = moveWithCollision({ x: 30, y: 36 }, FOOT, { x: 4, y: 0 }, w);
    expect(end).toEqual({ x: 34, y: 36 });
  });
});

describe('CollisionWorld', () => {
  it('fora do mapa é sólido', () => {
    expect(OPEN.isSolidTile(-1, 0)).toBe(true);
    expect(OPEN.isSolidTile(0, 5)).toBe(true);
    expect(OPEN.isSolidTile(4, 4)).toBe(false);
  });

  it('fromZone junta tiles sólidos e caixas dos recursos com footprint', () => {
    const zone = {
      width: 2,
      height: 1,
      tileSize: 16,
      solid: [false, true],
      playerSpawn: { x: 8, y: 8 },
      exits: [],
      resources: [
        { id: 'tree', x: 8, y: 14 },
        { id: 'grass', x: 4, y: 14 },
      ],
      containers: [],
      enemySpawns: [],
    };
    const cw = CollisionWorld.fromZone(zone, {
      tree: { sprite: 'tree', footprint: { width: 4, height: 2 } },
      grass: { sprite: 'grass' },
    });
    expect(cw.pixelWidth).toBe(32);
    expect(cw.blocks({ x: 7, y: 12, w: 1, h: 1 })).toBe(true); // árvore
    expect(cw.blocks({ x: 1, y: 12, w: 1, h: 1 })).toBe(false); // erva: atravessável
    expect(cw.blocks({ x: 20, y: 4, w: 1, h: 1 })).toBe(true); // tile sólido
  });

  it('rejeita um mapa de colisões com tamanho errado', () => {
    expect(() => new CollisionWorld(2, 2, 16, [false])).toThrow();
  });
});

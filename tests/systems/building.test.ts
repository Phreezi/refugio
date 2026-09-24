import { describe, expect, it } from 'vitest';
import {
  createBuildSite,
  refund,
  StructureGrid,
  structureCollision,
  tileInFront,
  type StructureRecord,
} from '../../src/systems/building/building';
import { loadContent } from '../helpers/content';

const { structures } = loadContent();
const W = 8;
const H = 6;

/** Terreno 8×6: tile (0,0) sólido, chão construído em (5..6, 1), um obstáculo em (3,4). */
function grid(records: StructureRecord[] = []) {
  const solid = new Array<boolean>(W * H).fill(false);
  solid[0] = true;
  const floor = new Array<boolean>(W * H).fill(false);
  floor[1 * W + 5] = true;
  floor[1 * W + 6] = true;
  const site = createBuildSite(
    { width: W, height: H, tileSize: 16, solid, floor },
    [{ x: 3 * 16 + 3, y: 4 * 16 + 10, w: 10, h: 6 }],
    [{ x: 7 * 16 + 8, y: 5 * 16 + 8 }],
  );
  return new StructureGrid(site, structures, records);
}

describe('construção: regras de colocação', () => {
  it('não constrói fora do mapa, em tiles sólidos nem em cima de objetos do mapa', () => {
    const g = grid();
    expect(g.placementProblem('wall_wood', -1, 2, null)).toBe('out_of_bounds');
    expect(g.placementProblem('wood_bench', 7, 2, null)).toBe('out_of_bounds'); // 2×1 não cabe
    expect(g.placementProblem('wall_wood', 0, 0, null)).toBe('blocked');
    expect(g.placementProblem('foundation_wood', 3, 4, null)).toBe('blocked');
    expect(g.placementProblem('wall_wood', 2, 2, null)).toBeNull();
    expect(g.placementProblem('unknown_piece', 2, 2, null)).toBe('unknown');
  });

  it('peças sólidas não ficam onde o jogador aparece; fundações sim', () => {
    const g = grid();
    expect(g.placementProblem('wall_wood', 7, 5, null)).toBe('blocked');
    expect(g.placementProblem('foundation_wood', 7, 5, null)).toBeNull();
  });

  it('uma peça por camada em cada tile; parede sobre fundação é permitida', () => {
    const g = grid([
      [1, 'foundation_wood', 2, 2, 0, 0],
      [2, 'wall_wood', 3, 2, 0, 0],
    ]);
    expect(g.placementProblem('foundation_stone', 2, 2, null)).toBe('occupied');
    expect(g.placementProblem('wall_stone', 3, 2, null)).toBe('occupied');
    expect(g.placementProblem('wall_wood', 2, 2, null)).toBeNull();
    expect(g.placementProblem('foundation_wood', 3, 2, null)).toBeNull();
  });

  it('estações e baús só em fundação (o chão construído do mapa também conta)', () => {
    const g = grid([[1, 'foundation_wood', 2, 2, 0, 0]]);
    expect(g.placementProblem('campfire', 4, 2, null)).toBe('needs_foundation');
    expect(g.placementProblem('campfire', 2, 2, null)).toBeNull();
    expect(g.placementProblem('wood_bench', 5, 1, null)).toBeNull(); // 2 tiles de chão do mapa
    expect(g.placementProblem('wood_bench', 4, 1, null)).toBe('needs_foundation'); // só 1 dos 2
    expect(g.placementProblem('foundation_wood', 5, 1, null)).toBe('occupied'); // já é chão
  });

  it('peças sólidas não se põem em cima do jogador', () => {
    const g = grid();
    const player = { x: 2 * 16 + 3, y: 2 * 16 + 10, w: 10, h: 6 };
    expect(g.placementProblem('wall_wood', 2, 2, player)).toBe('player');
    expect(g.placementProblem('foundation_wood', 2, 2, player)).toBeNull();
  });

  it('demolir: primeiro a peça de cima; fundação com estação por cima não sai', () => {
    const g = grid([
      [1, 'foundation_wood', 2, 2, 0, 0],
      [2, 'campfire', 2, 2, 0, 0],
      [3, 'foundation_wood', 4, 2, 0, 0],
      [4, 'wall_wood', 4, 2, 0, 0],
    ]);
    expect(g.demolishTarget(2, 2)?.[0]).toBe(2);
    expect(g.supportsSomething(1)).toBe(true);
    expect(g.supportsSomething(3)).toBe(false); // uma parede não precisa de fundação
    g.remove(2);
    expect(g.demolishTarget(2, 2)?.[0]).toBe(1);
    expect(g.supportsSomething(1)).toBe(false);
    expect(g.demolishTarget(6, 4)).toBeNull();
  });
});

describe('construção: geometria e reembolso', () => {
  it('porta fechada bloqueia o tile inteiro; aberta não bloqueia', () => {
    const door = structures.door_wood;
    if (!door) throw new Error('falta door_wood');
    expect(structureCollision(door, 2, 3, 16)).toEqual({ x: 32, y: 48, w: 16, h: 16 });
    expect(structureCollision(door, 2, 3, 16, true)).toBeNull();
  });

  it('estações usam a caixa nos pés; fundações não bloqueiam', () => {
    const bench = structures.wood_bench;
    const foundation = structures.foundation_wood;
    if (!bench || !foundation) throw new Error('faltam peças');
    expect(structureCollision(bench, 1, 1, 16)).toEqual({ x: 21, y: 26, w: 22, h: 6 });
    expect(structureCollision(foundation, 1, 1, 16)).toBeNull();
  });

  it('reembolso arredonda para baixo e omite o que dá 0', () => {
    expect(
      refund(
        [
          { item: 'wood', qty: 3 },
          { item: 'rope', qty: 1 },
        ],
        50,
      ),
    ).toEqual([{ item: 'wood', qty: 1 }]);
  });

  it('peça à frente do jogador: encostada ao tile dele e centrada', () => {
    const feet = { x: 5 * 16 + 8, y: 4 * 16 + 12 }; // tile (5, 4)
    const one = { width: 1, height: 1 };
    expect(tileInFront(feet, 'down', one, 16)).toEqual({ tx: 5, ty: 5 });
    expect(tileInFront(feet, 'up', one, 16)).toEqual({ tx: 5, ty: 3 });
    expect(tileInFront(feet, 'left', one, 16)).toEqual({ tx: 4, ty: 4 });
    expect(tileInFront(feet, 'right', one, 16)).toEqual({ tx: 6, ty: 4 });
    const wide = { width: 2, height: 1 };
    expect(tileInFront(feet, 'left', wide, 16)).toEqual({ tx: 3, ty: 4 });
    expect(tileInFront(feet, 'down', wide, 16)).toEqual({ tx: 5, ty: 5 });
    // Pés exatamente na base do tile: ainda é o tile de cima.
    expect(tileInFront({ x: 88, y: 80 }, 'down', one, 16)).toEqual({ tx: 5, ty: 5 });
  });
});

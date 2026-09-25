import { describe, expect, it } from 'vitest';
import { WorldLayout, worldLinks } from '../../src/world/worldLayout';

// Duas zonas lado a lado: A (4×4 em 0,0) e B (3×2 em 4,1). B só tem o tile (0,0) livre.
const layout = new WorldLayout([
  { zoneId: 'a', x: 0, y: 0, w: 4, h: 4 },
  { zoneId: 'b', x: 4, y: 1, w: 3, h: 2 },
]);
const maps = {
  a: { width: 4, solid: new Array<boolean>(16).fill(false) },
  b: { width: 3, solid: [false, true, true, true, true, true] },
};

describe('Mundo contínuo (Etapa E)', () => {
  it('diz que zona tem cada tile do mundo e quais estão perto', () => {
    expect(layout.at(5, 1)).toMatchObject({ zone: { zoneId: 'b' }, tx: 1, ty: 0 });
    expect(layout.at(5, 0)).toBeUndefined();
    expect(layout.resolve('a', 4, 1)).toMatchObject({ zone: { zoneId: 'b' }, tx: 0, ty: 0 });
    expect(layout.near('a', 0).map((r) => r.zoneId)).toEqual(['b']);
    expect(layout.overlaps()).toEqual([]);
    expect(new WorldLayout([...layout.all(), { zoneId: 'c', x: 3, y: 3, w: 2, h: 2 }]).overlaps()).toEqual([
      'a sobrepõe-se a c',
    ]);
  });

  it('fora do mapa: sólido ou não conforme a zona vizinha; o ponto passa para as coordenadas dela', () => {
    const links = worldLinks(layout, 'a', 16, (id) => maps[id as 'a' | 'b']);
    if (!links) throw new Error('a zona devia estar no mundo');
    expect(links.outside(4, 1)).toBe(false); // o tile livre de B
    expect(links.outside(4, 2)).toBe(true);
    expect(links.outside(-1, 0)).toBe(true); // nada a oeste
    expect(links.neighborAt(4 * 16 + 3, 16 + 5)).toEqual({ zoneId: 'b', x: 3, y: 5 });
    expect(links.neighborAt(10, 10)).toBeNull();
    expect(worldLinks(layout, 'longe', 16, () => maps.a)).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import props from '../../src/data/props.json';
import resources from '../../src/data/resources.json';
import stations from '../../src/data/stations.json';
import {
  BASE_FLOOR_TILES,
  BASE_LEDGE_TILES,
  BASE_TILES,
  BASE_TILESET_NAME,
  baseTileIndex,
} from '../../src/world/tileset';
import { parseZoneMap, ZoneMapError, type ZoneMapRules } from '../../src/world/zoneMap';

const RULES: ZoneMapRules = {
  tileSize: 16,
  tilesets: { [BASE_TILESET_NAME]: BASE_TILES.length },
  resourceIds: Object.keys(resources).filter((id) => id !== '$comment'),
  propIds: Object.keys(props).filter((id) => id !== '$comment'),
  stationIds: Object.keys(stations).filter((id) => id !== '$comment'),
  floorTiles: { [BASE_TILESET_NAME]: BASE_FLOOR_TILES.map(baseTileIndex) },
  ledgeTiles: { [BASE_TILESET_NAME]: BASE_LEDGE_TILES.map(baseTileIndex) },
};

/** Mapa 3×2 mínimo válido; `patch` altera partes para testar erros. */
function tinyMap(patch: (map: Record<string, unknown>) => void = () => undefined) {
  const layer = (name: string, data: number[]) => ({ name, type: 'tilelayer', width: 3, height: 2, data });
  const obj = (id: number, name: string, x: number, y: number) => ({ id, name, x, y, point: true });
  const map: Record<string, unknown> = {
    orientation: 'orthogonal',
    infinite: false,
    width: 3,
    height: 2,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [
      { firstgid: 1, name: BASE_TILESET_NAME, tilecount: BASE_TILES.length, tilewidth: 16, tileheight: 16 },
    ],
    layers: [
      layer('ground', [1, 1, 1, 1, 1, 1]),
      layer('decor_low', [0, 0, 0, 0, 0, 0]),
      layer('collision', [0, 0, 9, 0, 0, 0]),
      layer('decor_high', [0, 0, 0, 0, 0, 0]),
      {
        name: 'objects',
        type: 'objectgroup',
        objects: [
          obj(1, 'player_spawn', 8, 8),
          obj(2, 'exit', 0, 24),
          obj(3, 'exit', 48, 24),
          obj(4, 'resource:rock', 24, 30),
          obj(5, 'container:crate_common', 40, 30),
          obj(6, 'prop:log', 20.5, 12.25),
        ],
      },
    ],
  };
  patch(map);
  return map;
}

function problemsOf(input: unknown): readonly string[] {
  try {
    parseZoneMap(input, RULES, 'teste.json');
  } catch (error) {
    if (error instanceof ZoneMapError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseZoneMap', () => {
  it('extrai colisões, spawn, saídas e objetos', () => {
    const map = parseZoneMap(tinyMap(), RULES, 'teste.json');
    expect(map.solid).toEqual([false, false, true, false, false, false]);
    expect(map.playerSpawn).toEqual({ x: 8, y: 8 });
    expect(map.exits).toHaveLength(2);
    expect(map.resources).toEqual([{ id: 'rock', x: 24, y: 30, objectId: 4 }]);
    expect(map.containers).toEqual([{ id: 'crate_common', objectId: 5, x: 40, y: 30 }]);
    expect(map.props).toEqual([{ id: 'log', x: 20.5, y: 12.25, objectId: 6 }]);
  });

  it('ignora os bits de rotação/espelho do Tiled nos gids', () => {
    const map = parseZoneMap(
      tinyMap((m) => {
        const layers = m.layers as { name: string; data?: number[] }[];
        const collision = layers.find((l) => l.name === 'collision');
        if (collision) collision.data = [0, 0, (0x80000000 | 9) >>> 0, 0, 0, 0];
      }),
      RULES,
      'teste.json',
    );
    expect(map.solid[2]).toBe(true);
  });

  it('o mapa real da base é válido', () => {
    const url = new URL('../../public/assets/maps/base.json', import.meta.url);
    const map = parseZoneMap(JSON.parse(readFileSync(url, 'utf8')), RULES, 'base.json');
    expect(map.width).toBe(48);
    expect(map.height).toBe(48);
    expect(map.resources.length).toBeGreaterThan(0);
    expect(map.props.length).toBeGreaterThan(0);
  });

  it('o chão da casa em ruínas conta como fundação; a relva não', () => {
    const url = new URL('../../public/assets/maps/base.json', import.meta.url);
    const map = parseZoneMap(JSON.parse(readFileSync(url, 'utf8')), RULES, 'base.json');
    expect(map.floor[16 * map.width + 21]).toBe(true); // quarto de madeira
    expect(map.floor[16 * map.width + 27]).toBe(true); // betão
    expect(map.floor[40 * map.width + 10]).toBe(false);
    expect(map.stations).toEqual([]); // a fogueira e a bancada passaram a ser construídas
  });

  it('reporta camadas em falta, spawn duplicado, recursos desconhecidos e nomes inválidos', () => {
    const problems = problemsOf(
      tinyMap((m) => {
        const layers = m.layers as { name: string; objects?: unknown[] }[];
        m.layers = layers.filter((l) => l.name !== 'decor_high');
        const objects = layers.find((l) => l.name === 'objects')?.objects;
        objects?.push(
          { id: 9, name: 'player_spawn', x: 1, y: 1 },
          { id: 10, name: 'resource:unicorn', x: 1, y: 1 },
          { id: 12, name: 'prop:spaceship', x: 1, y: 1 },
          { id: 11, name: 'baú', x: 1, y: 1 },
        );
      }),
    );
    expect(problems).toEqual([
      expect.stringContaining('"decor_high"'),
      expect.stringContaining('unicorn'),
      expect.stringContaining('spaceship'),
      expect.stringContaining('nome inválido'),
      expect.stringContaining('player_spawn'),
    ]);
  });

  it('exige pelo menos 1 saída e o spawn fora das colisões', () => {
    const problems = problemsOf(
      tinyMap((m) => {
        const layers = m.layers as { name: string; objects?: { name: string; x: number }[] }[];
        const objects = layers.find((l) => l.name === 'objects')?.objects ?? [];
        const spawn = objects.find((o) => o.name === 'player_spawn');
        if (spawn) spawn.x = 40; // tile (2, 0), que é sólido
        for (let i = objects.length - 1; i >= 0; i--)
          if (objects[i]?.name.startsWith('exit')) objects.splice(i, 1);
      }),
    );
    expect(problems).toEqual([expect.stringContaining('saídas'), expect.stringContaining('colisão')]);
  });

  it('rejeita tilesets externos e gids fora dos tilesets', () => {
    const problems = problemsOf(
      tinyMap((m) => {
        m.tilesets = [{ firstgid: 1, source: 'base.tsx' }];
      }),
    );
    expect(problems).toContainEqual(expect.stringContaining('embebidos'));
    expect(problems).toContainEqual(expect.stringContaining('gid fora'));
  });
});

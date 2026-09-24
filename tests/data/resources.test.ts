import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/assets/manifest';
import { PALETTE_NAMES } from '../../src/assets/palette';
import resources from '../../src/data/resources.json';
import { DataError, parseResources } from '../../src/data/types';

describe('parseResources', () => {
  it('o resources.json real é válido e usa sprites do manifest', () => {
    const url = new URL('../../public/assets/manifest.json', import.meta.url);
    const manifest = parseManifest(JSON.parse(readFileSync(url, 'utf8')), PALETTE_NAMES);
    const defs = parseResources(resources, Object.keys(manifest.assets));
    expect(defs.tree_small?.footprint).toEqual({ width: 8, height: 6 });
    expect(defs.tall_grass?.footprint).toBeUndefined();
  });

  it('reporta sprites em falta, footprints inválidos e campos desconhecidos', () => {
    try {
      parseResources(
        {
          rock: { sprite: 'nope' },
          tree: { sprite: 'tree', footprint: { width: 0, height: 4 } },
          Bush: { sprite: 'tree', hp: 3 },
        },
        ['tree'],
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DataError);
      expect((error as DataError).problems).toEqual([
        expect.stringContaining('"nope"'),
        expect.stringContaining('footprint'),
        expect.stringContaining('snake_case'),
        expect.stringContaining('"hp"'),
      ]);
    }
  });
});

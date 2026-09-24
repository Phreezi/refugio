import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManifestError, parseManifest } from '../../src/assets/manifest';
import { PALETTE_NAMES } from '../../src/assets/palette';

const valid = {
  version: 1,
  assets: {
    tile_grass: { type: 'image', placeholder: { width: 16, height: 16, color: 'grass', border: 'forest' } },
    player: {
      type: 'image',
      file: 'sprites/player.png',
      placeholder: { width: 16, height: 32, color: 'sky', border: 'ink', letter: 'J' },
    },
  },
};

function problemsOf(input: unknown): readonly string[] {
  try {
    parseManifest(input, PALETTE_NAMES);
  } catch (error) {
    if (error instanceof ManifestError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseManifest', () => {
  it('aceita um manifest válido e devolve-o tipado', () => {
    const manifest = parseManifest(valid, PALETTE_NAMES);
    expect(manifest.assets.player).toEqual(valid.assets.player);
    expect(manifest.assets.tile_grass?.file).toBeUndefined();
  });

  it('o manifest real do jogo é válido', () => {
    const url = new URL('../../public/assets/manifest.json', import.meta.url);
    const json: unknown = JSON.parse(readFileSync(url, 'utf8'));
    expect(() => parseManifest(json, PALETTE_NAMES)).not.toThrow();
  });

  it('rejeita o que não é objeto', () => {
    expect(() => parseManifest(null, PALETTE_NAMES)).toThrow(ManifestError);
    expect(() => parseManifest([], PALETTE_NAMES)).toThrow(ManifestError);
  });

  it('exige version 1 e o objeto assets', () => {
    expect(problemsOf({ version: 2, assets: {} })).toEqual([expect.stringContaining('version')]);
    expect(problemsOf({ version: 1 })).toEqual([expect.stringContaining('"assets"')]);
  });

  it('junta todos os problemas numa só mensagem', () => {
    const problems = problemsOf({
      version: 1,
      assets: {
        BadKey: { type: 'image', placeholder: { width: 0, height: 16, color: 'verde' } },
        rock: { type: 'sound', placeholder: { width: 16, height: 16, color: 'stone', letter: 'AB' } },
      },
    });
    expect(problems).toEqual([
      expect.stringContaining('snake_case'),
      expect.stringContaining('width'),
      expect.stringContaining('color'),
      expect.stringContaining('type'),
      expect.stringContaining('letter'),
    ]);
  });

  it('deteta campos desconhecidos (gralhas)', () => {
    const problems = problemsOf({
      version: 1,
      assets: { rock: { type: 'image', placeholder: { width: 16, height: 16, colour: 'stone' } } },
    });
    expect(problems).toContainEqual(expect.stringContaining('"colour"'));
  });

  it('só aceita ficheiros relativos, em minúsculas, .png ou .webp', () => {
    const withFile = (file: unknown) => ({
      version: 1,
      assets: { rock: { type: 'image', file, placeholder: { width: 16, height: 16, color: 'stone' } } },
    });
    expect(problemsOf(withFile('tiles/rock.png'))).toEqual([]);
    expect(problemsOf(withFile('tiles/rock.webp'))).toEqual([]);
    for (const bad of [
      '/tiles/rock.png',
      '../rock.png',
      'tiles/Rock.png',
      'rock.gif',
      'http://x/rock.png',
      42,
    ]) {
      expect(problemsOf(withFile(bad)), String(bad)).toHaveLength(1);
    }
  });

  it('aceita letras acentuadas, também em forma decomposta (NFD)', () => {
    const withLetter = (letter: string) => ({
      version: 1,
      assets: { tree: { type: 'image', placeholder: { width: 16, height: 16, color: 'leaf', letter } } },
    });
    expect(parseManifest(withLetter('Á'), PALETTE_NAMES).assets.tree?.placeholder.letter).toBe('Á');
    expect(parseManifest(withLetter('Á'), PALETTE_NAMES).assets.tree?.placeholder.letter).toBe('Á');
    expect(problemsOf(withLetter(' '))).toHaveLength(1);
  });
});

describe('parseManifest: spritesheets', () => {
  const sheet = (patch: Record<string, unknown> = {}, placeholder: Record<string, unknown> = {}) => ({
    version: 1,
    assets: {
      hero: {
        type: 'spritesheet',
        frameWidth: 16,
        frameHeight: 32,
        columns: 10,
        rows: 4,
        placeholder: {
          width: 16,
          height: 32,
          color: 'sky',
          border: 'ink',
          style: 'character',
          ...placeholder,
        },
        ...patch,
      },
    },
  });

  it('aceita uma folha de personagem com o layout certo', () => {
    const entry = parseManifest(sheet(), PALETTE_NAMES).assets.hero;
    expect(entry?.type).toBe('spritesheet');
  });

  it('o placeholder tem de ter o tamanho de um frame', () => {
    expect(problemsOf(sheet({}, { width: 32 }))).toContainEqual(
      expect.stringContaining('tamanho de um frame'),
    );
  });

  it('style "character" exige a grelha das personagens', () => {
    expect(problemsOf(sheet({ columns: 4 }))).toEqual([expect.stringContaining('style "character"')]);
  });

  it('style só é permitido em spritesheets', () => {
    const image = {
      version: 1,
      assets: {
        rock: { type: 'image', placeholder: { width: 16, height: 16, color: 'stone', style: 'character' } },
      },
    };
    expect(problemsOf(image)).toEqual([expect.stringContaining('só se usa em spritesheets')]);
  });
});

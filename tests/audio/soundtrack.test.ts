import { describe, expect, it } from 'vitest';
import {
  chooseAmbience,
  chooseMood,
  composeSection,
  isTense,
  MOODS,
  moodSeed,
  SECTION_STEPS,
  THEMES,
  waterMaskFromTiled,
  waterNearness,
  type MoodInput,
} from '../../src/audio/soundtrack';

const game = (over: Partial<MoodInput>): MoodInput => ({
  scene: 'game',
  danger: 1,
  underground: false,
  night: false,
  ...over,
});

describe('Banda sonora: escolha do contexto (Fase 12)', () => {
  it('menu, casa, dia, noite, perigo, subúrbios e cavernas', () => {
    expect(chooseMood(game({ scene: 'none' }))).toBeNull();
    expect(chooseMood(game({ scene: 'menu' }))).toBe('menu');
    expect(chooseMood(game({ danger: 0 }))).toBe('home');
    expect(chooseMood(game({ danger: 0, night: true }))).toBe('home');
    expect(chooseMood(game({ danger: 1 }))).toBe('day');
    expect(chooseMood(game({ danger: 2, night: true }))).toBe('night');
    expect(chooseMood(game({ danger: 3 }))).toBe('danger');
    expect(chooseMood(game({ danger: 4, night: true }))).toBe('danger');
    expect(chooseMood(game({ danger: 2, biome: 'urban' }))).toBe('urban');
    expect(chooseMood(game({ danger: 2, biome: 'forest' }))).toBe('day');
    expect(chooseMood(game({ danger: 4, underground: true }))).toBe('cave');
  });

  it('ambiente: pássaros de dia, grilos de noite, pingos nas cavernas, nada no menu', () => {
    const day = chooseAmbience({ mood: 'day', night: false, water: 0 });
    expect(day.birds).toBeGreaterThan(0);
    expect(day.crickets).toBe(0);
    const night = chooseAmbience({ mood: 'night', night: true, water: 0.5 });
    expect(night.birds).toBe(0);
    expect(night.crickets).toBeGreaterThan(0);
    expect(night.water).toBe(0.5);
    expect(chooseAmbience({ mood: 'cave', night: false, water: 1 }).drips).toBeGreaterThan(0);
    expect(Object.values(chooseAmbience({ mood: 'menu', night: false, water: 1 }))).toEqual([0, 0, 0, 0, 0]);
  });

  it('tensão: inimigos a perseguir perto, ou horda', () => {
    const player = { x: 100, y: 100 };
    expect(isTense([], player)).toBe(false);
    expect(isTense([], player, true)).toBe(true);
    expect(isTense([{ x: 150, y: 100, state: 'chase' }], player)).toBe(true);
    expect(isTense([{ x: 150, y: 100, state: 'wander' }], player)).toBe(false);
    expect(isTense([{ x: 150, y: 100, state: 'flee' }], player)).toBe(false);
    expect(isTense([{ x: 1000, y: 100, state: 'chase' }], player)).toBe(false);
  });
});

describe('Banda sonora: água por perto', () => {
  const tiled = {
    width: 4,
    height: 3,
    tilesets: [{ name: 'base_tiles', firstgid: 1 }],
    layers: [
      { type: 'tilelayer', data: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5] },
      { type: 'objectgroup', objects: [] },
    ],
  };

  it('lê os tiles de água e mede a distância', () => {
    const mask = waterMaskFromTiled(tiled, 'base_tiles', [4]);
    expect(mask?.any).toBe(true);
    expect(mask?.mask[11]).toBe(1);
    expect(waterNearness(mask, 3, 2)).toBe(1);
    expect(waterNearness(mask, 0, 0)).toBeGreaterThan(0);
    expect(waterNearness(mask, 0, 0)).toBeLessThan(1);
    expect(waterNearness(mask, 0, 0, 2)).toBe(0);
    expect(waterMaskFromTiled(tiled, 'base_tiles', [9])?.any).toBe(false);
    expect(waterMaskFromTiled(null, 'base_tiles', [4])).toBeNull();
  });
});

describe('Banda sonora: frases com seed', () => {
  it('são deterministas e variam de secção para secção', () => {
    for (const mood of MOODS) {
      const theme = THEMES[mood];
      const seed = moodSeed(1234, mood);
      expect(composeSection(theme, seed, 3)).toEqual(composeSection(theme, seed, 3));
      const sections = new Set<string>();
      for (let i = 1; i <= 12; i++) sections.add(JSON.stringify(composeSection(theme, seed, i)));
      expect(sections.size, mood).toBeGreaterThanOrEqual(6);
    }
  });

  it('notas dentro da secção, em registos razoáveis; a primeira secção sem melodia', () => {
    for (const mood of MOODS) {
      const theme = THEMES[mood];
      expect(
        composeSection(theme, 7, 0).some((n) => n.voice === 'lead'),
        mood,
      ).toBe(false);
      for (let i = 0; i < 20; i++) {
        for (const note of composeSection(theme, 99, i)) {
          expect(note.at).toBeGreaterThanOrEqual(0);
          expect(note.at).toBeLessThan(SECTION_STEPS);
          expect(note.len).toBeGreaterThan(0);
          expect(note.at + note.len).toBeLessThanOrEqual(SECTION_STEPS);
          expect(note.vel).toBeGreaterThan(0);
          expect(note.vel).toBeLessThanOrEqual(1);
          if (note.voice !== 'hat' && note.voice !== 'kick') {
            expect(note.midi, mood).toBeGreaterThanOrEqual(24);
            expect(note.midi, mood).toBeLessThanOrEqual(96);
          }
        }
      }
    }
  });

  it('cada tema tem a sua seed', () => {
    expect(moodSeed(1, 'day')).not.toBe(moodSeed(1, 'night'));
  });
});

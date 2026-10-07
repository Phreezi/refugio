// Banda sonora (CLAUDE.md Fase 12, "música por zona"): a lógica pura, sem Web Audio, para dar
// para testar. Escolhe a música (o "ambiente musical") e os sons de ambiente a partir da zona,
// da hora e do perigo, e compõe as frases de cada tema com seed: o mesmo tema nunca toca duas
// vezes seguidas igual, mas é sempre o mesmo para a mesma seed. Quem toca é music.ts/ambience.ts.

/** Música por contexto. */
export const MOODS = ['menu', 'home', 'day', 'night', 'danger', 'urban', 'cave'] as const;
export type Mood = (typeof MOODS)[number];

/** O que a escolha precisa de saber (tirado do jogo pelo diretor, em soundtrackDirector.ts). */
export interface MoodInput {
  /** Menu inicial, em jogo (zona ou mapa-mundo) ou nada (a arrancar). */
  scene: 'menu' | 'game' | 'none';
  /** Perigo da zona (0 = base, 1–4 = T1–T4). */
  danger: number;
  /** Masmorra (bunker) ou zona sempre escura (cavernas). */
  underground: boolean;
  /** Bioma das zonas geradas (`urban` = subúrbios); omisso nas desenhadas à mão. */
  biome?: string;
  night: boolean;
}

/** Perigo a partir do qual a música é a das zonas perigosas (T3–T4). */
export const DANGER_MOOD_FROM = 3;

export function chooseMood(input: MoodInput): Mood | null {
  if (input.scene === 'none') return null;
  if (input.scene === 'menu') return 'menu';
  if (input.underground) return 'cave';
  // A casa é sempre acolhedora (também de noite: é o sítio seguro).
  if (input.danger <= 0) return 'home';
  if (input.biome === 'urban') return 'urban';
  if (input.danger >= DANGER_MOOD_FROM) return 'danger';
  return input.night ? 'night' : 'day';
}

/** Camadas de ambiente (0–1 cada). */
export interface AmbienceMix {
  wind: number;
  birds: number;
  crickets: number;
  water: number;
  drips: number;
}

export const SILENT_AMBIENCE: Readonly<AmbienceMix> = { wind: 0, birds: 0, crickets: 0, water: 0, drips: 0 };

export interface AmbienceInput {
  mood: Mood | null;
  night: boolean;
  /** Proximidade de água (0 = longe, 1 = ao lado), de `waterNearness`. */
  water: number;
}

export function chooseAmbience(input: AmbienceInput): AmbienceMix {
  const { mood, night } = input;
  if (mood === null || mood === 'menu') return { ...SILENT_AMBIENCE };
  if (mood === 'cave') return { wind: 0.35, birds: 0, crickets: 0, water: 0, drips: 1 };
  const urban = mood === 'urban';
  const danger = mood === 'danger';
  return {
    wind: urban ? 0.7 : danger ? 0.8 : night ? 0.45 : 0.55,
    // Pássaros só de dia; menos onde há perigo ou casas.
    birds: night ? 0 : urban ? 0.25 : danger ? 0.35 : 1,
    crickets: night ? (urban ? 0.4 : 1) : 0,
    water: Math.max(0, Math.min(1, input.water)),
    drips: 0,
  };
}

/** Distância (px) até à qual um inimigo a perseguir põe a música em tensão. */
export const TENSION_RANGE_PX = 260;
/** Estados de um inimigo que luta com o jogador (os de `Combat`; fugir não conta). */
const FIGHTING = new Set(['chase', 'windup', 'recover', 'charge']);

/** Há inimigos a perseguir o jogador perto (ou uma horda a decorrer)? */
export function isTense(
  enemies: readonly { x: number; y: number; state: string }[],
  player: { x: number; y: number },
  horde = false,
): boolean {
  if (horde) return true;
  const range2 = TENSION_RANGE_PX * TENSION_RANGE_PX;
  return enemies.some(
    (e) => FIGHTING.has(e.state) && (e.x - player.x) ** 2 + (e.y - player.y) ** 2 <= range2,
  );
}

// --- Água por perto -------------------------------------------------------------------------

/** Tiles de água de um mapa (1 = água), a partir do JSON do Tiled. */
export interface WaterMask {
  width: number;
  height: number;
  mask: Uint8Array;
  /** Há alguma água? (para não procurar à toa) */
  any: boolean;
}

/**
 * Lê os tiles de água (`water`, `waterfall` do tileset da base) de todas as camadas de tiles
 * de um mapa Tiled. `waterIds` são os ids locais desses tiles no tileset `tileset`.
 */
export function waterMaskFromTiled(
  json: unknown,
  tileset: string,
  waterIds: readonly number[],
): WaterMask | null {
  if (typeof json !== 'object' || json === null) return null;
  const map = json as { width?: unknown; height?: unknown; layers?: unknown; tilesets?: unknown };
  if (typeof map.width !== 'number' || typeof map.height !== 'number') return null;
  if (!Array.isArray(map.tilesets) || !Array.isArray(map.layers)) return null;
  const set = (map.tilesets as { name?: unknown; firstgid?: unknown }[]).find((s) => s.name === tileset);
  if (!set || typeof set.firstgid !== 'number') return null;
  const first = set.firstgid;
  const gids = new Set(waterIds.map((id) => first + id));
  const mask = new Uint8Array(map.width * map.height);
  let any = false;
  for (const layer of map.layers as { type?: unknown; data?: unknown }[]) {
    if (layer.type !== 'tilelayer' || !Array.isArray(layer.data)) continue;
    const data = layer.data as unknown[];
    for (let i = 0; i < mask.length && i < data.length; i++) {
      const gid = data[i];
      // Os bits altos do gid são as rotações do Tiled.
      if (typeof gid === 'number' && gids.has(gid & 0x0fffffff)) {
        mask[i] = 1;
        any = true;
      }
    }
  }
  return { width: map.width, height: map.height, mask, any };
}

/** Raio (tiles) em que a água se ouve. */
export const WATER_HEAR_TILES = 7;

/** Proximidade da água ao tile (tx, ty): 1 = ao lado, 0 = a `radius` tiles ou mais. */
export function waterNearness(
  water: WaterMask | null,
  tx: number,
  ty: number,
  radius = WATER_HEAR_TILES,
): number {
  if (!water?.any) return 0;
  let best = Infinity;
  const cx = Math.floor(tx);
  const cy = Math.floor(ty);
  for (let y = Math.max(0, cy - radius); y <= Math.min(water.height - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(water.width - 1, cx + radius); x++) {
      if (water.mask[y * water.width + x] !== 1) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < best) best = d;
    }
  }
  if (best === Infinity) return 0;
  return Math.max(0, Math.min(1, 1 - (best - 1) / radius));
}

// --- Temas e frases -------------------------------------------------------------------------

export type Voice = 'lead' | 'arp' | 'bass' | 'pad' | 'hat' | 'kick';

/** Uma nota de uma secção: passo (semicolcheias desde o início da secção), MIDI, duração, voz. */
export interface Note {
  at: number;
  midi: number;
  len: number;
  voice: Voice;
  /** Volume relativo (0–1) dentro da voz. */
  vel: number;
}

export interface Theme {
  bpm: number;
  /** Tónica (MIDI) da oitava do meio. */
  root: number;
  /** Escala (meios-tons a partir da tónica, 7 graus). */
  scale: readonly number[];
  /** Progressões (graus da escala, um por compasso, 4 compassos). */
  progressions: readonly (readonly number[])[];
  /** Notas da melodia por colcheia (0–1). */
  density: number;
  /** Probabilidade de uma secção sem melodia (respira). */
  restChance: number;
  /** Arpejo em colcheias: probabilidade de cada secção o ter. */
  arpChance: number;
  /** Baixo: 'pulse' = colcheias (tenso), 'walk' = tempos 1 e 3 + quinta, 'drone' = nota longa. */
  bass: 'pulse' | 'walk' | 'drone';
  /** Percussão suave: chocalho nas colcheias ('shaker'), batida nos tempos ('beat') ou nada. */
  perc: 'shaker' | 'beat' | 'none';
  /** Pad (acorde longo) em cada compasso? */
  pad: boolean;
  /** Ondas de cada voz. */
  leadWave: OscillatorType;
  arpWave: OscillatorType;
  /** Filtro (Hz) da faixa: menos brilho = mais calmo/escuro. */
  cutoff: number;
  /** Eco (0–1): quanto vai para o atraso com realimentação. */
  echo: number;
  /** Volume da faixa (a de casa é a referência). */
  gain: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

export const THEMES: Readonly<Record<Mood, Theme>> = {
  // Lá menor (o tema de sempre): Am – F – C – G e variações.
  menu: {
    bpm: 80,
    root: 57,
    scale: MINOR,
    progressions: [
      [0, 5, 2, 6],
      [0, 3, 5, 6],
      [5, 2, 6, 0],
    ],
    density: 0.45,
    restChance: 0.15,
    arpChance: 0.8,
    bass: 'walk',
    perc: 'none',
    pad: false,
    leadWave: 'triangle',
    arpWave: 'square',
    cutoff: 2600,
    echo: 0.3,
    gain: 1,
  },
  // Casa: Fá maior, lento e quente, com chocalho leve.
  home: {
    bpm: 76,
    root: 53,
    scale: MAJOR,
    progressions: [
      [0, 4, 5, 3],
      [0, 3, 4, 4],
      [5, 3, 0, 4],
      [0, 5, 3, 4],
      [3, 4, 2, 5],
    ],
    density: 0.5,
    restChance: 0.25,
    arpChance: 0.6,
    bass: 'walk',
    perc: 'shaker',
    pad: true,
    leadWave: 'triangle',
    arpWave: 'square',
    cutoff: 2400,
    echo: 0.25,
    gain: 1,
  },
  // Natureza de dia: Sol maior, mais andamento, chiptune leve.
  day: {
    bpm: 96,
    root: 55,
    scale: MAJOR,
    progressions: [
      [0, 3, 4, 0],
      [0, 5, 3, 4],
      [3, 0, 4, 5],
      [0, 1, 3, 4],
    ],
    density: 0.55,
    restChance: 0.3,
    arpChance: 0.5,
    bass: 'walk',
    perc: 'shaker',
    pad: false,
    leadWave: 'square',
    arpWave: 'triangle',
    cutoff: 3000,
    echo: 0.2,
    gain: 0.85,
  },
  // Noite: Ré dórico, escasso, muito eco.
  night: {
    bpm: 62,
    root: 50,
    scale: DORIAN,
    progressions: [
      [0, 6, 3, 0],
      [0, 3, 6, 4],
      [5, 6, 0, 0],
    ],
    density: 0.25,
    restChance: 0.4,
    arpChance: 0.2,
    bass: 'drone',
    perc: 'none',
    pad: true,
    leadWave: 'sine',
    arpWave: 'triangle',
    cutoff: 1500,
    echo: 0.5,
    gain: 1,
  },
  // Zonas perigosas (T3–T4): Mi frígio, baixo em colcheias, batida surda.
  danger: {
    bpm: 100,
    root: 52,
    scale: PHRYGIAN,
    progressions: [
      [0, 1, 0, 6],
      [0, 5, 1, 0],
      [0, 0, 5, 6],
    ],
    density: 0.35,
    restChance: 0.35,
    arpChance: 0.3,
    bass: 'pulse',
    perc: 'beat',
    pad: true,
    leadWave: 'sawtooth',
    arpWave: 'square',
    cutoff: 1700,
    echo: 0.3,
    gain: 0.8,
  },
  // Subúrbios: Fá dórico, baixo sincopado e chocalho (cidade vazia, um pouco de groove).
  urban: {
    bpm: 88,
    root: 53,
    scale: DORIAN,
    progressions: [
      [0, 3, 0, 4],
      [0, 6, 5, 3],
      [3, 4, 0, 0],
    ],
    density: 0.4,
    restChance: 0.3,
    arpChance: 0.5,
    bass: 'pulse',
    perc: 'shaker',
    pad: true,
    leadWave: 'square',
    arpWave: 'square',
    cutoff: 2000,
    echo: 0.35,
    gain: 0.8,
  },
  // Cavernas e masmorras: Lá menor grave, quase só pad e notas soltas com eco.
  cave: {
    bpm: 54,
    root: 45,
    scale: MINOR,
    progressions: [
      [0, 0, 5, 0],
      [0, 6, 5, 4],
      [0, 1, 0, 6],
    ],
    density: 0.18,
    restChance: 0.35,
    arpChance: 0,
    bass: 'drone',
    perc: 'none',
    pad: true,
    leadWave: 'sine',
    arpWave: 'triangle',
    cutoff: 1100,
    echo: 0.55,
    gain: 1.1,
  },
};

export const BARS_PER_SECTION = 4;
export const STEPS_PER_BAR = 16;
export const SECTION_STEPS = BARS_PER_SECTION * STEPS_PER_BAR;

/** Duração de uma semicolcheia (s). */
export function stepSec(theme: Theme): number {
  return 60 / theme.bpm / 4;
}

/** RNG mulberry32 (o mesmo do core/Rng.ts, mas local: a música não mexe no estado do jogo). */
function rngFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nota MIDI de um grau da escala (pode passar de 7: sobe oitavas). */
function degreeMidi(theme: Theme, degree: number): number {
  const octave = Math.floor(degree / 7);
  const index = ((degree % 7) + 7) % 7;
  return theme.root + octave * 12 + (theme.scale[index] ?? 0);
}

/** Graus do acorde (tríade) num grau. */
function triad(degree: number): number[] {
  return [degree, degree + 2, degree + 4];
}

/**
 * Compõe a secção `index` (4 compassos) de um tema. Determinista: a mesma seed e o mesmo índice
 * dão sempre as mesmas notas. A primeira secção não tem melodia (entra devagar).
 */
export function composeSection(theme: Theme, seed: number, index: number): Note[] {
  const rnd = rngFrom(Math.imul(seed ^ 0x9e3779b9, 31) + index * 7919);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)] ?? (list[0] as T);
  const notes: Note[] = [];
  const progression = pick(theme.progressions);
  const withLead = index > 0 && rnd() >= theme.restChance;
  const withArp = rnd() < theme.arpChance;
  // Melodia uma oitava acima, às vezes duas (variação de registo).
  const leadOctave = rnd() < 0.25 ? 14 : 7;

  for (let bar = 0; bar < BARS_PER_SECTION; bar++) {
    const chord = triad(progression[bar] ?? 0);
    const start = bar * STEPS_PER_BAR;
    const rootDegree = chord[0] ?? 0;
    // Baixo (uma oitava abaixo da tónica).
    const bassRoot = degreeMidi(theme, rootDegree) - 12;
    if (theme.bass === 'drone') {
      notes.push({ at: start, midi: bassRoot, len: STEPS_PER_BAR, voice: 'bass', vel: 0.8 });
    } else if (theme.bass === 'walk') {
      notes.push({ at: start, midi: bassRoot, len: 6, voice: 'bass', vel: 1 });
      notes.push({ at: start + 8, midi: bassRoot, len: 4, voice: 'bass', vel: 0.85 });
      notes.push({
        at: start + 12,
        midi: degreeMidi(theme, rootDegree + 4) - 12,
        len: 3,
        voice: 'bass',
        vel: 0.7,
      });
    } else {
      for (let s = 0; s < STEPS_PER_BAR; s += 2) {
        // Colcheias, com acentos no 1 e no 3 e uma oitava de vez em quando.
        const up = s === 6 || s === 14 ? 12 : 0;
        notes.push({
          at: start + s,
          midi: bassRoot + up,
          len: 1.5,
          voice: 'bass',
          vel: s % 8 === 0 ? 1 : 0.6,
        });
      }
    }
    if (theme.pad) {
      for (const degree of chord) {
        notes.push({
          at: start,
          midi: degreeMidi(theme, degree),
          len: STEPS_PER_BAR,
          voice: 'pad',
          vel: 0.7,
        });
      }
    }
    if (withArp) {
      // Arpejo a subir ou a descer (sorteado por compasso).
      const order = rnd() < 0.5 ? [0, 1, 2, 1] : [2, 1, 0, 1];
      for (let s = 0; s < STEPS_PER_BAR; s += 2) {
        const degree = chord[order[(s / 2) % 4] ?? 0] ?? rootDegree;
        notes.push({ at: start + s, midi: degreeMidi(theme, degree + 7), len: 1.6, voice: 'arp', vel: 0.8 });
      }
    }
    if (theme.perc === 'shaker') {
      for (let s = 0; s < STEPS_PER_BAR; s += 2) {
        if (s % 4 === 2 || rnd() < 0.3)
          notes.push({ at: start + s, midi: 0, len: 1, voice: 'hat', vel: s % 4 === 2 ? 1 : 0.5 });
      }
    } else if (theme.perc === 'beat') {
      notes.push({ at: start, midi: 0, len: 2, voice: 'kick', vel: 1 });
      notes.push({ at: start + 8, midi: 0, len: 2, voice: 'kick', vel: 0.8 });
      if (rnd() < 0.5) notes.push({ at: start + 14, midi: 0, len: 1, voice: 'kick', vel: 0.5 });
    }
  }

  if (withLead) notes.push(...composeMelody(theme, progression, rnd, leadOctave));
  return notes;
}

/**
 * Melodia de 4 compassos em forma A A' A B: um ritmo de compasso repetido (com as alturas a
 * andar), notas fortes nas notas do acorde e o último compasso a acabar na tónica do acorde.
 */
function composeMelody(
  theme: Theme,
  progression: readonly number[],
  rnd: () => number,
  octave: number,
): Note[] {
  const notes: Note[] = [];
  const rhythm = (): number[] => {
    const onsets: number[] = [0];
    for (let s = 2; s < STEPS_PER_BAR; s += 2) if (rnd() < theme.density) onsets.push(s);
    return onsets;
  };
  const motif = rhythm();
  const ending = rhythm().filter((s) => s <= 8);
  let degree = octave + (rnd() < 0.5 ? 2 : 4);
  for (let bar = 0; bar < BARS_PER_SECTION; bar++) {
    const onsets = bar === BARS_PER_SECTION - 1 ? ending : motif;
    const chord = triad(progression[bar] ?? 0).map((d) => d + octave);
    for (let i = 0; i < onsets.length; i++) {
      const at = onsets[i] ?? 0;
      const next = onsets[i + 1] ?? STEPS_PER_BAR;
      if (at === 0 || at === 8) {
        // Tempo forte: a nota do acorde mais perto.
        degree = chord.reduce(
          (a, b) => (Math.abs(b - degree) < Math.abs(a - degree) ? b : a),
          chord[0] ?? degree,
        );
      } else {
        const r = rnd();
        degree += r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.85 ? 2 : -2;
      }
      // Fica no registo (uma oitava e meia).
      degree = Math.max(octave - 1, Math.min(octave + 9, degree));
      const last = bar === BARS_PER_SECTION - 1 && i === onsets.length - 1;
      if (last) degree = chord[0] ?? degree;
      const len = last ? STEPS_PER_BAR - at : Math.min(next - at, 6);
      notes.push({
        at: bar * STEPS_PER_BAR + at,
        midi: degreeMidi(theme, degree),
        len,
        voice: 'lead',
        vel: at % 8 === 0 ? 1 : 0.8,
      });
    }
  }
  return notes;
}

/** Batidas da camada de tensão num compasso (passos e volume): bombo e tambor grave. */
export const TENSION_HITS: readonly (readonly [step: number, vel: number])[] = [
  [0, 1],
  [3, 0.45],
  [6, 0.6],
  [8, 0.9],
  [11, 0.45],
  [12, 0.6],
  [14, 0.5],
];

/** Semente a partir do nome do tema (para cada um ter as suas frases com a mesma seed). */
export function moodSeed(base: number, mood: Mood): number {
  let h = base >>> 0;
  for (let i = 0; i < mood.length; i++) h = Math.imul(h ^ mood.charCodeAt(i), 16777619) >>> 0;
  return h;
}

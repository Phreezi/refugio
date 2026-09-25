// Música de fundo sintetizada (Web Audio), como os efeitos: um loop calmo em estilo chiptune
// (lá menor: Am – F – C – G), sem ficheiros nem licenças. Volume próprio nas definições
// (`musicVolume`). As notas agendam-se um pouco à frente do relógio do áudio (sem soluços).

import { preferences } from '../ui/preferences';
// Import circular com sfx.ts: só se usa dentro de funções (depois de ambos carregarem).
import { sfx } from './sfx';

/** Volume geral da música por cima da preferência (fica por baixo dos efeitos). */
const MUSIC_MASTER = 0.22;
const BPM = 84;
const STEP_SEC = 60 / BPM / 4;
const STEPS_PER_BAR = 16;
/** Agenda até isto à frente (s), a cada `TICK_MS`. */
const LOOKAHEAD_SEC = 0.35;
const TICK_MS = 100;

/** Acordes (notas MIDI) de cada compasso: Am, F, C, G. */
const CHORDS: readonly (readonly number[])[] = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];

/** Melodia por compasso (8 compassos): [passo, nota MIDI, duração em passos]. */
const MELODY: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0, 76, 4],
    [4, 72, 2],
    [6, 74, 2],
    [8, 76, 6],
  ],
  [
    [0, 77, 4],
    [4, 76, 2],
    [6, 72, 2],
    [8, 69, 8],
  ],
  [
    [0, 72, 4],
    [4, 74, 2],
    [6, 76, 2],
    [8, 79, 6],
  ],
  [
    [0, 79, 3],
    [4, 77, 2],
    [6, 74, 2],
    [8, 71, 8],
  ],
  [
    [0, 69, 2],
    [2, 72, 2],
    [4, 76, 4],
    [10, 74, 4],
  ],
  [
    [0, 72, 4],
    [4, 69, 4],
    [8, 65, 8],
  ],
  [
    [0, 67, 2],
    [2, 72, 2],
    [4, 76, 4],
    [8, 79, 4],
    [12, 77, 2],
  ],
  [
    [0, 76, 4],
    [4, 74, 4],
    [8, 71, 6],
  ],
];

const freq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

class Music {
  private gain: GainNode | null = null;
  private timer: number | null = null;
  /** Próximo passo a agendar (conta desde o início) e a sua hora no relógio do áudio. */
  private step = 0;
  private nextTime = 0;

  /** Começa (depois do primeiro gesto, com o contexto de áudio já criado). */
  start(): void {
    const context = sfx.audioContext;
    if (!context || this.timer !== null) return;
    this.gain = context.createGain();
    this.gain.connect(context.destination);
    this.refresh();
    this.nextTime = context.currentTime + 0.1;
    this.timer = window.setInterval(() => {
      this.schedule();
    }, TICK_MS);
  }

  /** Aplica o volume das preferências (0 = silêncio). */
  refresh(): void {
    const context = sfx.audioContext;
    if (!this.gain || !context) return;
    this.gain.gain.setTargetAtTime(preferences().musicVolume * MUSIC_MASTER, context.currentTime, 0.05);
  }

  private schedule(): void {
    const context = sfx.audioContext;
    if (!context || !this.gain || context.state !== 'running') return;
    // Sem volume, não agenda (e retoma no sítio certo quando voltar a haver).
    if (preferences().musicVolume <= 0) {
      this.nextTime = context.currentTime + 0.1;
      return;
    }
    // O separador esteve escondido: não tentar recuperar o tempo perdido.
    if (this.nextTime < context.currentTime) this.nextTime = context.currentTime + 0.05;
    while (this.nextTime < context.currentTime + LOOKAHEAD_SEC) {
      this.playStep(context, this.step, this.nextTime);
      this.step += 1;
      this.nextTime += STEP_SEC;
    }
  }

  private playStep(context: AudioContext, step: number, time: number): void {
    const inBar = step % STEPS_PER_BAR;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const chord = CHORDS[bar % CHORDS.length] ?? CHORDS[0] ?? [];
    const root = chord[0] ?? 57;
    // Baixo: raiz nos tempos 1 e 3, quinta no 4.
    if (inBar === 0 || inBar === 8) this.note(context, 'triangle', root - 12, time, STEP_SEC * 6, 0.5);
    if (inBar === 12) this.note(context, 'triangle', root - 5, time, STEP_SEC * 3, 0.4);
    // Arpejo suave em colcheias.
    if (inBar % 2 === 0) {
      const tone = chord[(inBar / 2) % chord.length] ?? root;
      this.note(context, 'square', tone, time, STEP_SEC * 1.6, 0.07);
    }
    // Melodia (a partir da 2.ª volta, para começar mais calmo).
    if (bar >= CHORDS.length) {
      for (const [at, midi, length] of MELODY[bar % MELODY.length] ?? []) {
        if (at === inBar) this.note(context, 'triangle', midi, time, STEP_SEC * length, 0.3);
      }
    }
  }

  private note(
    context: AudioContext,
    wave: OscillatorType,
    midi: number,
    time: number,
    length: number,
    volume: number,
  ): void {
    const out = this.gain;
    if (!out) return;
    const osc = context.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq(midi), time);
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(volume, time + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, time + length);
    osc.connect(env).connect(out);
    osc.start(time);
    osc.stop(time + length + 0.05);
  }
}

export const music = new Music();

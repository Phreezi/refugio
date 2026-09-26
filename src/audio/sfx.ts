// Efeitos sonoros gerados por síntese (Web Audio), sem ficheiros de áudio (CLAUDE.md Fase 12):
// ondas simples e ruído com envolventes curtas, no espírito do sfxr. Não há licenças a registar
// e não pesa nada no bundle. Tocam ao ouvir os eventos do jogo (EventBus).

import { eventBus, type EventBus, type GameEvents } from '../core/EventBus';
import { preferences } from '../ui/preferences';
import { music } from './music';

type Wave = OscillatorType;

/** Uma nota: onda, frequência inicial → final, duração, volume relativo e atraso. */
interface Tone {
  wave: Wave;
  from: number;
  to?: number;
  sec: number;
  gain?: number;
  delay?: number;
}

/** Ruído filtrado (golpes, passos, explosões). */
interface Noise {
  sec: number;
  /** Frequência do filtro passa-baixo (Hz). */
  cutoff: number;
  cutoffTo?: number;
  gain?: number;
  delay?: number;
}

type Sound = readonly (Tone | Noise)[];

const isNoise = (part: Tone | Noise): part is Noise => 'cutoff' in part;

/** Os sons do jogo. */
export const SOUNDS = {
  swing: [{ sec: 0.09, cutoff: 1800, cutoffTo: 600, gain: 0.25 }],
  hit: [
    { sec: 0.08, cutoff: 2500, cutoffTo: 400, gain: 0.5 },
    { wave: 'square', from: 180, to: 70, sec: 0.08, gain: 0.25 },
  ],
  chop: [
    { wave: 'triangle', from: 220, to: 120, sec: 0.07, gain: 0.6 },
    { sec: 0.05, cutoff: 1400, gain: 0.3 },
  ],
  crack: [
    { wave: 'triangle', from: 260, to: 90, sec: 0.14, gain: 0.6 },
    { sec: 0.18, cutoff: 900, cutoffTo: 200, gain: 0.45 },
  ],
  pickup: [
    { wave: 'square', from: 660, sec: 0.05, gain: 0.18 },
    { wave: 'square', from: 990, sec: 0.07, gain: 0.18, delay: 0.05 },
  ],
  hurt: [
    { wave: 'square', from: 220, to: 80, sec: 0.16, gain: 0.3 },
    { sec: 0.1, cutoff: 1200, gain: 0.25 },
  ],
  enemyDown: [
    { wave: 'sawtooth', from: 300, to: 60, sec: 0.25, gain: 0.2 },
    { sec: 0.12, cutoff: 800, gain: 0.3 },
  ],
  explosion: [
    { sec: 0.6, cutoff: 1200, cutoffTo: 80, gain: 0.8 },
    { wave: 'sine', from: 90, to: 30, sec: 0.5, gain: 0.5 },
  ],
  scream: [{ wave: 'sawtooth', from: 520, to: 780, sec: 0.35, gain: 0.15 }],
  spit: [
    { sec: 0.12, cutoff: 900, cutoffTo: 300, gain: 0.35 },
    { wave: 'sine', from: 300, to: 120, sec: 0.1, gain: 0.2 },
  ],
  craft: [
    { wave: 'triangle', from: 523, sec: 0.08, gain: 0.3 },
    { wave: 'triangle', from: 659, sec: 0.08, gain: 0.3, delay: 0.08 },
    { wave: 'triangle', from: 784, sec: 0.14, gain: 0.3, delay: 0.16 },
  ],
  build: [
    { wave: 'sine', from: 140, to: 70, sec: 0.12, gain: 0.6 },
    { sec: 0.08, cutoff: 700, gain: 0.35 },
  ],
  demolish: [{ sec: 0.25, cutoff: 900, cutoffTo: 150, gain: 0.5 }],
  door: [{ wave: 'triangle', from: 330, to: 250, sec: 0.12, gain: 0.25 }],
  open: [
    { wave: 'triangle', from: 392, sec: 0.05, gain: 0.2 },
    { wave: 'triangle', from: 523, sec: 0.07, gain: 0.2, delay: 0.05 },
  ],
  eat: [
    { wave: 'square', from: 300, to: 200, sec: 0.05, gain: 0.15 },
    { wave: 'square', from: 280, to: 190, sec: 0.05, gain: 0.15, delay: 0.09 },
  ],
  splash: [{ sec: 0.3, cutoff: 3000, cutoffTo: 500, gain: 0.35 }],
  fish: [
    { wave: 'square', from: 784, sec: 0.06, gain: 0.18 },
    { wave: 'square', from: 1047, sec: 0.12, gain: 0.18, delay: 0.07 },
  ],
  blocked: [{ wave: 'square', from: 150, sec: 0.12, gain: 0.15 }],
  levelUp: [
    { wave: 'square', from: 523, sec: 0.1, gain: 0.18 },
    { wave: 'square', from: 659, sec: 0.1, gain: 0.18, delay: 0.1 },
    { wave: 'square', from: 784, sec: 0.1, gain: 0.18, delay: 0.2 },
    { wave: 'square', from: 1047, sec: 0.3, gain: 0.2, delay: 0.3 },
  ],
  alarm: [
    { wave: 'sawtooth', from: 440, to: 330, sec: 0.3, gain: 0.15 },
    { wave: 'sawtooth', from: 440, to: 330, sec: 0.3, gain: 0.15, delay: 0.35 },
  ],
  died: [
    { wave: 'triangle', from: 392, to: 196, sec: 0.5, gain: 0.3 },
    { wave: 'triangle', from: 294, to: 147, sec: 0.6, gain: 0.25, delay: 0.25 },
  ],
  click: [{ wave: 'square', from: 880, sec: 0.025, gain: 0.08 }],
} as const satisfies Record<string, Sound>;

export type SoundName = keyof typeof SOUNDS;

/** Volume geral por cima do das preferências (os sons sintetizados são fortes). */
const MASTER = 0.35;
/** O mesmo som não se repete dentro deste intervalo (ms): evita "metralhadora" de eventos. */
const REPEAT_MS = 45;

class Sfx {
  private context: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly lastPlayed = new Map<SoundName, number>();

  /**
   * Os browsers só deixam tocar som depois de um gesto (toque, tecla): o contexto cria-se (ou
   * retoma-se) aí.
   */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
  }

  /** O contexto de áudio (partilhado com a música), depois do primeiro gesto. */
  get audioContext(): AudioContext | null {
    return this.context;
  }

  play(name: SoundName): void {
    const volume = preferences().volume;
    const context = this.context;
    if (context?.state !== 'running' || volume <= 0) return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < REPEAT_MS) return;
    this.lastPlayed.set(name, now);
    const out = context.createGain();
    out.gain.value = volume * MASTER;
    out.connect(context.destination);
    for (const part of SOUNDS[name] as Sound) {
      if (isNoise(part)) this.noise(context, out, part);
      else this.tone(context, out, part);
    }
  }

  private tone(context: AudioContext, out: AudioNode, part: Tone): void {
    const start = context.currentTime + (part.delay ?? 0);
    const end = start + part.sec;
    const osc = context.createOscillator();
    osc.type = part.wave;
    osc.frequency.setValueAtTime(part.from, start);
    if (part.to !== undefined) osc.frequency.exponentialRampToValueAtTime(part.to, end);
    const gain = this.envelope(context, part.gain ?? 1, start, end);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  private noise(context: AudioContext, out: AudioNode, part: Noise): void {
    const start = context.currentTime + (part.delay ?? 0);
    const end = start + part.sec;
    const source = context.createBufferSource();
    source.buffer = this.whiteNoise(context);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(part.cutoff, start);
    if (part.cutoffTo !== undefined) filter.frequency.exponentialRampToValueAtTime(part.cutoffTo, end);
    const gain = this.envelope(context, part.gain ?? 1, start, end);
    source.connect(filter).connect(gain).connect(out);
    source.start(start);
    source.stop(end + 0.02);
  }

  /** Ataque rápido (5 ms) e queda até ao fim. */
  private envelope(context: AudioContext, peak: number, start: number, end: number): GainNode {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    return gain;
  }

  private whiteNoise(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(context.sampleRate * 0.6);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }
}

export const sfx = new Sfx();

/** Liga os sons aos eventos do jogo (uma vez, no arranque). */
export function installSfx(bus: EventBus<GameEvents> = eventBus): void {
  const unlock = (): void => {
    sfx.unlock();
    music.start();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  bus.on('player:action', ({ kind }) => {
    if (kind === 'swing') sfx.play('swing');
  });
  bus.on('enemy:hit', () => {
    sfx.play('hit');
  });
  bus.on('resource:hit', ({ hp }) => {
    sfx.play(hp <= 0 ? 'crack' : 'chop');
  });
  bus.on('item:gained', () => {
    sfx.play('pickup');
  });
  bus.on('player:damaged', () => {
    sfx.play('hurt');
  });
  bus.on('enemy:killed', () => {
    sfx.play('enemyDown');
  });
  bus.on('enemy:exploded', () => {
    sfx.play('explosion');
  });
  bus.on('enemy:scream', () => {
    sfx.play('scream');
  });
  bus.on('enemy:spit', () => {
    sfx.play('spit');
  });
  bus.on('craft:finished', () => {
    sfx.play('craft');
  });
  bus.on('structure:placed', () => {
    sfx.play('build');
  });
  bus.on('structure:destroyed', () => {
    sfx.play('demolish');
  });
  bus.on('container:open', () => {
    sfx.play('open');
  });
  bus.on('station:open', () => {
    sfx.play('open');
  });
  bus.on('player:consumed', () => {
    sfx.play('eat');
  });
  bus.on('fishing:started', () => {
    sfx.play('splash');
  });
  bus.on('fishing:filled', () => {
    sfx.play('splash');
  });
  bus.on('fishing:result', ({ caught }) => {
    sfx.play(caught ? 'fish' : 'splash');
  });
  bus.on('action:blocked', () => {
    sfx.play('blocked');
  });
  bus.on('player:levelUp', () => {
    sfx.play('levelUp');
  });
  bus.on('horde:started', () => {
    sfx.play('alarm');
  });
  bus.on('player:died', () => {
    sfx.play('died');
  });
}

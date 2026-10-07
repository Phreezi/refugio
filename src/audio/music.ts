// Música de fundo sintetizada (Web Audio), como os efeitos: um tema por contexto (casa, natureza
// de dia, noite, zonas perigosas, subúrbios, cavernas e menu; ver soundtrack.ts), composto por
// código em secções de 4 compassos com seed, sem ficheiros nem licenças. Volume próprio nas
// definições (`musicVolume`). As notas agendam-se um pouco à frente do relógio do áudio (sem
// soluços); ao mudar de contexto, o tema velho e o novo cruzam-se em `CROSSFADE_SEC`.

import { preferences } from '../ui/preferences';
import {
  composeSection,
  moodSeed,
  SECTION_STEPS,
  STEPS_PER_BAR,
  stepSec,
  TENSION_HITS,
  THEMES,
  type Mood,
  type Note,
  type Theme,
} from './soundtrack';
// Import circular com sfx.ts: só se usa dentro de funções (depois de ambos carregarem).
import { sfx } from './sfx';

/** Volume geral da música por cima da preferência (fica por baixo dos efeitos). */
const MUSIC_MASTER = 0.22;
/** Agenda até isto à frente (s), a cada `TICK_MS`. */
const LOOKAHEAD_SEC = 0.35;
const TICK_MS = 100;
/** Cruzamento entre temas (s). */
export const CROSSFADE_SEC = 2;
/** Volume com o menu de pausa aberto (fração). */
export const PAUSE_DUCK = 0.35;
/** Entrada/saída da camada de tensão (constante de tempo, s). */
const TENSION_FADE_SEC = 0.6;

/** Volume de cada voz (antes do da faixa). */
const VOICE_GAIN: Readonly<Record<Note['voice'], number>> = {
  lead: 0.28,
  arp: 0.07,
  bass: 0.4,
  pad: 0.06,
  hat: 0.05,
  kick: 0.5,
};

const freq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** Um tema a tocar (ou a desaparecer depois de um cruzamento). */
interface Track {
  mood: Mood;
  theme: Theme;
  seed: number;
  /** Entrada da faixa: filtro → volume (cruzamento) → saída geral (e eco). */
  input: BiquadFilterNode;
  fade: GainNode;
  send: GainNode;
  tension: GainNode;
  /** Próximo passo a agendar (desde o início da faixa) e a sua hora no relógio do áudio. */
  step: number;
  nextTime: number;
  section: number;
  /** Notas da secção atual, por passo. */
  byStep: Map<number, Note[]>;
  /** A desaparecer: a hora (relógio do áudio) a partir da qual se desliga. */
  endAt: number | null;
}

class Music {
  private out: GainNode | null = null;
  private echoIn: GainNode | null = null;
  private timer: number | null = null;
  private tracks: Track[] = [];
  /** Contexto pedido (pode chegar antes do primeiro gesto: toca quando o áudio arrancar). */
  private wanted: Mood | null = null;
  private tense = false;
  /** Até quando (relógio do áudio) ainda se agenda a camada de tensão (está a desaparecer). */
  private tenseUntil = 0;
  private duck = 1;
  /** Seed desta sessão (as frases mudam de sessão para sessão). */
  private readonly baseSeed = Math.floor(Math.random() * 0x7fffffff);

  /** Contexto atual (para o debug e os testes). */
  get mood(): Mood | null {
    return this.wanted;
  }

  get tension(): boolean {
    return this.tense;
  }

  /** Começa (depois do primeiro gesto, com o contexto de áudio já criado). */
  start(): void {
    const context = sfx.audioContext;
    if (!context || this.timer !== null) return;
    this.out = context.createGain();
    this.out.connect(context.destination);
    // Eco barato: um atraso com realimentação e um passa-baixo (faz de reverb).
    this.echoIn = context.createGain();
    const delay = context.createDelay(1);
    delay.delayTime.value = 0.33;
    const feedback = context.createGain();
    feedback.gain.value = 0.38;
    const damp = context.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1600;
    this.echoIn.connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    damp.connect(this.out);
    this.refresh();
    if (this.wanted) this.tracks.push(this.makeTrack(context, this.wanted, 0.1));
    this.timer = window.setInterval(() => {
      this.schedule();
    }, TICK_MS);
  }

  /** Aplica o volume das preferências (0 = silêncio) e o da pausa. */
  refresh(): void {
    const context = sfx.audioContext;
    if (!this.out || !context) return;
    this.out.gain.setTargetAtTime(
      preferences().musicVolume * MUSIC_MASTER * this.duck,
      context.currentTime,
      0.15,
    );
  }

  /** Pausa aberta: a música baixa (não pára). */
  setDuck(duck: number): void {
    if (duck === this.duck) return;
    this.duck = duck;
    this.refresh();
  }

  /** Muda o contexto; o mesmo contexto não recomeça a música. */
  setMood(mood: Mood | null): void {
    if (mood === this.wanted) return;
    this.wanted = mood;
    const context = sfx.audioContext;
    if (!context || !this.out) return;
    const now = context.currentTime;
    for (const track of this.tracks) {
      if (track.endAt !== null) continue;
      track.fade.gain.cancelScheduledValues(now);
      track.fade.gain.setValueAtTime(track.fade.gain.value, now);
      track.fade.gain.linearRampToValueAtTime(0.0001, now + CROSSFADE_SEC);
      track.endAt = now + CROSSFADE_SEC + 0.1;
    }
    if (mood) this.tracks.push(this.makeTrack(context, mood, 0.05));
  }

  /** Inimigos a perseguir: entra a camada de percussão (no tempo do tema). */
  setTension(on: boolean): void {
    if (on === this.tense) return;
    this.tense = on;
    const context = sfx.audioContext;
    if (!context) return;
    const now = context.currentTime;
    if (!on) this.tenseUntil = now + TENSION_FADE_SEC * 5;
    for (const track of this.tracks) track.tension.gain.setTargetAtTime(on ? 1 : 0, now, TENSION_FADE_SEC);
  }

  private makeTrack(context: AudioContext, mood: Mood, delay: number): Track {
    const theme = THEMES[mood];
    const out = this.out;
    if (!out) throw new Error('Música sem saída.');
    const input = context.createBiquadFilter();
    input.type = 'lowpass';
    input.frequency.value = theme.cutoff;
    const fade = context.createGain();
    const now = context.currentTime;
    fade.gain.setValueAtTime(0.0001, now);
    fade.gain.linearRampToValueAtTime(theme.gain, now + CROSSFADE_SEC);
    input.connect(fade).connect(out);
    const send = context.createGain();
    send.gain.value = theme.echo;
    fade.connect(send);
    if (this.echoIn) send.connect(this.echoIn);
    const tension = context.createGain();
    tension.gain.value = this.tense ? 1 : 0;
    tension.connect(fade);
    const seed = moodSeed(this.baseSeed, mood);
    return {
      mood,
      theme,
      seed,
      input,
      fade,
      send,
      tension,
      step: 0,
      nextTime: now + delay,
      section: -1,
      byStep: new Map(),
      endAt: null,
    };
  }

  private schedule(): void {
    const context = sfx.audioContext;
    if (!context || !this.out || context.state !== 'running') return;
    const now = context.currentTime;
    // Faixas que já desapareceram: desligar (os nós libertam-se).
    this.tracks = this.tracks.filter((track) => {
      if (track.endAt === null || now < track.endAt) return true;
      track.input.disconnect();
      track.fade.disconnect();
      track.send.disconnect();
      track.tension.disconnect();
      return false;
    });
    const silent = preferences().musicVolume <= 0;
    for (const track of this.tracks) {
      const step = stepSec(track.theme);
      // Separador escondido (ou sem volume): não tentar recuperar o tempo perdido.
      if (track.nextTime < now) track.nextTime = now + 0.05;
      if (silent) {
        track.nextTime = now + 0.1;
        continue;
      }
      const until = Math.min(now + LOOKAHEAD_SEC, track.endAt ?? Infinity);
      while (track.nextTime < until) {
        this.playStep(context, track, track.nextTime, step);
        track.step += 1;
        track.nextTime += step;
      }
    }
  }

  private playStep(context: AudioContext, track: Track, time: number, step: number): void {
    const section = Math.floor(track.step / SECTION_STEPS);
    if (section !== track.section) {
      track.section = section;
      track.byStep.clear();
      for (const note of composeSection(track.theme, track.seed, section)) {
        const list = track.byStep.get(note.at);
        if (list) list.push(note);
        else track.byStep.set(note.at, [note]);
      }
    }
    for (const note of track.byStep.get(track.step % SECTION_STEPS) ?? []) {
      this.play(context, track, note, time, step);
    }
    // Camada de tensão: só se agenda enquanto se ouve.
    if (this.tense || time < this.tenseUntil) {
      const inBar = track.step % STEPS_PER_BAR;
      for (const [at, vel] of TENSION_HITS) {
        if (at === inBar) this.drum(context, track.tension, time, vel);
      }
    }
  }

  private play(context: AudioContext, track: Track, note: Note, time: number, step: number): void {
    const volume = VOICE_GAIN[note.voice] * note.vel;
    const length = note.len * step;
    if (note.voice === 'hat') {
      this.noiseHit(context, track.input, time, 0.04, volume);
      return;
    }
    if (note.voice === 'kick') {
      this.drum(context, track.input, time, note.vel * 0.7);
      return;
    }
    const wave: OscillatorType =
      note.voice === 'lead'
        ? track.theme.leadWave
        : note.voice === 'arp'
          ? track.theme.arpWave
          : note.voice === 'pad'
            ? 'sine'
            : 'triangle';
    // O pad entra e sai devagar; o resto tem ataque curto.
    const attack = note.voice === 'pad' ? Math.min(0.4, length / 3) : 0.015;
    this.tone(context, track.input, wave, freq(note.midi), time, length, volume, attack);
  }

  private tone(
    context: AudioContext,
    out: AudioNode,
    wave: OscillatorType,
    hz: number,
    time: number,
    length: number,
    volume: number,
    attack: number,
  ): void {
    const osc = context.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(hz, time);
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(volume, time + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(length, attack + 0.02));
    osc.connect(env).connect(out);
    osc.start(time);
    osc.stop(time + length + 0.05);
  }

  /** Tambor grave: seno a cair de tom (bombo) com um pouco de ruído. */
  private drum(context: AudioContext, out: AudioNode, time: number, vel: number): void {
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.18);
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(0.55 * vel, time + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
    osc.connect(env).connect(out);
    osc.start(time);
    osc.stop(time + 0.3);
    this.noiseHit(context, out, time, 0.05, 0.06 * vel, 900);
  }

  /** Ruído curto (chocalho, ou o "ataque" do tambor com `lowpass`). */
  private noiseHit(
    context: AudioContext,
    out: AudioNode,
    time: number,
    sec: number,
    volume: number,
    lowpass?: number,
  ): void {
    const source = context.createBufferSource();
    source.buffer = sfx.whiteNoise(context);
    const filter = context.createBiquadFilter();
    filter.type = lowpass === undefined ? 'highpass' : 'lowpass';
    filter.frequency.value = lowpass ?? 6000;
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(volume, time + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, time + sec);
    source.connect(filter).connect(env).connect(out);
    // Começa num ponto ao acaso do ruído (soa menos repetido).
    source.start(time, Math.random() * 0.5);
    source.stop(time + sec + 0.02);
  }
}

export const music = new Music();

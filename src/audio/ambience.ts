// Sons de ambiente sintetizados (Web Audio): vento, pássaros, grilos, água e pingos nas
// cavernas. A mistura (quanto de cada um) vem de soundtrack.ts → `chooseAmbience`; aqui só se
// toca. O vento e a água são dois ruídos em loop (criados uma vez); os pássaros, os grilos e os
// pingos são notas curtas sorteadas a cada `update` (poucas, e os nós libertam-se sozinhos).
// Volume próprio nas definições (`ambientVolume`).

import { preferences } from '../ui/preferences';
import { SILENT_AMBIENCE, type AmbienceMix } from './soundtrack';
import { sfx } from './sfx';

/** Volume geral do ambiente por cima da preferência. */
const AMBIENT_MASTER = 0.3;
/** Mudanças de mistura (constante de tempo, s): entra e sai devagar, como o cruzamento da música. */
const MIX_FADE_SEC = 0.8;
/** Ruído próprio, mais comprido do que o dos efeitos (um loop curto ouvia-se a repetir). */
const NOISE_SEC = 4;

interface Bed {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

class Ambience {
  private out: GainNode | null = null;
  private wind: Bed | null = null;
  private water: Bed | null = null;
  private noise: AudioBuffer | null = null;
  private mix: AmbienceMix = { ...SILENT_AMBIENCE };
  private duck = 1;

  /** Mistura atual (para o debug e os testes). */
  get current(): Readonly<AmbienceMix> {
    return this.mix;
  }

  setDuck(duck: number): void {
    if (duck === this.duck) return;
    this.duck = duck;
    this.refresh();
  }

  refresh(): void {
    const context = sfx.audioContext;
    if (!context || !this.out) return;
    this.out.gain.setTargetAtTime(
      preferences().ambientVolume * AMBIENT_MASTER * this.duck,
      context.currentTime,
      0.15,
    );
  }

  /** Chamado pelo diretor (2×/s): aplica a mistura e sorteia os sons soltos do próximo meio segundo. */
  update(mix: AmbienceMix, dt: number): void {
    this.mix = mix;
    const context = sfx.audioContext;
    if (context?.state !== 'running') return;
    if (preferences().ambientVolume <= 0 && !this.out) return;
    this.ensure(context);
    const now = context.currentTime;
    if (this.wind) {
      // Rajadas: o alvo muda um pouco de cada vez.
      const gust = 0.6 + Math.random() * 0.4;
      this.wind.gain.gain.setTargetAtTime(mix.wind * 0.5 * gust, now, MIX_FADE_SEC * 1.5);
      this.wind.filter.frequency.setTargetAtTime(280 + gust * 260, now, 1.2);
    }
    if (this.water) {
      this.water.gain.gain.setTargetAtTime(mix.water * 0.45, now, MIX_FADE_SEC);
      // Correr da água: o filtro mexe-se depressa e ao acaso.
      this.water.filter.frequency.setTargetAtTime(700 + Math.random() * 700, now, 0.15);
    }
    if (preferences().ambientVolume <= 0) return;
    // Sons soltos no próximo intervalo (agendados com antecedência).
    if (Math.random() < mix.birds * 0.35 * dt * 2) this.birdPhrase(context, now + Math.random() * dt);
    if (mix.crickets > 0) {
      for (let t = 0; t < dt; t += 0.25) {
        if (Math.random() < 0.6 * mix.crickets) this.cricket(context, now + t + Math.random() * 0.2);
      }
    }
    if (Math.random() < mix.drips * 0.3 * dt * 2) this.drip(context, now + Math.random() * dt);
  }

  private ensure(context: AudioContext): void {
    if (this.out) return;
    this.out = context.createGain();
    this.out.gain.value = 0;
    this.out.connect(context.destination);
    this.refresh();
    this.noise = this.makeNoise(context);
    this.wind = this.bed(context, 'lowpass', 400, 0.7);
    this.water = this.bed(context, 'bandpass', 1000, 0.8);
  }

  private makeNoise(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * NOISE_SEC);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    // Ruído "castanho" (passeio aleatório): mais grave e suave do que o branco.
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    // As pontas encontram-se a zero: o loop não dá estalido.
    const edge = Math.min(2000, length >> 2);
    for (let i = 0; i < edge; i++) {
      const k = i / edge;
      data[i] = (data[i] ?? 0) * k;
      data[length - 1 - i] = (data[length - 1 - i] ?? 0) * k;
    }
    return buffer;
  }

  private bed(context: AudioContext, type: BiquadFilterType, hz: number, q: number): Bed {
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = hz;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.value = 0;
    const out = this.out;
    if (out) source.connect(filter).connect(gain).connect(out);
    source.start(context.currentTime, Math.random() * NOISE_SEC);
    return { source, filter, gain };
  }

  /** Uma frase de pássaro: 2–5 piados agudos a subir ou a descer. */
  private birdPhrase(context: AudioContext, time: number): void {
    const count = 2 + Math.floor(Math.random() * 4);
    const base = 2400 + Math.random() * 1600;
    const up = Math.random() < 0.5;
    for (let i = 0; i < count; i++) {
      const at = time + i * (0.09 + Math.random() * 0.05);
      const from = base * (1 + (Math.random() - 0.5) * 0.15);
      this.chirp(context, at, from, up ? from * 1.35 : from * 0.75, 0.06 + Math.random() * 0.03, 0.05);
    }
  }

  /** Grilo: um tom agudo cortado em 3–4 impulsos. */
  private cricket(context: AudioContext, time: number): void {
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 4200 + Math.random() * 500;
    const env = context.createGain();
    env.gain.setValueAtTime(0, time);
    const pulses = 3 + Math.floor(Math.random() * 2);
    const volume = 0.018 + Math.random() * 0.012;
    for (let i = 0; i < pulses; i++) {
      env.gain.setValueAtTime(volume, time + i * 0.03);
      env.gain.setValueAtTime(0, time + i * 0.03 + 0.016);
    }
    const out = this.out;
    if (!out) return;
    osc.connect(env).connect(out);
    osc.start(time);
    osc.stop(time + pulses * 0.03 + 0.02);
  }

  /** Pingo (caverna): tom que cai depressa, com um segundo mais fraco (eco). */
  private drip(context: AudioContext, time: number): void {
    const from = 1200 + Math.random() * 900;
    this.chirp(context, time, from, from * 0.55, 0.08, 0.09);
    this.chirp(context, time + 0.22, from, from * 0.55, 0.08, 0.025);
  }

  private chirp(
    context: AudioContext,
    time: number,
    from: number,
    to: number,
    sec: number,
    volume: number,
  ): void {
    const out = this.out;
    if (!out) return;
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, time);
    osc.frequency.exponentialRampToValueAtTime(to, time + sec);
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(volume, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, time + sec);
    osc.connect(env).connect(out);
    osc.start(time);
    osc.stop(time + sec + 0.02);
  }
}

export const ambience = new Ambience();

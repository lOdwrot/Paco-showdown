/**
 * Minimal chiptune synth on raw WebAudio: square/triangle/saw voices, noise
 * bursts, frequency sweeps and LFO-driven loops. Everything is generated, so
 * there are no audio files to license or load.
 */
export type Wave = OscillatorType;

export interface LoopSpec {
  wave: Wave;
  base: number;
  /** LFO modulates the frequency by ±depth Hz at rate Hz. */
  depth: number;
  rate: number;
  lfoWave?: Wave;
  vol: number;
}

export class Synth {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Separate bus for music so it can be faded/cut without touching effects. */
  private musicBus: GainNode | null = null;
  musicVolume = 0.55;
  private loop: { key: string; osc: OscillatorNode; lfo: OscillatorNode; lfoGain: GainNode; gain: GainNode } | null =
    null;
  muted = false;
  volume = 0.3;

  /** Must be called from a user gesture at least once (autoplay policy). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.newMusicBus();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private newMusicBus(): void {
    if (!this.ctx || !this.master) return;
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);
  }

  /** Silences everything already scheduled on the music bus (fast fade). */
  cutMusic(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.04);
    setTimeout(() => bus.disconnect(), 300);
    this.newMusicBus();
  }

  private out(bus?: 'sfx' | 'music'): AudioNode | null {
    return bus === 'music' ? this.musicBus : this.master;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** One note, optionally sliding to another frequency. `at` is relative to now. */
  tone(
    freq: number,
    dur: number,
    opts: { wave?: Wave; vol?: number; at?: number; slideTo?: number; bus?: 'sfx' | 'music' } = {},
  ): void {
    const ctx = this.ctx;
    const dest = this.out(opts.bus);
    if (!ctx || !dest) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.wave ?? 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur);
    const v = opts.vol ?? 0.25;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.005);
    g.gain.setValueAtTime(v, t0 + Math.max(0.006, dur - 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(
    dur: number,
    opts: { vol?: number; at?: number; cutoff?: number; sweepTo?: number; bus?: 'sfx' | 'music' } = {},
  ): void {
    const ctx = this.ctx;
    const dest = this.out(opts.bus);
    if (!ctx || !dest) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(opts.cutoff ?? 2000, t0);
    if (opts.sweepTo) filt.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.vol ?? 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(dest);
    src.start(t0);
  }

  /** Starts/updates a looping modulated tone. Same key = just retune. */
  setLoop(key: string | null, spec?: LoopSpec): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (this.loop && (key === null || this.loop.key !== key)) {
      const l = this.loop;
      l.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);
      l.osc.stop(ctx.currentTime + 0.2);
      l.lfo.stop(ctx.currentTime + 0.2);
      this.loop = null;
    }
    if (!key || !spec) return;
    if (!this.loop) {
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gain = ctx.createGain();
      osc.type = spec.wave;
      lfo.type = spec.lfoWave ?? 'triangle';
      lfo.connect(lfoGain).connect(osc.frequency);
      gain.gain.value = 0.0001;
      gain.gain.setTargetAtTime(spec.vol, ctx.currentTime, 0.05);
      osc.connect(gain).connect(this.master);
      osc.start();
      lfo.start();
      this.loop = { key, osc, lfo, lfoGain, gain };
    }
    const l = this.loop;
    l.osc.frequency.setTargetAtTime(spec.base, ctx.currentTime, 0.1);
    l.lfo.frequency.setTargetAtTime(spec.rate, ctx.currentTime, 0.1);
    l.lfoGain.gain.setTargetAtTime(spec.depth, ctx.currentTime, 0.1);
  }
}

/** MIDI note number → Hz. */
export const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "C5", "F#4", "Bb3" → MIDI. */
export function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]!]! + acc;
}

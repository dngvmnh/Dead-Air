/**
 * Procedural audio engine (design.md §11, requirements 12.1, 12.3).
 *
 * All of the television's own sounds — static, tuning, boot and power-off — are
 * synthesised with the Web Audio API; no audio files are needed for them. The
 * graph is:
 *
 *   noise ─┐
 *   tuning ┼─► sfx bus ─┐
 *          │            ├─► master gain ─► limiter ─► destination
 *   (file/voice later) ─┘
 *
 * The AudioContext is created and resumed on the POWER gesture (browsers block
 * audio before a user gesture). Volume is a single 0..1 applied to the master
 * gain; mute forces it to zero. A limiter on the master bus keeps peaks in
 * check so stingers never exceed a safe level (safety-and-rights.md).
 *
 * This is the audio layer, not core, so it may use Web Audio. The AudioContext
 * is injectable so the graph wiring and gain/mute math can be unit-tested with
 * a lightweight fake, without a real browser audio device.
 */

import type { SfxCue } from '../content/schema.ts';

/** A factory for an AudioContext, injectable for tests. */
export type AudioContextFactory = () => AudioContext;

export interface AudioEngineOptions {
  /** Supply a context (or a fake in tests). Defaults to a real AudioContext. */
  createContext?: AudioContextFactory;
}

/** Master limiter settings: a fast compressor acting as a brickwall-ish limiter. */
const LIMITER = {
  threshold: -6, // dB; programme sits below, stingers are caught
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.12,
};

export type ProgrammeBed = 'news' | 'kids' | 'shop' | 'deadair';

interface BedPattern {
  stepMs: number;
  wave: OscillatorType;
  notes: ReadonlyArray<number | 0>;
  noteLevel: number;
  pad?: readonly number[];
  padEvery: number;
  padLevel: number;
  tick?: number;
}

/** Original, simple patterns. Quiet enough to sit under a voice. */
const BEDS: Record<ProgrammeBed, BedPattern> = {
  news: { stepMs: 260, wave: 'sine', notes: [147, 0, 0, 0, 175, 0, 0, 0], noteLevel: 0.05, pad: [73, 110], padEvery: 16, padLevel: 0.035, tick: 0.022 },
  kids: { stepMs: 340, wave: 'triangle', notes: [523, 659, 784, 659, 587, 698, 880, 698], noteLevel: 0.065, padEvery: 8, padLevel: 0 },
  shop: { stepMs: 420, wave: 'sine', notes: [392, 494, 587, 740, 659, 523, 440, 494], noteLevel: 0.06, pad: [98, 147], padEvery: 16, padLevel: 0.03 },
  deadair: { stepMs: 1400, wave: 'sine', notes: [55, 0, 0, 52], noteLevel: 0.06, pad: [50], padEvery: 4, padLevel: 0.04 },
};

/** No single cue voice goes above this, whatever gain it is given. */
export const PEAK_CAP = 0.6;

/** Analog voice/file band: roughly 200 Hz–8 kHz (design §11). */
export const ANALOG_BAND = { lowHz: 200, highHz: 8000 };

function defaultFactory(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API is unavailable');
  return new Ctor();
}

export class AudioEngine {
  private readonly factory: AudioContextFactory;
  private ctx: AudioContext | null = null;

  // Persistent graph nodes (created on first unlock).
  private masterGain: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private staticGain: GainNode | null = null;
  private staticSource: AudioBufferSourceNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private bedTimer: ReturnType<typeof setInterval> | null = null;
  private readonly routed = new WeakSet<HTMLMediaElement>();
  /** Cue voices still sounding, so a channel change can cut them. */
  private cues: Array<{ node: AudioScheduledSourceNode; until: number }> = [];

  // Volume state (applied to the master gain).
  private volume01 = 0.7;
  private muted = false;

  constructor(options: AudioEngineOptions = {}) {
    this.factory = options.createContext ?? defaultFactory;
  }

  /** The context, or null before the first unlock. Exposed for diagnostics/tests. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  get isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /**
   * Create and resume the AudioContext on the POWER gesture, building the
   * persistent graph the first time. Safe to call repeatedly: later calls just
   * resume a suspended context. Returns the context's state.
   */
  async unlock(): Promise<AudioContextState> {
    if (!this.ctx) {
      this.ctx = this.factory();
      this.buildGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx.state;
  }

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;

    const sfx = ctx.createGain();
    const staticGain = ctx.createGain();
    staticGain.gain.value = 0; // silent until setStatic raises it

    // master ─► limiter ─► destination
    master.connect(limiter);
    limiter.connect(ctx.destination);
    // sfx ─► master ; static ─► sfx
    sfx.connect(master);
    staticGain.connect(sfx);

    this.masterGain = master;
    this.sfxBus = sfx;
    this.staticGain = staticGain;
    this.noiseBuffer = this.makeNoiseBuffer(ctx);

    this.applyMasterGain();
    this.startStaticSource(ctx);
  }

  /** One second of looping white noise, reused for static and hiss. */
  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** A continuously running noise source feeding the (initially silent) static gain. */
  private startStaticSource(ctx: AudioContext): void {
    if (!this.noiseBuffer || !this.staticGain) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.connect(this.staticGain);
    src.start();
    this.staticSource = src;
  }

  // --- Volume / mute (requirement 12.3) ------------------------------------

  /** Set master volume 0..1. */
  setVolume(volume01: number): void {
    this.volume01 = clamp01(volume01);
    this.applyMasterGain();
  }

  /** Mute or unmute the master bus. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  /** The effective linear master gain given volume and mute. */
  get effectiveGain(): number {
    return this.muted ? 0 : this.volume01;
  }

  private applyMasterGain(): void {
    if (!this.masterGain || !this.ctx) return;
    const target = this.effectiveGain;
    // A short ramp avoids clicks on volume/mute changes.
    const g = this.masterGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(target, now, 0.02);
  }

  // --- Static (tuning snow / dead-air hiss) --------------------------------

  /**
   * Set the static level, 0..1. Mirrors the renderer's `uStatic` so the snow
   * you see is the snow you hear. Ramped to avoid clicks.
   */
  setStatic(amount: number): void {
    if (!this.staticGain || !this.ctx) return;
    const target = clamp01(amount) * 0.5; // headroom below master
    const g = this.staticGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(target, now, 0.03);
  }

  // --- One-shot procedural cues --------------------------------------------

  /** A short tuning click/chirp, used when a channel is acquired (req 2.3). */
  playTuningClick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  /** The CRT warm-up thunk: a low rising tone with a soft degauss knock. */
  playBoot(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.4);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.65);
  }

  /**
   * A procedural paper-rip: a short filtered noise burst through the SFX bus,
   * its loudness and brightness scaled by drag `speed01` (0..1). Routed through
   * the master limiter like every cue, so it stays within the safe level
   * (dead-air-room §9, requirement 1.7). A no-op before unlock.
   */
  playRip(speed01: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return;
    const s = clamp01(speed01);
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    // A band-pass that opens brighter with faster drags.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200 + s * 2600;
    bp.Q.value = 0.7;
    const gain = ctx.createGain();
    const peak = 0.08 + s * 0.22;
    const dur = 0.05 + s * 0.08;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.sfxBus);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  /** A short low thump when a piece fully detaches (design §9). */
  playDetachThump(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  /**
   * A horror cue through the SFX bus, so the master limiter still caps it. All
   * procedural: nothing here is a recording, and none of it is modelled on a real
   * alert tone. `gain` scales the cue, and each voice stays under PEAK_CAP.
   */
  playCue(cue: SfxCue, gain = 1): void {
    if (!this.ctx || !this.sfxBus) return;
    const g = clamp01(gain);
    this.pruneCues();
    switch (cue) {
      case 'stinger': {
        // A tight, detuned cluster that hits at once and hangs.
        for (const f of [207, 220, 233, 311, 466]) this.cueTone('sawtooth', f, f * 0.97, 0.1 * g, 0, 0.012, 1.1);
        this.cueNoise('highpass', 900, 0.7, 0.26 * g, 0, 0.008, 0.45);
        break;
      }
      case 'jumpHit': {
        // The lunge: a body blow under a shriek that climbs. Through the limiter,
        // which is what holds it at a level that startles rather than hurts.
        this.cueTone('sine', 86, 30, 0.6 * g, 0, 0.004, 0.5);
        for (const [from, to] of [[196, 760], [233, 905], [311, 1210], [415, 1620]] as const) {
          this.cueTone('sawtooth', from, to, 0.17 * g, 0, 0.006, 0.8);
        }
        this.cueNoise('highpass', 1500, 0.6, 0.4 * g, 0, 0.004, 0.55);
        break;
      }
      case 'tapeStop': {
        this.cueTone('sawtooth', 440, 28, 0.2 * g, 0, 0.01, 0.75);
        this.cueTone('sine', 220, 22, 0.2 * g, 0, 0.01, 0.75);
        break;
      }
      case 'heartbeat': {
        for (const beat of [0, 0.82, 1.64]) {
          this.cueTone('sine', 62, 34, 0.42 * g, beat, 0.012, 0.2);
          this.cueTone('sine', 54, 30, 0.32 * g, beat + 0.26, 0.012, 0.2);
        }
        break;
      }
      case 'knock': {
        for (const hit of [0, 0.24, 0.47]) {
          this.cueTone('sine', 150, 62, 0.46 * g, hit, 0.003, 0.14);
          this.cueNoise('bandpass', 620, 1.1, 0.3 * g, hit, 0.002, 0.07);
        }
        break;
      }
      case 'breath': {
        this.cueNoise('bandpass', 1050, 0.8, 0.1 * g, 0, 0.75, 1.1);
        this.cueNoise('bandpass', 720, 0.9, 0.07 * g, 1.12, 0.5, 1.5);
        break;
      }
      case 'whisper': {
        // Consonant-like bursts with no words in them: the listener supplies those.
        let t = 0;
        for (const [f, d] of [[3400, 0.11], [5200, 0.07], [2600, 0.14], [4700, 0.09], [3100, 0.17], [5600, 0.06], [2900, 0.2]] as const) {
          this.cueNoise('bandpass', f, 5, 0.13 * g, t, 0.02, d);
          t += d + 0.05;
        }
        break;
      }
      case 'toyPiano': {
        // A jingle going flat and slowing down, as if the spring were running out.
        let t = 0;
        let step = 0.2;
        for (const f of [659, 784, 659, 523, 587, 494, 440, 392]) {
          const flat = 1 - t * 0.022;
          this.cueTone('triangle', f * flat, f * flat * 0.995, 0.17 * g, t, 0.004, step * 1.5);
          this.cueTone('sine', f * flat * 3.02, f * flat * 3, 0.05 * g, t, 0.002, 0.09);
          t += step;
          step *= 1.17;
        }
        break;
      }
      case 'phoneRing': {
        for (const start of [0, 0.62]) {
          this.cueTone('square', 880, 880, 0.045 * g, start, 0.008, 0.46);
          this.cueTone('square', 930, 930, 0.045 * g, start, 0.008, 0.46);
        }
        break;
      }
      case 'scrape': {
        this.cueNoise('bandpass', 340, 1.4, 0.26 * g, 0, 0.2, 0.75, 1250);
        this.cueNoise('bandpass', 1250, 1.4, 0.2 * g, 0.72, 0.1, 0.8, 300);
        break;
      }
      case 'drone': {
        this.cueTone('sine', 49, 47, 0.2 * g, 0, 0.7, 3.4);
        this.cueTone('sine', 52, 50, 0.16 * g, 0, 0.7, 3.4);
        this.cueTone('sawtooth', 98, 94, 0.035 * g, 0, 1, 3.2);
        break;
      }
    }
  }

  /**
   * The sound under a programme, so a channel is never dead air until it means to
   * be. `unease` (0..1) slowly detunes the bed as the story goes on.
   */
  setBed(bed: ProgrammeBed | null, unease = 0): void {
    if (this.bedTimer !== null) {
      clearInterval(this.bedTimer);
      this.bedTimer = null;
    }
    if (!bed || !this.ctx || !this.sfxBus) return;
    const pattern = BEDS[bed];
    const flat = 1 - Math.min(1, Math.max(0, unease)) * 0.05;
    let step = 0;
    const tick = (): void => {
      this.pruneCues();
      const stepSeconds = pattern.stepMs / 1000;
      if (pattern.pad && step % pattern.padEvery === 0) {
        const hold = (pattern.padEvery * pattern.stepMs) / 1000 + 0.6;
        for (const f of pattern.pad) this.cueTone('sine', f * flat, f * flat, pattern.padLevel, 0, 0.5, hold);
      }
      const note = pattern.notes[step % pattern.notes.length];
      if (note) this.cueTone(pattern.wave, note * flat, note * flat * 0.995, pattern.noteLevel, 0, 0.006, stepSeconds * 1.5);
      if (pattern.tick && step % 2 === 0) this.cueNoise('highpass', 3800, 0.7, pattern.tick, 0, 0.002, 0.03);
      step += 1;
    };
    tick();
    this.bedTimer = setInterval(tick, pattern.stepMs);
  }

  /**
   * Send a film's sound through the analog band, so it matches the picture.
   * Once only, because a media element can be captured a single time.
   */
  routeElement(element: HTMLMediaElement): boolean {
    if (!this.ctx || this.routed.has(element)) return this.routed.has(element);
    const input = this.createAnalogChain();
    if (!input) return false;
    try {
      this.ctx.createMediaElementSource(element).connect(input);
      this.routed.add(element);
      return true;
    } catch {
      return false;
    }
  }

  /** Cut every sounding cue: the channel changed or the set went off. */
  stopCues(): void {
    for (const { node } of this.cues) {
      try {
        node.stop();
      } catch {
        // Already finished.
      }
    }
    this.cues = [];
  }

  private pruneCues(): void {
    const now = this.ctx?.currentTime ?? 0;
    this.cues = this.cues.filter((c) => c.until > now);
  }

  /** One enveloped oscillator voice, `start` seconds from now. */
  private cueTone(
    type: OscillatorType,
    fromHz: number,
    toHz: number,
    peak: number,
    start: number,
    attack: number,
    dur: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || peak <= 0) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), t + dur);
    this.envelope(gain, peak, t, attack, dur);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    this.cues.push({ node: osc, until: t + dur + 0.02 });
  }

  /** One enveloped band of noise, optionally sweeping to `toHz`. */
  private cueNoise(
    type: BiquadFilterType,
    hz: number,
    q: number,
    peak: number,
    start: number,
    attack: number,
    dur: number,
    toHz?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuffer || peak <= 0) return;
    const t = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(hz, t);
    if (toHz !== undefined) filter.frequency.exponentialRampToValueAtTime(toHz, t + dur);
    filter.Q.value = q;
    const gain = ctx.createGain();
    this.envelope(gain, peak, t, attack, dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.02);
    this.cues.push({ node: src, until: t + dur + 0.02 });
  }

  private envelope(gain: GainNode, peak: number, t: number, attack: number, dur: number): void {
    const capped = Math.min(peak, PEAK_CAP);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(capped, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /** The power-off collapse: a descending tone that snaps to silence. */
  playPowerOff(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.32);
    // Snow collapses with the picture.
    this.setStatic(0);
  }

  /**
   * Build the analog filter chain for an owned file/voice source: a band-pass
   * (roughly 200 Hz–8 kHz) with a little saturation, feeding the master bus
   * (design §11). Returns the input node callers connect their source to. The
   * chain itself is created here so Milestone-4 file playback can reuse it.
   */
  createAnalogChain(): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return null;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = ANALOG_BAND.lowHz;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = ANALOG_BAND.highHz;
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve();
    hp.connect(lp);
    lp.connect(shaper);
    shaper.connect(this.masterGain);
    return hp;
  }

  /** Suspend audio (e.g. on power-off) without tearing the graph down. */
  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  /** Release the context entirely. */
  async close(): Promise<void> {
    if (this.staticSource) {
      try {
        this.staticSource.stop();
      } catch {
        // Already stopped.
      }
      this.staticSource = null;
    }
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
    this.masterGain = null;
    this.sfxBus = null;
    this.staticGain = null;
    this.noiseBuffer = null;
  }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** A gentle odd saturation curve for the analog chain. */
function saturationCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
  const k = 2;
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

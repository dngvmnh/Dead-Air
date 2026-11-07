/**
 * Procedural audio engine (design.md §11, requirements 12.1, 12.3).
 *
 * All of the television's own sounds — static, tuning, boot and power-off — are
 * synthesised with the Web Audio API; no audio files are needed for them. The
 * graph is:
 *
 *   noise, cues ─► sfx bus (well under the programme) ─┐
 *   film, beds ──► programme bus ──────────────────────┴► master ─► limiter ─► out
 *   jump hit ─► drive ─┬───────────► scare level ─► scare limiter ─► out
 *                      └► reverb ──┘
 *
 * The AudioContext is created and resumed on the POWER gesture (browsers block
 * audio before a user gesture). Volume is a single 0..1 applied to the master
 * gain; mute forces it to zero. The programme is the loudest thing on the set
 * until a jump, which has its own path so it can be louder still: everything else
 * cuts out under it, and its own limiter holds the peaks.
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

/** The television's own noises and cues, relative to the programme at 1. */
export const SFX_LEVEL = 0.4;
/** How long the programme takes to come back after a jump cuts it. */
const DUCK_HOLD_S = 1.1;
const DUCK_RELEASE_S = 0.7;
/** How long a jump's room rings on for. */
const REVERB_S = 3.5;

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

/** Original, simple patterns. They are the programme here, so they sit above the effects. */
const BEDS: Record<ProgrammeBed, BedPattern> = {
  news: { stepMs: 260, wave: 'sine', notes: [147, 0, 0, 0, 175, 0, 0, 0], noteLevel: 0.24, pad: [73, 110], padEvery: 16, padLevel: 0.17, tick: 0.08 },
  kids: { stepMs: 340, wave: 'triangle', notes: [523, 659, 784, 659, 587, 698, 880, 698], noteLevel: 0.3, padEvery: 8, padLevel: 0 },
  shop: { stepMs: 420, wave: 'sine', notes: [392, 494, 587, 740, 659, 523, 440, 494], noteLevel: 0.28, pad: [98, 147], padEvery: 16, padLevel: 0.15 },
  deadair: { stepMs: 1400, wave: 'sine', notes: [55, 0, 0, 52], noteLevel: 0.28, pad: [50], padEvery: 4, padLevel: 0.18 },
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
  private programmeBus: GainNode | null = null;
  private scareBus: GainNode | null = null;
  private scareLevel: GainNode | null = null;
  private staticGain: GainNode | null = null;
  private staticSource: AudioBufferSourceNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private bedTimer: ReturnType<typeof setInterval> | null = null;
  private readonly routed = new WeakSet<HTMLMediaElement>();
  /** Cue voices still sounding, so a channel change can cut them. */
  private cues: Array<{ node: AudioScheduledSourceNode; until: number }> = [];

  // Volume state (applied to the master gain).
  private volume01 = 1;
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
    sfx.gain.value = SFX_LEVEL;
    sfx.connect(master);
    staticGain.connect(sfx);

    const programme = ctx.createGain();
    programme.connect(master);

    this.masterGain = master;
    this.sfxBus = sfx;
    this.programmeBus = programme;
    this.staticGain = staticGain;
    this.noiseBuffer = this.makeNoiseBuffer(ctx);
    this.buildScarePath(ctx);

    this.applyMasterGain();
    this.startStaticSource(ctx);
  }

  /**
   * A jump's own path. Drive pushes it far louder for the same peak, and a long
   * dark room lets it ring on after the picture has gone.
   */
  private buildScarePath(ctx: AudioContext): void {
    const bus = ctx.createGain();
    const drive = ctx.createWaveShaper();
    drive.curve = saturationCurve(10);
    const reverb = ctx.createConvolver();
    reverb.buffer = makeRoomImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    const level = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.2;

    bus.connect(drive);
    drive.connect(level);
    drive.connect(reverb);
    reverb.connect(wet);
    wet.connect(level);
    level.connect(limiter);
    limiter.connect(ctx.destination);

    this.scareBus = bus;
    this.scareLevel = level;
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
    // A jump still answers to mute and the volume knob, but it stays loud at the
    // quieter settings where a viewer has let their guard down.
    const scare = this.scareLevel?.gain;
    scare?.cancelScheduledValues(now);
    scare?.setTargetAtTime(Math.sqrt(target), now, 0.02);
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
      case 'jumpHit':
        this.playJumpHit(g);
        break;
      case 'jumpHands':
        this.playJumpHands(g);
        break;
      case 'jumpEye':
        this.playJumpEye(g);
        break;
      case 'jumpMaw':
        this.playJumpMaw(g);
        break;
      case 'jumpDoll':
        this.playJumpDoll(g);
        break;
      case 'jumpCrowd':
        this.playJumpCrowd(g);
        break;
      case 'jumpSnow':
        this.playJumpSnow(g);
        break;
      case 'jumpPumpkin':
        this.playJumpPumpkin(g);
        break;
      case 'jumpSpider':
        this.playJumpSpider(g);
        break;
      case 'jumpSkull':
        this.playJumpSkull(g);
        break;
      case 'jumpClaws':
        this.playJumpClaws(g);
        break;
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
        this.cueNoise('bandpass', 1050, 0.8, 0.42 * g, 0, 0.75, 1.1);
        this.cueNoise('bandpass', 720, 0.9, 0.3 * g, 1.12, 0.5, 1.5);
        break;
      }
      case 'whisper': {
        // Consonant-like bursts with no words in them: the listener supplies those.
        let t = 0;
        for (const [f, d] of [[3400, 0.11], [5200, 0.07], [2600, 0.14], [4700, 0.09], [3100, 0.17], [5600, 0.06], [2900, 0.2]] as const) {
          this.cueNoise('bandpass', f, 5, 0.6 * g, t, 0.02, d);
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
        this.cueNoise('bandpass', 340, 1.4, 0.6 * g, 0, 0.2, 0.75, 1250);
        this.cueNoise('bandpass', 1250, 1.4, 0.5 * g, 0.72, 0.1, 0.8, 300);
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
   * The jump: the whole set drops out, a body blow lands with a crack on top, and
   * several throats scream over a cluster that has no chord in it. Then, once the
   * picture has gone, something low moans on in the dark room.
   */
  private playJumpHit(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g, out);
    // Semitone clashes, sagging together: nothing to resolve to.
    this.cluster(g, out);
    // Vowels, not sirens: voices rise, crack and fall at slightly different times.
    this.scream(520, 1180, 760, 0, 1.1, 0.45 * g, out);
    this.scream(690, 1490, 900, 0.02, 1.25, 0.38 * g, out);
    this.scream(410, 930, 470, 0.05, 1.5, 0.4 * g, out);
    this.moan(g, out);
  }

  /** Cut everything else and hand back the scare path. */
  private beginJump(): GainNode | null {
    if (!this.scareBus) return null;
    this.duckEverythingElse();
    return this.scareBus;
  }

  /** The body blow with a crack on top, which every jump opens with. */
  private blow(g: number, out: AudioNode): void {
    this.cueTone('sine', 120, 26, 0.6 * g, 0, 0.002, 0.7, out);
    this.cueNoise('highpass', 1100, 0.6, 0.6 * g, 0, 0.001, 0.3, undefined, out);
    this.cueNoise('lowpass', 500, 0.7, 0.5 * g, 0, 0.002, 0.5, undefined, out);
  }

  private cluster(g: number, out: AudioNode): void {
    for (const f of [185, 196, 277, 294, 415, 440, 622, 659]) {
      this.cueTone('sawtooth', f, f * 0.94, 0.15 * g, 0, 0.003, 1.3, out);
    }
  }

  /** After the cut to black, in the room that is left. */
  private moan(g: number, out: AudioNode): void {
    this.scream(165, 196, 92, 0.95, 3, 0.16 * g, out);
    this.scream(174, 208, 98, 1.15, 2.8, 0.12 * g, out);
    this.cueNoise('bandpass', 720, 0.9, 0.09 * g, 1.3, 0.5, 2.2, 240, out);
  }

  /** Palms hitting the glass, faster than anyone has hands for. */
  private playJumpHands(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g * 0.7, out);
    for (const t of [0, 0.1, 0.17, 0.3, 0.36, 0.5, 0.56, 0.61, 0.74]) {
      this.cueTone('sine', 150, 48, 0.6 * g, t, 0.001, 0.16, out);
      this.cueNoise('bandpass', 900, 0.8, 0.6 * g, t, 0.001, 0.09, undefined, out);
    }
    this.scream(330, 640, 300, 0.05, 1.1, 0.26 * g, out);
    this.moan(g, out);
  }

  /** A ringing that grows until it is inside your head, and one thin voice. */
  private playJumpEye(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g, out);
    for (const f of [3120, 3187, 4410]) this.cueTone('sine', f, f * 1.02, 0.28 * g, 0, 0.02, 1.4, out);
    for (const t of [0, 0.42]) this.cueTone('sine', 58, 42, 0.6 * g, t, 0.01, 0.34, out);
    this.scream(900, 1760, 1280, 0.02, 1.2, 0.34 * g, out);
    this.moan(g, out);
  }

  /** Something very large breathing out, then the teeth meeting. */
  private playJumpMaw(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g, out);
    for (const f of [52, 55, 61, 73, 110]) this.cueTone('sawtooth', f, f * 1.45, 0.34 * g, 0, 0.01, 0.9, out);
    this.cueNoise('bandpass', 260, 0.9, 0.6 * g, 0, 0.01, 0.95, 1200, out);
    this.scream(120, 300, 90, 0, 1.2, 0.5 * g, out);
    // The bite.
    this.cueNoise('highpass', 1800, 0.7, 0.6 * g, 0.62, 0.001, 0.08, undefined, out);
    this.cueTone('sine', 180, 40, 0.6 * g, 0.62, 0.001, 0.22, out);
    this.moan(g, out);
  }

  /** A music box that has gone wrong, and a very small voice laughing. */
  private playJumpDoll(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g * 0.8, out);
    let t = 0;
    for (const f of [1568, 1661, 1319, 1397, 988, 1047, 784]) {
      this.cueTone('triangle', f, f * 0.97, 0.3 * g, t, 0.002, 0.3, out);
      this.cueTone('sine', f * 3.03, f * 3, 0.1 * g, t, 0.001, 0.1, out);
      t += 0.075;
    }
    for (const at of [0.06, 0.2, 0.33, 0.46, 0.62, 0.8]) this.scream(980, 1320, 1040, at, 0.14, 0.42 * g, out);
    this.scream(1180, 1860, 1400, 0.72, 0.7, 0.3 * g, out);
    this.moan(g * 0.8, out);
  }

  /** Everyone at once, none of them in time. */
  private playJumpCrowd(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g * 0.8, out);
    for (let i = 0; i < 9; i += 1) {
      const base = 240 + i * 83;
      this.scream(base, base * (1.7 + (i % 3) * 0.2), base * 0.8, i * 0.018, 1 + (i % 4) * 0.13, 0.17 * g, out);
    }
    this.moan(g, out);
  }

  /** Static turned all the way up, and something shouting from inside it. */
  private playJumpSnow(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g * 0.7, out);
    this.cueNoise('highpass', 400, 0.5, 0.6 * g, 0, 0.001, 0.86, undefined, out);
    this.cueNoise('bandpass', 2400, 1.4, 0.6 * g, 0, 0.001, 0.86, 700, out);
    this.scream(240, 520, 180, 0, 0.9, 0.5 * g, out);
    this.scream(190, 410, 140, 0.03, 0.9, 0.5 * g, out);
    this.moan(g, out);
  }

  /** A deep laugh from inside something hollow, over a fire. */
  private playJumpPumpkin(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g, out);
    for (const [at, from] of [[0.02, 150], [0.24, 138], [0.46, 124], [0.7, 108], [0.96, 92]] as const) {
      this.scream(from, from * 1.2, from * 0.85, at, 0.2, 0.6 * g, out);
      this.scream(from * 1.5, from * 1.8, from * 1.3, at, 0.2, 0.3 * g, out);
    }
    for (let i = 0; i < 16; i += 1) {
      this.cueNoise('bandpass', 1800 + (i * 910) % 2600, 2, 0.34 * g, (i * 0.097) % 1.3, 0.001, 0.025, undefined, out);
    }
    this.moan(g * 0.7, out);
  }

  /** Dry legs on glass, very quick, and a hiss. */
  private playJumpSpider(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g * 0.8, out);
    let t = 0;
    for (let i = 0; i < 26; i += 1) {
      this.cueNoise('bandpass', 2600 + (i % 5) * 620, 4, 0.6 * g, t, 0.001, 0.02, undefined, out);
      t += 0.026 + ((i * 37) % 11) * 0.003;
    }
    this.cueNoise('highpass', 3000, 0.7, 0.42 * g, 0.02, 0.02, 1, undefined, out);
    this.scream(560, 1040, 620, 0.04, 0.9, 0.3 * g, out);
    this.moan(g * 0.8, out);
  }

  /** Bones knocking together, and a voice that falls a long way. */
  private playJumpSkull(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g, out);
    let t = 0.02;
    for (let i = 0; i < 12; i += 1) {
      this.cueNoise('bandpass', 1500 + (i % 3) * 700, 6, 0.6 * g, t, 0.001, 0.035, undefined, out);
      this.cueTone('triangle', 540 + (i % 4) * 90, 300, 0.2 * g, t, 0.001, 0.04, out);
      t += 0.05 + ((i * 53) % 7) * 0.008;
    }
    this.scream(860, 1100, 110, 0, 1.6, 0.5 * g, out);
    this.scream(640, 830, 90, 0.04, 1.7, 0.4 * g, out);
    this.moan(g * 0.8, out);
  }

  /** The wall ripping in four strokes, and metal being dragged through it. */
  private playJumpClaws(g: number): void {
    const out = this.beginJump();
    if (!out) return;
    this.blow(g * 0.8, out);
    for (const t of [0, 0.13, 0.28, 0.43]) this.cueNoise('bandpass', 700, 0.9, 0.6 * g, t, 0.002, 0.2, 5200, out);
    for (const f of [2310, 2445, 3140]) this.cueTone('sawtooth', f, f * 1.2, 0.12 * g, 0.02, 0.01, 0.95, out);
    this.scream(610, 1240, 720, 0.03, 1, 0.34 * g, out);
    this.moan(g, out);
  }

  /** One throat: a saw with a shaking pitch, through vowel formants. */
  private scream(fromHz: number, peakHz: number, toHz: number, start: number, dur: number, peak: number, out: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx || peak <= 0) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.exponentialRampToValueAtTime(peakHz, t + dur * 0.22);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), t + dur);

    const shake = ctx.createOscillator();
    shake.frequency.value = 6.7;
    const depth = ctx.createGain();
    depth.gain.value = peakHz * 0.045;
    shake.connect(depth);
    depth.connect(osc.frequency);

    const gain = ctx.createGain();
    this.envelope(gain, peak, t, 0.012, dur);
    for (const [hz, q, level] of [[800, 6, 1], [1250, 7, 0.75], [2800, 8, 0.4]] as const) {
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = hz;
      formant.Q.value = q;
      const amount = ctx.createGain();
      amount.gain.value = level * 2.6;
      osc.connect(formant);
      formant.connect(amount);
      amount.connect(gain);
    }
    gain.connect(out);
    osc.start(t);
    shake.start(t);
    osc.stop(t + dur + 0.02);
    shake.stop(t + dur + 0.02);
    this.cues.push({ node: osc, until: t + dur + 0.02 }, { node: shake, until: t + dur + 0.02 });
  }

  /** Cut the programme and the set's noises dead, then let them creep back. */
  private duckEverythingElse(): void {
    const now = this.ctx?.currentTime ?? 0;
    const buses: ReadonlyArray<readonly [GainNode | null, number]> = [
      [this.programmeBus, 1],
      [this.sfxBus, SFX_LEVEL],
    ];
    for (const [bus, level] of buses) {
      if (!bus) continue;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(0.0001, now);
      bus.gain.setTargetAtTime(level, now + DUCK_HOLD_S, DUCK_RELEASE_S / 3);
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
    const out = this.programmeBus;
    if (!bed || !this.ctx || !out) return;
    const pattern = BEDS[bed];
    const flat = 1 - Math.min(1, Math.max(0, unease)) * 0.05;
    let step = 0;
    const tick = (): void => {
      this.pruneCues();
      const stepSeconds = pattern.stepMs / 1000;
      if (pattern.pad && step % pattern.padEvery === 0) {
        const hold = (pattern.padEvery * pattern.stepMs) / 1000 + 0.6;
        for (const f of pattern.pad) this.cueTone('sine', f * flat, f * flat, pattern.padLevel, 0, 0.5, hold, out);
      }
      const note = pattern.notes[step % pattern.notes.length];
      if (note) this.cueTone(pattern.wave, note * flat, note * flat * 0.995, pattern.noteLevel, 0, 0.006, stepSeconds * 1.5, out);
      if (pattern.tick && step % 2 === 0) this.cueNoise('highpass', 3800, 0.7, pattern.tick, 0, 0.002, 0.03, undefined, out);
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
    out: AudioNode | null = this.sfxBus,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !out || peak <= 0) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), t + dur);
    this.envelope(gain, peak, t, attack, dur);
    osc.connect(gain);
    gain.connect(out);
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
    out: AudioNode | null = this.sfxBus,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !out || !this.noiseBuffer || peak <= 0) return;
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
    gain.connect(out);
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
   * (roughly 200 Hz–8 kHz) with a little saturation, feeding the programme bus
   * (design §11). Returns the input node callers connect their source to. The
   * chain itself is created here so Milestone-4 file playback can reuse it.
   */
  createAnalogChain(): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.programmeBus) return null;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = ANALOG_BAND.lowHz;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = ANALOG_BAND.highHz;
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(1);
    hp.connect(lp);
    lp.connect(shaper);
    shaper.connect(this.programmeBus);
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
    this.programmeBus = null;
    this.scareBus = null;
    this.scareLevel = null;
    this.staticGain = null;
    this.noiseBuffer = null;
  }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** A large dark room: decaying noise with its highs dying first. */
function makeRoomImpulse(ctx: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * REVERB_S));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (const channel of [0, 1]) {
    const data = buffer.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i += 1) {
      const age = i / length;
      const raw = (Math.random() * 2 - 1) * (1 - age) ** 2.6;
      // A one-pole low-pass that closes as the tail ages.
      low += (raw - low) * (0.5 - 0.44 * age);
      data[i] = low;
    }
  }
  return buffer;
}

/** An odd saturation curve: `k` sets how hard, with small-signal gain 1 + k. */
function saturationCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

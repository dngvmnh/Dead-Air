import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, SFX_LEVEL } from './AudioEngine.ts';

/**
 * A tiny fake Web Audio graph. Each node records what it connects to, so tests
 * can assert the topology and the gain/mute math without a real audio device
 * (jsdom has no Web Audio). Only the surface AudioEngine uses is implemented.
 */

interface FakeParam {
  value: number;
  setTargetAtTime: (v: number, t: number, c: number) => void;
  cancelScheduledValues: (t: number) => void;
  setValueAtTime: (v: number, t: number) => void;
  exponentialRampToValueAtTime: (v: number, t: number) => void;
}

function makeParam(initial = 0): FakeParam {
  const p: FakeParam = {
    value: initial,
    setTargetAtTime: (v) => {
      p.value = v;
    },
    cancelScheduledValues: () => {},
    setValueAtTime: (v) => {
      p.value = v;
    },
    exponentialRampToValueAtTime: (v) => {
      p.value = v;
    },
  };
  return p;
}

class FakeNode {
  readonly connectedTo: FakeNode[] = [];
  gain = makeParam(1);
  frequency = makeParam(440);
  Q = makeParam(1);
  threshold = makeParam(0);
  knee = makeParam(0);
  ratio = makeParam(1);
  attack = makeParam(0);
  release = makeParam(0);
  type = '';
  buffer: unknown = null;
  loop = false;
  curve: Float32Array | null = null;
  started = false;
  stopped = false;
  readonly kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }
  connect(target: FakeNode) {
    this.connectedTo.push(target);
    return target;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode('destination');
  readonly created: FakeNode[] = [];

  private track<T extends FakeNode>(n: T): T {
    this.created.push(n);
    return n;
  }
  createGain() {
    return this.track(new FakeNode('gain'));
  }
  createDynamicsCompressor() {
    return this.track(new FakeNode('compressor'));
  }
  createOscillator() {
    return this.track(new FakeNode('oscillator'));
  }
  createBufferSource() {
    return this.track(new FakeNode('bufferSource'));
  }
  createBiquadFilter() {
    return this.track(new FakeNode('biquad'));
  }
  createWaveShaper() {
    return this.track(new FakeNode('waveshaper'));
  }
  createConvolver() {
    return this.track(new FakeNode('convolver'));
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data, length } as unknown as AudioBuffer;
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
}

function newEngine() {
  const ctx = new FakeAudioContext();
  const engine = new AudioEngine({
    createContext: () => ctx as unknown as AudioContext,
  });
  return { engine, ctx };
}

beforeEach(() => {
  // Deterministic noise buffer fill.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AudioEngine unlock (requirement 12.1)', () => {
  it('creates and resumes the context on the POWER gesture', async () => {
    const { engine, ctx } = newEngine();
    expect(engine.context).toBeNull();
    expect(engine.isUnlocked).toBe(false);
    const state = await engine.unlock();
    expect(state).toBe('running');
    expect(engine.context).not.toBeNull();
    expect(engine.isUnlocked).toBe(true);
    expect(ctx.state).toBe('running');
  });

  it('is idempotent: a second unlock just resumes', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    const createdAfterFirst = ctx.created.length;
    await engine.unlock();
    // No second graph is built.
    expect(ctx.created.length).toBe(createdAfterFirst);
  });

  it('wires master -> limiter -> destination and sfx/static into the bus', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    const compressor = ctx.created.find((n) => n.kind === 'compressor')!;
    const destination = ctx.destination;
    // The limiter feeds the destination.
    expect(compressor.connectedTo).toContain(destination);
    // Some gain node (master) feeds the limiter.
    const master = ctx.created.find((n) => n.kind === 'gain' && n.connectedTo.includes(compressor));
    expect(master, 'a master gain connects to the limiter').toBeDefined();
    // A buffer source (static noise) runs continuously.
    const noise = ctx.created.find((n) => n.kind === 'bufferSource');
    expect(noise?.started).toBe(true);
    expect(noise?.loop).toBe(true);
  });
});

describe('AudioEngine volume and mute (requirement 12.3)', () => {
  it('applies volume to the effective gain', async () => {
    const { engine } = newEngine();
    await engine.unlock();
    engine.setVolume(0.4);
    expect(engine.effectiveGain).toBeCloseTo(0.4, 5);
  });

  it('mute forces the effective gain to zero and unmute restores it', async () => {
    const { engine } = newEngine();
    await engine.unlock();
    engine.setVolume(0.8);
    engine.setMuted(true);
    expect(engine.effectiveGain).toBe(0);
    engine.setMuted(false);
    expect(engine.effectiveGain).toBeCloseTo(0.8, 5);
  });

  it('clamps volume into 0..1', async () => {
    const { engine } = newEngine();
    await engine.unlock();
    engine.setVolume(5);
    expect(engine.effectiveGain).toBe(1);
    engine.setVolume(-1);
    expect(engine.effectiveGain).toBe(0);
  });
});

describe('AudioEngine procedural cues (requirement 12.1)', () => {
  it('plays a tuning click as a short oscillator burst', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    const before = ctx.created.filter((n) => n.kind === 'oscillator').length;
    engine.playTuningClick();
    const oscs = ctx.created.filter((n) => n.kind === 'oscillator');
    expect(oscs.length).toBe(before + 1);
    const osc = oscs.at(-1)!;
    expect(osc.started).toBe(true);
    expect(osc.stopped).toBe(true);
  });

  it('plays boot and power-off tones', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    engine.playBoot();
    engine.playPowerOff();
    const oscs = ctx.created.filter((n) => n.kind === 'oscillator');
    expect(oscs.length).toBeGreaterThanOrEqual(2);
    expect(oscs.every((o) => o.started && o.stopped)).toBe(true);
  });

  it('does nothing (no throw) if cues are played before unlock', () => {
    const { engine } = newEngine();
    expect(() => engine.playTuningClick()).not.toThrow();
    expect(() => engine.playBoot()).not.toThrow();
    expect(() => engine.playPowerOff()).not.toThrow();
  });
});

describe('AudioEngine static and analog chain', () => {
  it('raises the static gain with the requested amount', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    engine.setStatic(1);
    // The static gain is the gain node fed by the buffer source.
    const noise = ctx.created.find((n) => n.kind === 'bufferSource')!;
    const staticGain = noise.connectedTo[0]!;
    expect(staticGain.gain.value).toBeGreaterThan(0);
    engine.setStatic(0);
    expect(staticGain.gain.value).toBe(0);
  });

  it('builds a band-pass + saturation analog chain feeding the master', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    const input = engine.createAnalogChain();
    expect(input).not.toBeNull();
    const biquads = ctx.created.filter((n) => n.kind === 'biquad');
    const shaper = ctx.created.find((n) => n.kind === 'waveshaper');
    expect(biquads.length).toBe(2); // highpass + lowpass
    expect(shaper).toBeDefined();
    expect(shaper!.curve).not.toBeNull();
  });
});

describe('AudioEngine mix', () => {
  const buses = (ctx: FakeAudioContext) => {
    const master = ctx.created.find((n) => n.kind === 'gain' && n.connectedTo.some((t) => t.kind === 'compressor'))!;
    const intoMaster = ctx.created.filter((n) => n.kind === 'gain' && n.connectedTo.includes(master));
    return { sfx: intoMaster[0]!, programme: intoMaster[1]! };
  };

  it('keeps the effects well under the programme', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    const { sfx, programme } = buses(ctx);
    expect(sfx.gain.value).toBe(SFX_LEVEL);
    expect(programme.gain.value).toBe(1);
    expect(SFX_LEVEL).toBeLessThan(0.5);
  });

  it('sends a film through the programme bus, not the effects', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    const { programme } = buses(ctx);
    engine.createAnalogChain();
    const shaper = ctx.created.filter((n) => n.kind === 'waveshaper').at(-1)!;
    expect(shaper.connectedTo).toContain(programme);
  });

  it('a jump skips the programme limiter and cuts everything else', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    const compressors = ctx.created.filter((n) => n.kind === 'compressor');
    expect(compressors).toHaveLength(2);
    expect(compressors[1]!.connectedTo).toContain(ctx.destination);
    expect(compressors[1]!.threshold.value).toBeGreaterThan(compressors[0]!.threshold.value);

    const { sfx, programme } = buses(ctx);
    const seen: number[] = [];
    programme.gain.setValueAtTime = (v) => void seen.push(v);
    sfx.gain.setValueAtTime = (v) => void seen.push(v);
    engine.playCue('jumpHit');
    expect(seen).toEqual([0.0001, 0.0001]);
  });

  it('a jump obeys mute', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    const limiter = ctx.created.filter((n) => n.kind === 'compressor')[1]!;
    const level = ctx.created.find((n) => n.kind === 'gain' && n.connectedTo.includes(limiter))!;
    engine.setVolume(0.25);
    expect(level.gain.value).toBeCloseTo(0.5, 5);
    engine.setMuted(true);
    expect(level.gain.value).toBe(0);
  });
});

describe('AudioEngine lifecycle', () => {
  it('suspend and close move the context accordingly', async () => {
    const { engine, ctx } = newEngine();
    await engine.unlock();
    await engine.suspend();
    expect(ctx.state).toBe('suspended');
    await engine.close();
    expect(engine.context).toBeNull();
    expect(ctx.state).toBe('closed');
  });

  describe('horror cues', () => {
    const CUES = ['stinger', 'jumpHit', 'tapeStop', 'heartbeat', 'knock', 'breath', 'whisper', 'toyPiano', 'phoneRing', 'scrape', 'drone'] as const;

    it('every cue plays, and stopping them is safe', async () => {
      const { engine } = newEngine();
      await engine.unlock();
      for (const cue of CUES) expect(() => engine.playCue(cue, 1)).not.toThrow();
      expect(() => engine.stopCues()).not.toThrow();
      expect(() => engine.stopCues()).not.toThrow();
    });

    it('starts and stops a programme bed', async () => {
      const { engine, ctx } = newEngine();
      await engine.unlock();
      const before = ctx.created.length;
      engine.setBed('news', 0.5);
      expect(ctx.created.length).toBeGreaterThan(before);
      engine.setBed(null);
      const after = ctx.created.length;
      await new Promise((r) => setTimeout(r, 300));
      expect(ctx.created.length).toBe(after);
    });

    it('is a no-op before the audio is unlocked', () => {
      const { engine } = newEngine();
      expect(() => engine.playCue('stinger')).not.toThrow();
    });
  });
});

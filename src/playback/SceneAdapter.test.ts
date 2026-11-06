import { describe, expect, it, beforeEach } from 'vitest';
import { SceneAdapter } from './SceneAdapter.ts';
import type { AdapterEvent, SceneContext } from './PlaybackAdapter.ts';
import type { SceneProgramInput } from '../content/schema.ts';
import type { Item } from '../core/types.ts';
import type { Ctx2D } from '../render/sceneRenderer.ts';

/** A controllable clock + frame pump so the adapter runs deterministically. */
class Harness {
  nowMs = 0;
  private pending: ((nowMs: number) => void) | null = null;
  readonly sources: (unknown | null)[] = [];
  readonly events: AdapterEvent[] = [];

  requestFrame = (cb: (nowMs: number) => void): number => {
    this.pending = cb;
    return 1;
  };
  cancelFrame = (): void => {
    this.pending = null;
  };

  /** Advance the clock and run one scheduled frame, if any. */
  tick(dtMs: number): void {
    this.nowMs += dtMs;
    const cb = this.pending;
    this.pending = null;
    cb?.(this.nowMs);
  }

  hasFrame(): boolean {
    return this.pending !== null;
  }

  makeCtx(scene: SceneProgramInput | undefined): SceneContext {
    return {
      getScene: () => scene,
      getImages: () => undefined,
      getVars: () => ({ visits: 1, act: 0 }),
      setSource: (s) => this.sources.push(s),
      now: () => this.nowMs,
    };
  }
}

const fakeCanvas = () => ({
  ctx: {
    save() {},
    restore() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    drawImage() {},
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textBaseline(_v: string) {},
    set textAlign(_v: string) {},
    set lineWidth(_v: number) {},
  } as unknown as Ctx2D,
  source: { marker: 'canvas' },
});

const sceneItem: Item = {
  id: 'i1',
  title: 'Scene',
  kind: 'programme',
  durationMs: 1000,
  rights: { basis: 'original' },
  source: 'scene',
  sceneId: 'sA',
  look: 'broadcast',
};

const scene: SceneProgramInput = { id: 'sA', durationMs: 400, layers: [] };

function makeAdapter(h: Harness) {
  return new SceneAdapter({
    requestFrame: h.requestFrame,
    cancelFrame: h.cancelFrame,
    createCanvas: () => fakeCanvas(),
  });
}

describe('SceneAdapter', () => {
  let h: Harness;
  beforeEach(() => {
    h = new Harness();
  });

  it('rejects a non-scene item', async () => {
    const a = makeAdapter(h);
    const yt = { ...sceneItem, source: 'youtube', videoId: 'x' } as unknown as Item;
    await expect(a.load(yt, 0, h.makeCtx(scene))).rejects.toThrow();
  });

  it('draws the first frame on load, before play', async () => {
    const a = makeAdapter(h);
    await a.load(sceneItem, 0, h.makeCtx(scene));
    // One source published from the immediate first draw.
    expect(h.sources.length).toBe(1);
    expect(h.sources[0]).toEqual({ marker: 'canvas' });
    expect(h.hasFrame()).toBe(false); // not looping until play
  });

  it('emits playing and advances position one-for-one with the clock', async () => {
    const a = makeAdapter(h);
    const events: AdapterEvent[] = [];
    a.on((e) => events.push(e));
    await a.load(sceneItem, 0, h.makeCtx(scene));
    await a.play();
    expect(events).toContainEqual({ type: 'playing' });
    h.tick(100);
    expect(a.positionMs()).toBe(100);
    h.tick(150);
    expect(a.positionMs()).toBe(250);
  });

  it('starts at the given offset (clock continuity, requirement 3.2)', async () => {
    const a = makeAdapter(h);
    await a.load(sceneItem, 600, h.makeCtx(scene));
    await a.play();
    expect(a.positionMs()).toBe(600);
    h.tick(50);
    expect(a.positionMs()).toBe(650);
  });

  it('emits ended once when the item duration elapses', async () => {
    const a = makeAdapter(h);
    const events: AdapterEvent[] = [];
    a.on((e) => events.push(e));
    await a.load(sceneItem, 0, h.makeCtx(scene));
    await a.play();
    h.tick(500);
    h.tick(600); // now past durationMs=1000
    const ended = events.filter((e) => e.type === 'ended');
    expect(ended.length).toBe(1);
    expect(h.hasFrame()).toBe(false); // loop stopped
  });

  it('pause then play resumes from the same position', async () => {
    const a = makeAdapter(h);
    await a.load(sceneItem, 0, h.makeCtx(scene));
    await a.play();
    h.tick(300);
    a.pause();
    expect(a.positionMs()).toBe(300);
    h.nowMs += 10_000; // wall clock moves while paused
    await a.play();
    expect(a.positionMs()).toBe(300); // resumes, not jumped
  });

  it('reports a non-fatal error and clears the source when the scene is missing', async () => {
    const a = makeAdapter(h);
    const events: AdapterEvent[] = [];
    a.on((e) => events.push(e));
    await a.load(sceneItem, 0, h.makeCtx(undefined));
    expect(events).toContainEqual({ type: 'error', fatal: false });
    expect(h.sources[h.sources.length - 1]).toBeNull();
  });

  it('stop clears the published source', async () => {
    const a = makeAdapter(h);
    await a.load(sceneItem, 0, h.makeCtx(scene));
    await a.play();
    a.stop();
    expect(h.sources[h.sources.length - 1]).toBeNull();
  });
});

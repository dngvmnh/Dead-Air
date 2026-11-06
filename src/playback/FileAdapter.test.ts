import { describe, expect, it, vi } from 'vitest';
import { FileAdapter } from './FileAdapter.ts';
import type { Item } from '../core/types.ts';
import type { SceneContext } from './PlaybackAdapter.ts';

class FakeVideo {
  readyState = 0;
  duration = 100;
  currentTime = 0;
  src = '';
  muted = false;
  volume = 1;
  loads = 0;
  playImpl: () => Promise<void> = () => Promise.resolve();
  private readonly handlers: Record<string, Array<() => void>> = {};
  addEventListener(name: string, fn: () => void) {
    (this.handlers[name] ??= []).push(fn);
  }
  removeEventListener(name: string, fn: () => void) {
    this.handlers[name] = (this.handlers[name] ?? []).filter((h) => h !== fn);
  }
  fire(name: string) {
    for (const h of [...(this.handlers[name] ?? [])]) h();
  }
  load() {
    this.loads += 1;
    this.readyState = 1;
    this.fire('loadedmetadata');
  }
  play() {
    return this.playImpl();
  }
  pause() {}
}

const item = { id: 'f', source: 'file', url: '/film/a.mp4', look: 'broadcast', durationMs: 90000 } as unknown as Item;

function setup() {
  const video = new FakeVideo();
  const adapter = new FileAdapter({ createVideo: () => video as unknown as HTMLVideoElement });
  const setSource = vi.fn();
  const ctx = { setSource, setLook: vi.fn() } as unknown as SceneContext;
  return { video, adapter, ctx, setSource };
}

describe('FileAdapter', () => {
  it('seeks to the clock position and publishes the video', async () => {
    const { video, adapter, ctx, setSource } = setup();
    await adapter.load(item, 42500, ctx);
    expect(video.currentTime).toBeCloseTo(42.5);
    expect(setSource).toHaveBeenCalledWith(video);
  });

  it('wraps a clock position past the end of the clip', async () => {
    const { video, adapter, ctx } = setup();
    await adapter.load(item, 130000, ctx);
    expect(video.currentTime).toBeCloseTo(30);
  });

  it('does not reload a clip it already has', async () => {
    const { video, adapter, ctx } = setup();
    await adapter.load(item, 0, ctx);
    await adapter.load(item, 5000, ctx);
    expect(video.loads).toBe(1);
    expect(video.currentTime).toBeCloseTo(5);
  });

  it('reports a failed clip as fatal, so the channel can skip it', async () => {
    const { video, adapter, ctx } = setup();
    const events: string[] = [];
    adapter.on((e) => events.push(e.type));
    await adapter.load(item, 0, ctx);
    video.fire('error');
    expect(events).toContain('error');
  });

  it('falls back to muted when autoplay is refused', async () => {
    const { video, adapter, ctx } = setup();
    let calls = 0;
    video.playImpl = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('blocked')) : Promise.resolve();
    };
    const events: string[] = [];
    adapter.on((e) => events.push(e.type));
    await adapter.load(item, 0, ctx);
    await adapter.play();
    expect(video.muted).toBe(true);
    expect(events).toContain('blocked');
  });

  it('clears the picture on stop', async () => {
    const { adapter, ctx, setSource } = setup();
    await adapter.load(item, 0, ctx);
    adapter.stop();
    expect(setSource).toHaveBeenLastCalledWith(null);
  });
});

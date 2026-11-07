import { describe, expect, it, vi } from 'vitest';
import { createReflection } from './reflection.ts';

function fakeStream(): { stream: MediaStream; stops: ReturnType<typeof vi.fn> } {
  const stops = vi.fn();
  const stream = { getTracks: () => [{ stop: stops }] } as unknown as MediaStream;
  return { stream, stops };
}

function named(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe('createReflection', () => {
  it('asks for video only, and hands back a video that is not in the page', async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const c = createReflection({ getUserMedia });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(await c.enable()).toBe('on');
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { width: 320, height: 240, facingMode: 'user' },
      audio: false,
    });
    expect(c.video()).not.toBeNull();
    expect(c.video()?.isConnected).toBe(false);
  });

  it('stops every track on disable', async () => {
    const { stream, stops } = fakeStream();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const c = createReflection({ getUserMedia: () => Promise.resolve(stream) });
    await c.enable();
    c.disable();
    expect(stops).toHaveBeenCalledTimes(1);
    expect(c.video()).toBeNull();
  });

  it('tells denied from unavailable', async () => {
    const denied = createReflection({ getUserMedia: () => Promise.reject(named('NotAllowedError')) });
    expect(await denied.enable()).toBe('denied');
    const none = createReflection({ getUserMedia: () => Promise.reject(named('NotFoundError')) });
    expect(await none.enable()).toBe('unavailable');
    expect(await createReflection(undefined).enable()).toBe('unavailable');
  });

  it('stops the stream if the viewer switched off while the prompt was up', async () => {
    const { stream, stops } = fakeStream();
    let answer: (s: MediaStream) => void = () => undefined;
    const c = createReflection({ getUserMedia: () => new Promise((r) => (answer = r)) });
    const pending = c.enable();
    c.disable();
    answer(stream);
    await pending;
    expect(stops).toHaveBeenCalledTimes(1);
    expect(c.video()).toBeNull();
  });
});

/**
 * The privacy rule, held by reading the source (requirement 7.5, task 12.4): a
 * camera frame has one way out of `reflection.ts`, and that is a GL texture.
 */
describe('nothing reads a camera frame back', () => {
  const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const code = Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path));
  const READ_BACK = /readPixels|getImageData|drawImage|toDataURL|toBlob|captureStream|MediaRecorder|createImageBitmap|requestVideoFrameCallback|VideoFrame\b|ImageCapture/;

  it('only reflection.ts asks for a camera', () => {
    const askers = code.filter(([, text]) => /getUserMedia\s*\(|mediaDevices/.test(text)).map(([p]) => p);
    expect(askers).toEqual(['/src/render/reflection.ts']);
  });

  it('only useReflection imports it', () => {
    const importers = code.filter(([, text]) => /from '[^']*\/reflection\.ts'/.test(text)).map(([p]) => p);
    expect(importers).toEqual(['/src/app/useReflection.ts']);
  });

  it('neither file can read a frame back', () => {
    for (const path of ['/src/render/reflection.ts', '/src/app/useReflection.ts']) {
      expect(sources[path]).toBeDefined();
      expect(READ_BACK.test(sources[path]!)).toBe(false);
    }
  });

  it('the app has no readPixels at all', () => {
    expect(code.filter(([, text]) => /\.readPixels\(/.test(text)).map(([p]) => p)).toEqual([]);
  });

  it('the CRT only ever uses the camera video as a texture', () => {
    const lines = sources['/src/render/CrtRenderer.ts']!.split('\n').filter((l) => /reflectionVideo/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(READ_BACK.test(line)).toBe(false);
      // Stored, tested, or uploaded: nothing else.
      expect(/this\.reflectionVideo = |this\.reflectionVideo\b.*(readyState|videoWidth|null)|texImage2D|private reflectionVideo|hasVideo|const video = this\.reflectionVideo/.test(line)).toBe(true);
    }
  });

  it('the video never becomes a source, so room lighting cannot sample it', () => {
    expect(/setSource\([^)]*[vV]ideo/.test(sources['/src/app/useReflection.ts']!)).toBe(false);
    expect(/reflection/i.test(sources['/src/playback/FileAdapter.ts'] ?? '')).toBe(false);
  });
});

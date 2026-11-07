/**
 * Turns jump art into canvases. Shading a picture per pixel takes long enough to
 * stall the set, so it happens on a worker before it is needed. If a jump still
 * beats the worker to one, it is baked on the spot: a late picture beats none.
 */

import type { JumpKind } from '../content/schema.ts';
import { facePixels, type FaceKind } from './faceField.ts';
import { ART_KINDS, artPixels, type ArtKind, type Pose } from './jumpArt.ts';

const SIZE = 400;

const baked = new Map<string, HTMLCanvasElement>();

function isArt(kind: JumpKind): kind is ArtKind {
  return (ART_KINDS as readonly string[]).includes(kind);
}

/** RGBA for one pose of a jump. Pure. */
export function jumpPixels(kind: JumpKind, pose: Pose): Uint8ClampedArray<ArrayBuffer> {
  return isArt(kind) ? artPixels(kind, pose, SIZE) : facePixels(kind as FaceKind, pose === 1, SIZE);
}

function store(key: string, pixels: Uint8ClampedArray<ArrayBuffer>): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(pixels, SIZE, SIZE), 0, 0);
  baked.set(key, canvas);
  return canvas;
}

/** The picture for one pose of a jump. Null where there is no canvas. */
export function jumpImage(kind: JumpKind, pose: Pose): HTMLCanvasElement | null {
  const key = `${kind}:${pose}`;
  return baked.get(key) ?? (typeof document === 'undefined' ? null : store(key, jumpPixels(kind, pose)));
}

/** Bake everything a jump can show, off the main thread. Safe to call once at start. */
export function preloadJumps(): () => void {
  if (typeof Worker === 'undefined') return () => undefined;
  const kinds: JumpKind[] = ['anchor', 'gourd', 'operator', 'deadair', ...ART_KINDS];
  const queue = kinds.flatMap((kind) => [[kind, 0], [kind, 1]] as Array<[JumpKind, Pose]>);
  const workers: Worker[] = [];
  const stopWhenDone = (): void => {
    if (queue.length === 0 && workers.every((w) => (w as Worker & { idle?: boolean }).idle)) stop();
  };
  const stop = (): void => {
    for (const w of workers) w.terminate();
  };
  const send = (w: Worker & { idle?: boolean }): void => {
    const next = queue.shift();
    if (!next) {
      w.idle = true;
      stopWhenDone();
      return;
    }
    w.postMessage(next);
  };
  const count = Math.min(3, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1));
  for (let i = 0; i < count; i += 1) {
    const w: Worker = new Worker(new URL('./jumpBake.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ kind: JumpKind; pose: Pose; pixels: Uint8ClampedArray<ArrayBuffer> }>) => {
      const { kind, pose, pixels } = e.data;
      const key = `${kind}:${pose}`;
      if (!baked.has(key)) store(key, pixels);
      send(w);
    };
    workers.push(w);
    send(w);
  }
  return stop;
}

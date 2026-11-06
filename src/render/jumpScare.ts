/**
 * The jump itself: a figure comes out of the picture and fills the whole window
 * for under a second, then it is gone (requirement 11). It is the one thing that
 * draws in front of the set, so it exists only while it runs, and it takes no
 * clicks. The caller must not start one over a YouTube item, which may never have
 * anything in front of it.
 *
 * One lunge, not a strobe: brightness rises once and cuts to black once, and
 * startles are many seconds apart, well inside the flash limit. It stays grey and
 * never full-field white or saturated red.
 */

import type { ApparitionKind } from './apparition.ts';
import { faceImage } from './faceField.ts';

/** How long the figure takes to cross the room. Fast enough to beat a flinch. */
const LUNGE_MS = 170;
/** The black it leaves behind, so the eye has nothing to hold on to. */
export const JUMP_CUT_MS = 180;

/**
 * Where the figure is at `tMs`: 0 at its origin, 1 filling the window. It holds
 * at 1 and keeps creeping, so it never seems to have finished arriving.
 */
export function lungeProgress(tMs: number): number {
  if (tMs <= 0) return 0;
  if (tMs >= LUNGE_MS) return 1 + (tMs - LUNGE_MS) * 0.00022;
  const u = tMs / LUNGE_MS;
  return u * u * u;
}

export interface JumpOptions {
  kind: ApparitionKind;
  ms: number;
  /** Where it comes from, as viewport fractions. */
  originX: number;
  originY: number;
}

/** Quantised like film, so the arrival is a few hard frames and not a smooth zoom. */
const FILM_FRAME_MS = 1000 / 24;
/** It has landed, you have seen it, and then it comes closer again. */
const LURCH_AT_MS = 340;
const LURCH_SCALE = 1.2;

/** Run one jump. Resolves when the overlay has gone, even with rAF throttled. */
export function playJump({ kind, ms, originX, originY }: JumpOptions): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.testid = 'jump-scare';
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '1000', pointerEvents: 'none' });
  const W = (canvas.width = Math.min(window.innerWidth, 1280));
  const H = (canvas.height = Math.round((W * window.innerHeight) / Math.max(1, window.innerWidth)));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve();
  document.body.append(canvas);

  const face = faceImage(kind);
  // Chin and forehead run off the window: too close to be seen whole.
  const full = Math.max(W, H * 1.55);
  const start = performance.now();
  let raf = 0;
  const frame = (): void => {
    const real = performance.now() - start;
    if (real >= ms) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const t = Math.floor(real / FILM_FRAME_MS) * FILM_FRAME_MS;
    const p = lungeProgress(t);
    const size = full * (0.1 + 0.9 * p) * (t >= LURCH_AT_MS ? LURCH_SCALE : 1);
    const shake = Math.max(0.15, 1 - t / 600) * 18;
    const towards = Math.min(1, p);
    const cx = W * (originX + (0.5 - originX) * towards) + Math.sin(t * 0.09) * shake;
    const cy = H * (originY + (0.5 - originY) * towards) + Math.cos(t * 0.13) * shake;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    if (face) ctx.drawImage(face, cx - size / 2, cy - size / 2, size, size);
    tearBands(ctx, canvas, W, H, t);
    grain(ctx, W, H, t);
    raf = requestAnimationFrame(frame);
  };
  frame();

  return new Promise((resolve) => {
    // Real timers, because a hidden tab stops rAF and the overlay must still go.
    setTimeout(() => {
      cancelAnimationFrame(raf);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);
      setTimeout(() => {
        canvas.remove();
        resolve();
      }, JUMP_CUT_MS);
    }, ms);
  });
}

/** A few bands of the picture slip sideways, as bad tape does. Position, not light. */
function tearBands(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, W: number, H: number, t: number): void {
  let seed = (Math.floor(t) * 40503 + 17) >>> 0;
  for (let i = 0; i < 5; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const y = seed % H;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const height = 6 + (seed % Math.max(1, Math.floor(H / 14)));
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const dx = (seed % 81) - 40;
    ctx.drawImage(source, 0, y, W, height, dx, y, W, height);
  }
}

/** Coarse film grain, so it reads as footage rather than a drawing. */
function grain(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  let seed = (Math.floor(t / 40) * 2654435761) >>> 0;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  for (let i = 0; i < 1400; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed % W;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    ctx.fillRect(x, seed % H, 4, 3);
  }
}

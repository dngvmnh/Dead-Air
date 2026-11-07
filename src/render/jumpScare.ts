/**
 * The jump itself: no warning and no approach. On one frame there is a programme,
 * and on the next a face is already filling the whole window. Seeing it coming
 * would spend the only thing a jump has, so nothing appears on the tube first.
 * It is the one thing that draws in front of the set, so it exists only while it
 * runs, and it takes no clicks. The caller must not start one over a YouTube item,
 * which may never have anything in front of it.
 *
 * Not a strobe: brightness rises once and cuts to black once, the shots between
 * are all of the same dim face, and startles are many seconds apart, well inside
 * the flash limit. It stays grey and never full-field white or saturated red.
 */

import type { ApparitionKind } from './apparition.ts';
import { faceImage } from './faceField.ts';

/** The black it leaves behind, so the eye has nothing to hold on to. */
export const JUMP_CUT_MS = 450;

/** One shot of the jump: how close the face is, and where it is framed. */
export interface JumpShot {
  /** Multiple of the size that already fills the window. */
  scale: number;
  /** Shifts the framing up the face, as a fraction of its size. */
  lift: number;
  screaming: boolean;
}

/** Hard cuts, nothing between them. Each is closer, none lets the eye settle. */
const SHOTS: ReadonlyArray<JumpShot & { atMs: number }> = [
  { atMs: 0, scale: 1.08, lift: 0, screaming: false },
  { atMs: 250, scale: 1.3, lift: -0.06, screaming: true },
  { atMs: 520, scale: 1.95, lift: 0.1, screaming: true },
];

/** The shot on screen at `tMs`. It is at full size from the first frame. */
export function jumpShotAt(tMs: number): JumpShot {
  let shot = SHOTS[0] as JumpShot;
  for (const candidate of SHOTS) if (tMs >= candidate.atMs) shot = candidate;
  return shot;
}

export interface JumpOptions {
  kind: ApparitionKind;
  ms: number;
}

/** Quantised like film, so the shake is a few hard frames and not smooth. */
const FILM_FRAME_MS = 1000 / 24;

/** Run one jump. Resolves when the overlay has gone, even with rAF throttled. */
export function playJump({ kind, ms }: JumpOptions): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.testid = 'jump-scare';
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '1000', pointerEvents: 'none' });
  const W = (canvas.width = Math.min(window.innerWidth, 1280));
  const H = (canvas.height = Math.round((W * window.innerHeight) / Math.max(1, window.innerWidth)));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve();

  const closed = faceImage(kind);
  const open = faceImage(kind, true);
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
    const shot = jumpShotAt(t);
    const size = full * shot.scale;
    const cx = W / 2 + Math.sin(t * 0.09) * 16;
    const cy = H / 2 + shot.lift * size + Math.cos(t * 0.13) * 16;
    const face = shot.screaming ? open : closed;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    if (face) ctx.drawImage(face, cx - size / 2, cy - size / 2, size, size);
    tearBands(ctx, canvas, W, H, t);
    grain(ctx, W, H, t);
    raf = requestAnimationFrame(frame);
  };
  // Painted before it joins the page: its first visible frame is already the face.
  frame();
  document.body.append(canvas);

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

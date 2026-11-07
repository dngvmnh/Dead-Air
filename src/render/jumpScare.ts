/**
 * The jump itself: no warning and no approach. On one frame there is a programme,
 * and on the next something is already filling the whole window. Seeing it coming
 * would spend the only thing a jump has, so nothing appears on the tube first.
 * It is the one thing that draws in front of the set, so it exists only while it
 * runs, and it takes no clicks. The caller must not start one over a YouTube item,
 * which may never have anything in front of it.
 *
 * Not a strobe: brightness rises once and cuts to black once, the shots between
 * are all of one dim thing, and startles are many seconds apart, well inside
 * the flash limit. It stays grey and never full-field white or saturated red.
 */

import type { JumpKind } from '../content/schema.ts';
import type { Pose } from './jumpArt.ts';
import { jumpImage } from './jumpBake.ts';

/** The black it leaves behind, so the eye has nothing to hold on to. */
export const JUMP_CUT_MS = 450;

/** One shot of the jump: how close it is, where it is framed, and in which pose. */
export interface JumpShot {
  /** Multiple of the size that already fills the window. */
  scale: number;
  /** Shifts the framing, as a fraction of its size. */
  lift: number;
  pose: Pose;
}

type TimedShot = JumpShot & { atMs: number };

/** Hard cuts, nothing between them. Each is closer, none lets the eye settle. */
const FACE_SHOTS: readonly TimedShot[] = [
  { atMs: 0, scale: 1.08, lift: 0, pose: 0 },
  { atMs: 250, scale: 1.3, lift: -0.06, pose: 1 },
  { atMs: 520, scale: 1.95, lift: 0.1, pose: 1 },
];
/** Each kind moves in its own way, or they would all feel like one scare. */
const KIND_SHOTS: Partial<Record<JumpKind, readonly TimedShot[]>> = {
  hands: [{ atMs: 0, scale: 1, lift: 0, pose: 0 }, { atMs: 190, scale: 1, lift: 0, pose: 1 }, { atMs: 500, scale: 1.25, lift: 0.03, pose: 1 }],
  eye: [{ atMs: 0, scale: 1, lift: 0, pose: 0 }, { atMs: 380, scale: 1.1, lift: 0, pose: 1 }, { atMs: 600, scale: 1.7, lift: 0, pose: 1 }],
  maw: [{ atMs: 0, scale: 1, lift: 0, pose: 0 }, { atMs: 330, scale: 1.05, lift: 0, pose: 1 }, { atMs: 610, scale: 1.45, lift: 0, pose: 1 }],
  doll: [{ atMs: 0, scale: 1, lift: 0.02, pose: 0 }, { atMs: 300, scale: 1.1, lift: 0.02, pose: 1 }, { atMs: 560, scale: 1.6, lift: 0.08, pose: 1 }],
  crowd: [{ atMs: 0, scale: 1, lift: 0.08, pose: 0 }, { atMs: 400, scale: 1, lift: 0.04, pose: 1 }],
  snow: [{ atMs: 0, scale: 1, lift: 0, pose: 0 }, { atMs: 350, scale: 1, lift: 0, pose: 1 }, { atMs: 620, scale: 1.4, lift: 0.07, pose: 1 }],
  pumpkin: [{ atMs: 0, scale: 1, lift: 0, pose: 0 }, { atMs: 320, scale: 1.1, lift: -0.02, pose: 1 }, { atMs: 600, scale: 1.45, lift: -0.08, pose: 1 }],
  spider: [{ atMs: 0, scale: 1, lift: 0.02, pose: 0 }, { atMs: 240, scale: 1, lift: 0.02, pose: 1 }, { atMs: 540, scale: 1.5, lift: 0.08, pose: 1 }],
  skull: [{ atMs: 0, scale: 1, lift: 0.04, pose: 0 }, { atMs: 280, scale: 1, lift: 0.02, pose: 1 }, { atMs: 570, scale: 1.45, lift: 0.02, pose: 1 }],
  claws: [{ atMs: 0, scale: 1, lift: 0, pose: 0 }, { atMs: 300, scale: 1, lift: 0, pose: 1 }, { atMs: 590, scale: 1.3, lift: 0.04, pose: 1 }],
};

/** The shot on screen at `tMs`. It is at full size from the first frame. */
export function jumpShotAt(kind: JumpKind, tMs: number): JumpShot {
  const shots = KIND_SHOTS[kind] ?? FACE_SHOTS;
  let shot: JumpShot = shots[0]!;
  for (const candidate of shots) if (tMs >= candidate.atMs) shot = candidate;
  return shot;
}

export interface JumpOptions {
  kind: JumpKind;
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

  const poses: Record<Pose, HTMLCanvasElement | null> = { 0: jumpImage(kind, 0), 1: jumpImage(kind, 1) };
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
    const shot = jumpShotAt(kind, t);
    const size = full * shot.scale;
    const cx = W / 2 + Math.sin(t * 0.09) * 16;
    const cy = H / 2 + shot.lift * size + Math.cos(t * 0.13) * 16;
    const face = poses[shot.pose];
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

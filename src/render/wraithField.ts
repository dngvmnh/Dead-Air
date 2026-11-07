/**
 * What stands in the dark behind the wall in Act 3. Far too tall and far too thin,
 * head hanging forward, arms down past where knees would be, and coming apart below
 * the waist. Seen through a rip, a slice of it is enough. Shaded per pixel, and the
 * bake is additive: black means nothing there.
 */

import { bump, capsule, fbm, smooth, taper, veins } from './fieldMath.ts';

/** Luminance at (x, y), both -1..1 with y down. 0 is off the figure. */
export function wraithLuminance(x: number, y: number): number {
  const ax = Math.abs(x);
  const rag = (fbm(x * 9, y * 5) - 0.5) * 0.05;

  let d = capsule(x, y, 0.02, -0.5, 0, -0.26, 0.04); // a neck with too much in it
  d = Math.min(d, capsule(x, y, -0.3, -0.25, 0.3, -0.25, 0.06)); // shoulders, hunched
  d = Math.min(d, taper(x, y, 0, -0.25, 0, 0.55, 0.2, 0.05)); // a ribcage and then not much
  d = Math.min(d, capsule(ax, y, 0.3, -0.25, 0.42, 0.14, 0.028));
  d = Math.min(d, capsule(ax, y, 0.42, 0.14, 0.45, 0.5, 0.022));
  for (const [tx, ty] of [[0.35, 0.8], [0.41, 0.9], [0.47, 0.94], [0.53, 0.88], [0.58, 0.72]] as const) {
    d = Math.min(d, taper(ax, y, 0.45, 0.5, tx, ty, 0.016, 0.004));
  }

  let l = 0;
  if (d + rag < 0) {
    // Lit from nowhere. Ribs show, and it dissolves on the way down.
    const ribs = 1 - 0.3 * Math.abs(Math.sin(y * 60)) ** 6 * smooth(0.13, 0.03, Math.abs(x)) * smooth(0.2, -0.1, y);
    const fade = smooth(0.92, 0.1, y + (fbm(x * 8, y * 3) - 0.5) * 0.5);
    l = (0.3 + 0.36 * smooth(0, -0.05, d)) * (0.5 + 0.9 * fbm(x * 12, y * 12)) * ribs * fade;
  }

  // The head hangs forward and to one side, and it is mostly mouth.
  const hx = x - 0.05;
  const hy = y + 0.62;
  const head = Math.hypot(hx / 0.145, hy / 0.25);
  if (head < 1) {
    let h = (0.34 + 0.46 * Math.sqrt(1 - head * head)) * (0.6 + 0.8 * fbm(x * 18, y * 18));
    h *= 1 - 0.65 * veins(x + 3, y, 8, 0.02);
    for (const side of [-1, 1] as const) {
      const r = Math.hypot((hx - side * 0.056) / 0.05, (hy + 0.065) / 0.062);
      h *= smooth(0.72, 1.05, r);
      h += 1.15 * bump(hx - side * 0.056, hy + 0.065, 0.0095, 0.0095);
    }
    h *= smooth(0.82, 1.05, Math.hypot(hx / 0.052, (hy - 0.115) / 0.125));
    l = h;
  }
  return Math.min(1, l);
}

const BAKE_SIZE = 512;
let baked: HTMLCanvasElement | null = null;

/** The baked figure, cold and pale, on black. Null where there is no canvas. */
export function wraithImage(): HTMLCanvasElement | null {
  if (baked) return baked;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = BAKE_SIZE;
  canvas.height = BAKE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(BAKE_SIZE, BAKE_SIZE);
  for (let py = 0; py < BAKE_SIZE; py += 1) {
    for (let px = 0; px < BAKE_SIZE; px += 1) {
      const l = wraithLuminance((px / (BAKE_SIZE - 1)) * 2 - 1, (py / (BAKE_SIZE - 1)) * 2 - 1) * 255;
      const i = (py * BAKE_SIZE + px) * 4;
      image.data[i] = l * 0.86;
      image.data[i + 1] = l * 0.9;
      image.data[i + 2] = l * 0.84;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  baked = canvas;
  return canvas;
}

/**
 * The face behind every startle, shaded per pixel instead of drawn in shapes.
 * Outlines and flat fills read as a cartoon: a jack-o'-lantern or an owl, nothing
 * to be afraid of. Soft light, deep sockets and skin texture read as a badly
 * exposed photograph of something that should not be there.
 *
 * Original and procedural, and no real person. It implies wrongness without gore,
 * and the luminance cap keeps it from ever being a white flash (requirement 11.7).
 */

import type { ApparitionKind } from './apparition.ts';

interface FaceStyle {
  mouth: { y: number; rx: number; ry: number };
  tint: readonly [number, number, number];
  gain: number;
  /** A gourd's ribs run through the skin, so it is a gourd and also not. */
  ribs: boolean;
}

const STYLES: Record<ApparitionKind, FaceStyle> = {
  anchor: { mouth: { y: 0.6, rx: 0.19, ry: 0.36 }, tint: [0.93, 0.95, 0.86], gain: 1, ribs: false },
  gourd: { mouth: { y: 0.52, rx: 0.42, ry: 0.2 }, tint: [1, 0.62, 0.3], gain: 1.05, ribs: true },
  operator: { mouth: { y: 0.46, rx: 0.5, ry: 0.09 }, tint: [0.78, 0.86, 0.92], gain: 0.85, ribs: false },
  deadair: { mouth: { y: 0.56, rx: 0.15, ry: 0.42 }, tint: [0.9, 0.9, 0.9], gain: 0.92, ribs: false },
};

/** Bright enough to read, never close to a white field. */
export const FACE_MAX_LUMINANCE = 0.82;

function smooth(edge0: number, edge1: number, v: number): number {
  const c = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return c * c * (3 - 2 * c);
}

function bump(dx: number, dy: number, rx: number, ry: number): number {
  return Math.exp(-((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)));
}

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * ux;
  const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * ux;
  return top + (bottom - top) * uy;
}

function fbm(x: number, y: number): number {
  return noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.15;
}

/** One eye: a dark socket, then a too-wide pale eye with a pinprick pupil. */
function eye(l: number, dx: number, dy: number, rx: number, ry: number): number {
  const r = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  const socket = Math.exp(-(r ** 1.5));
  const open = 0.62 * bump(dx, dy, rx * 0.42, ry * 0.36);
  const pupil = bump(dx, dy, rx * 0.14, rx * 0.14);
  return (l * (1 - 0.97 * socket) + open) * (1 - 0.96 * pupil);
}

/**
 * Luminance of the face at (x, y), both -1..1 with y down. 0 is off the head. Pure,
 * so the shape can be tested and baked once per kind.
 */
export function faceLuminance(kind: ApparitionKind, x: number, y: number): number {
  const style = STYLES[kind];
  const d = Math.hypot(x / 0.8, (y - 0.02) / 1);
  if (d >= 1) return 0;
  const ax = Math.abs(x);

  // A round head, lit weakly from below: the light that makes anyone look wrong.
  let l = (0.34 + 0.52 * Math.sqrt(1 - d * d)) * (0.82 + 0.3 * y);
  l *= smooth(1, 0.78, d);

  l += 0.26 * bump(ax - 0.34, y + 0.42, 0.26, 0.07); // brow
  l += 0.24 * bump(ax - 0.47, y - 0.08, 0.17, 0.08); // cheekbone
  l += 0.26 * bump(x, y + 0.02, 0.055, 0.22); // nose ridge
  l += 0.16 * bump(x, y - 0.18, 0.09, 0.05); // nose tip
  l *= 1 - 0.62 * bump(ax - 0.42, y - 0.36, 0.17, 0.17); // hollow cheeks
  l *= 1 - 0.9 * bump(ax - 0.065, y - 0.22, 0.036, 0.024); // nostrils

  // The texture is what stops it being a mask.
  l *= 0.66 + 0.68 * fbm(x * 5 + 7, y * 5 + 3);
  l += (fbm(x * 24, y * 24) - 0.5) * 0.09;
  if (style.ribs) l *= 0.55 + 0.45 * Math.abs(Math.cos(x * 7.5)) ** 0.5;

  // The mouth is too long or too wide. It has teeth and nothing behind them.
  const { y: my, rx, ry } = style.mouth;
  const mx = x - 0.012;
  const m = Math.hypot(mx / rx, (y - my) / ry);
  l += 0.16 * bump(m - 1.1, 0, 0.14, 1);
  l *= 1 - smooth(1.04, 0.82, m);
  if (ax < rx * 0.92) {
    const edge = ry * Math.sqrt(Math.max(0, 1 - (mx / rx) ** 2));
    const fromTop = y - (my - edge);
    if (fromTop > 0 && fromTop < 0.07 + ry * 0.08) {
      l += 0.62 * Math.max(0, Math.cos(x * 58 + Math.sin(x * 19) * 2.4)) ** 0.6 * smooth(0.11, 0.02, fromTop);
    }
  }

  // Eyes go last so the texture never dirties them: they are the first thing seen.
  l = eye(l, x + 0.33, y + 0.2, 0.21, 0.15);
  l = eye(l, x - 0.33, y + 0.15, 0.18, 0.18);

  const out = Math.max(0, l * style.gain) ** 1.2;
  return Math.min(FACE_MAX_LUMINANCE, out);
}

const BAKE_SIZE = 340;
const baked = new Map<ApparitionKind, HTMLCanvasElement>();

/** The baked face, transparent off the head. Null where there is no canvas. */
export function faceImage(kind: ApparitionKind): HTMLCanvasElement | null {
  const existing = baked.get(kind);
  if (existing) return existing;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = BAKE_SIZE;
  canvas.height = BAKE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(BAKE_SIZE, BAKE_SIZE);
  const [tr, tg, tb] = STYLES[kind].tint;
  for (let py = 0; py < BAKE_SIZE; py += 1) {
    for (let px = 0; px < BAKE_SIZE; px += 1) {
      const x = (px / (BAKE_SIZE - 1)) * 2 - 1;
      const y = (py / (BAKE_SIZE - 1)) * 2 - 1;
      const l = faceLuminance(kind, x, y) * 255;
      const i = (py * BAKE_SIZE + px) * 4;
      image.data[i] = l * tr;
      image.data[i + 1] = l * tg;
      image.data[i + 2] = l * tb;
      // The edge dissolves into whatever is behind it: an outline would read as a mask.
      image.data[i + 3] = 255 * smooth(1, 0.8, Math.hypot(x / 0.8, (y - 0.02) / 1));
    }
  }
  ctx.putImageData(image, 0, 0);
  baked.set(kind, canvas);
  return canvas;
}

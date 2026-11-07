/**
 * The face behind every startle, shaded per pixel instead of drawn in shapes.
 * Outlines and flat fills read as a cartoon: a jack-o'-lantern or an owl, nothing
 * to be afraid of. Soft light, deep sockets and skin texture read as a badly
 * exposed photograph of something that should not be there.
 *
 * Original and procedural, and no real person. It implies wrongness without gore,
 * and the luminance cap keeps it from ever being a white flash (requirement 11.7).
 */

import { bump, fbm, smooth } from './fieldMath.ts';

export type FaceKind = 'anchor' | 'gourd' | 'operator' | 'deadair';

interface FaceStyle {
  mouth: { y: number; rx: number; ry: number };
  tint: readonly [number, number, number];
  gain: number;
  /** A gourd's ribs run through the skin, so it is a gourd and also not. */
  ribs: boolean;
}

const STYLES: Record<FaceKind, FaceStyle> = {
  anchor: { mouth: { y: 0.6, rx: 0.19, ry: 0.36 }, tint: [0.93, 0.95, 0.86], gain: 1, ribs: false },
  gourd: { mouth: { y: 0.52, rx: 0.42, ry: 0.2 }, tint: [1, 0.62, 0.3], gain: 1.05, ribs: true },
  operator: { mouth: { y: 0.46, rx: 0.5, ry: 0.09 }, tint: [0.78, 0.86, 0.92], gain: 0.85, ribs: false },
  deadair: { mouth: { y: 0.56, rx: 0.15, ry: 0.42 }, tint: [0.9, 0.9, 0.9], gain: 0.92, ribs: false },
};

/** Bright enough to read, never close to a white field. */
export const FACE_MAX_LUMINANCE = 0.82;

/** One eye: a dark socket, then a too-wide pale eye with a pinprick pupil. */
function eye(l: number, dx: number, dy: number, rx: number, ry: number): number {
  const r = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  const socket = Math.exp(-(r ** 1.5));
  const open = 0.95 * bump(dx, dy, rx * 0.42, ry * 0.36);
  const pupil = bump(dx, dy, rx * 0.14, rx * 0.14);
  return (l * (1 - 0.97 * socket) + open) * (1 - 0.96 * pupil);
}

/**
 * Luminance of the face at (x, y), both -1..1 with y down. 0 is off the head. Pure,
 * so the shape can be tested and baked once per kind.
 */
export function faceLuminance(kind: FaceKind, x: number, y: number, screaming = false): number {
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
  // Screaming, the jaw has come down further than a jaw goes.
  const { y: my0, rx, ry: ry0 } = style.mouth;
  const ry = screaming ? Math.max(ry0 * 1.5, 0.34) : ry0;
  const my = screaming ? my0 + (ry - ry0) * 0.55 : my0;
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
  const wide = screaming ? 1.25 : 1;
  l = eye(l, x + 0.33, y + 0.2, 0.21 * wide, 0.15 * wide);
  l = eye(l, x - 0.33, y + 0.15, 0.18 * wide, 0.18 * wide);

  const out = Math.max(0, l * style.gain * 1.12) ** 1.7;
  return Math.min(FACE_MAX_LUMINANCE, out);
}

/** RGBA for a `size` square of this face, transparent off the head. Pure, for a worker. */
export function facePixels(kind: FaceKind, screaming: boolean, size: number): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const [tr, tg, tb] = STYLES[kind].tint;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = (px / (size - 1)) * 2 - 1;
      const y = (py / (size - 1)) * 2 - 1;
      const l = faceLuminance(kind, x, y, screaming) * 255;
      const i = (py * size + px) * 4;
      data[i] = l * tr;
      data[i + 1] = l * tg;
      data[i + 2] = l * tb;
      // The edge dissolves into whatever is behind it: an outline would read as a mask.
      data[i + 3] = 255 * smooth(1, 0.8, Math.hypot(x / 0.8, (y - 0.02) / 1));
    }
  }
  return data;
}

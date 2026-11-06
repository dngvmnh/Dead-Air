/**
 * The wrong pictures a startle puts on the tube for a few seconds (requirement
 * 11). Each one sets a dark room and lets the face in `faceField.ts` come up in
 * it. Nothing here flashes or strobes, and the frame stays dark. With reduced
 * effects the figure holds still.
 *
 * Every frame repaints the whole field, so no text from an earlier frame can
 * stay underneath, and each kind keeps its one line in a band of its own.
 */

import { faceImage } from './faceField.ts';
import type { Ctx2D } from './overlayRenderer.ts';

export type ApparitionKind = 'anchor' | 'gourd' | 'operator' | 'deadair';

const TEXT_Y = 648;
const TEXT_BAND_TOP = 600;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function ease(v: number): number {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
}

/** A small sideways twitch in px. None under reduced effects. */
export function twitchAt(tMs: number, reduced: boolean): number {
  return reduced ? 0 : Math.sin(tMs * 0.031) * Math.sin(tMs * 0.0073) * 7;
}

function drawFace(ctx: Ctx2D, kind: ApparitionKind, cx: number, cy: number, size: number): void {
  const image = faceImage(kind);
  if (image) ctx.drawImage(image, cx - size / 2, cy - size / 2, size, size);
}

/** Static over the whole field: what the face is coming through. */
function drawSnow(ctx: Ctx2D, W: number, H: number, tMs: number, still: boolean): void {
  let seed = (still ? 1 : Math.floor(tMs / 90) * 2654435761) >>> 0;
  ctx.fillStyle = '#7c7e82';
  for (let i = 0; i < 2600; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed % W;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    ctx.fillRect(x, seed % H, 3, 2);
  }
}

export interface ApparitionOptions {
  width: number;
  height: number;
  reduced: boolean;
}

/** Draw one frame `tMs` into an apparition lasting `durationMs`. */
export function drawApparition(
  ctx: Ctx2D,
  kind: ApparitionKind,
  text: string | undefined,
  tMs: number,
  durationMs: number,
  { width: W, height: H, reduced }: ApparitionOptions,
): void {
  ctx.save();
  const u = ease(tMs / Math.max(1, durationMs));
  const cx = W / 2 + twitchAt(tMs, reduced);
  ctx.fillStyle = kind === 'gourd' ? '#030201' : kind === 'deadair' ? '#101114' : '#050508';
  ctx.fillRect(0, 0, W, H);
  if (kind === 'anchor') {
    drawFace(ctx, kind, cx, 275, 500 + u * 170);
  } else if (kind === 'gourd') {
    drawFace(ctx, kind, cx, 285, 560 + u * 150);
  } else if (kind === 'operator') {
    // Rows of booths, and something rising from behind the desk.
    ctx.fillStyle = '#101218';
    for (let x = 60; x < W; x += 170) ctx.fillRect(x, 0, 120, 590);
    drawFace(ctx, kind, cx, 640 - u * 370, 520 + u * 80);
  } else {
    ctx.globalAlpha = 0.2 + u * 0.7;
    drawFace(ctx, kind, cx, H * 0.46, 520 + u * 160);
    ctx.globalAlpha = 1;
    drawSnow(ctx, W, H, tMs, reduced);
  }
  if (text) {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, TEXT_BAND_TOP, W, H - TEXT_BAND_TOP);
    ctx.fillStyle = '#d9d7cb';
    ctx.font = '44px "Courier New", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, TEXT_Y, W - 60);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

/**
 * The wrong pictures a startle puts on the tube for a few seconds (requirement
 * 15). Original and procedural: figures, not people, with no gore. Nothing here
 * flashes or strobes, and the frame stays dark. With reduced effects the figure
 * holds still.
 *
 * Every frame repaints the whole field, so no text from an earlier frame can
 * stay underneath, and each kind keeps its one line in the band it clears.
 */

import type { Ctx2D } from './overlayRenderer.ts';

export type ApparitionKind = 'anchor' | 'gourd' | 'operator' | 'deadair';

interface Frame {
  ctx: Ctx2D;
  W: number;
  H: number;
  /** 0..1 through the apparition. */
  u: number;
  /** A small sideways twitch in px, 0 under reduced effects. */
  twitch: number;
  tMs: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function ease(v: number): number {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
}

function ellipse(ctx: Ctx2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

function polygon(ctx: Ctx2D, points: ReadonlyArray<readonly [number, number]>): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

/**
 * A face with no edge: it falls away into the dark, its sockets have no rims, and
 * its mouth keeps opening. Hard outlines read as a mask; this has to read as
 * something the picture cannot quite resolve.
 */
function drawFace(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number, u: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.05 - ease(u) * 0.06);
  const skin = ctx.createRadialGradient(0, -ry * 0.28, ry * 0.08, 0, 0, ry * 1.02);
  skin.addColorStop(0, '#a19f95');
  skin.addColorStop(0.5, '#68665e');
  skin.addColorStop(0.82, '#1e1d1c');
  skin.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = skin;
  ellipse(ctx, 0, 0, rx, ry);
  const hollow = (x: number, y: number, hx: number, hy: number): void => {
    const g = ctx.createRadialGradient(x, y, Math.min(hx, hy) * 0.3, x, y, Math.max(hx, hy));
    g.addColorStop(0, '#020202');
    g.addColorStop(0.65, '#040404');
    g.addColorStop(1, 'rgba(4, 4, 4, 0)');
    ctx.fillStyle = g;
    ellipse(ctx, x, y, hx, hy);
  };
  const widen = 1 + ease(u * 1.4) * 0.5;
  hollow(-rx * 0.4, -ry * 0.2, rx * 0.3 * widen, ry * 0.2 * widen);
  hollow(rx * 0.37, -ry * 0.16, rx * 0.25 * widen, ry * 0.24 * widen);
  hollow(rx * 0.05, ry * 0.42 + ease(u) * ry * 0.1, rx * 0.17, ry * (0.1 + ease(u) * 0.4));
  ctx.restore();
}

/** The anchor's desk, with the figure far too still and its face all wrong. */
function drawAnchor({ ctx, W, H, u, twitch }: Frame): void {
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2 + twitch;
  const grow = 1 + ease(u) * 0.28;
  ctx.fillStyle = '#0e0e13';
  polygon(ctx, [
    [cx - 320 * grow, H],
    [cx - 240 * grow, 460],
    [cx - 70 * grow, 400],
    [cx + 70 * grow, 400],
    [cx + 240 * grow, 460],
    [cx + 320 * grow, H],
  ]);
  drawFace(ctx, cx, 270, 150 * grow, 205 * grow, u);
}

/** A carved gourd too close to the lens, lit from inside by something dim. */
function drawGourd({ ctx, W, H, u, twitch }: Frame): void {
  ctx.fillStyle = '#030201';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2 + twitch;
  const r = 215 + ease(u) * 45;
  const cy = 292;
  const rind = ctx.createRadialGradient(cx, cy + r * 0.2, r * 0.2, cx, cy, r * 1.2);
  rind.addColorStop(0, '#4a2a0e');
  rind.addColorStop(0.7, '#21120a');
  rind.addColorStop(1, 'rgba(10, 5, 2, 0)');
  ctx.fillStyle = rind;
  ellipse(ctx, cx, cy, r * 1.22, r);
  ctx.strokeStyle = 'rgba(6, 3, 1, 0.75)';
  ctx.lineWidth = 5;
  for (const off of [-0.74, -0.27, 0.27, 0.74]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(off) * r * 1.22, r * 0.98, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // The light is in the holes, and it sinks as the shot goes on.
  const glow = ctx.createRadialGradient(cx, cy + r * 0.3, r * 0.05, cx, cy + r * 0.1, r * 1.05);
  glow.addColorStop(0, '#c98a2c');
  glow.addColorStop(0.55, '#8d4f14');
  glow.addColorStop(1, '#3d1c07');
  ctx.fillStyle = glow;
  const e = r * 0.27;
  const eyeY = cy - r * 0.26;
  polygon(ctx, [[cx - r * 0.62, eyeY + e * 0.9], [cx - r * 0.3, eyeY - e], [cx - r * 0.12, eyeY + e]]);
  polygon(ctx, [[cx + r * 0.6, eyeY + e * 0.7], [cx + r * 0.34, eyeY - e * 0.7], [cx + r * 0.14, eyeY + e * 1.1]]);
  const m = cy + r * 0.3;
  polygon(ctx, [
    [cx - r * 0.74, m - r * 0.14],
    [cx - r * 0.5, m + r * 0.08],
    [cx - r * 0.38, m - r * 0.08],
    [cx - r * 0.22, m + r * 0.16],
    [cx - r * 0.06, m - r * 0.06],
    [cx + r * 0.1, m + r * 0.2],
    [cx + r * 0.26, m - r * 0.05],
    [cx + r * 0.42, m + r * 0.12],
    [cx + r * 0.52, m - r * 0.06],
    [cx + r * 0.74, m - r * 0.16],
    [cx + r * 0.46, m + r * 0.42],
    [cx + r * 0.3, m + r * 0.24],
    [cx + r * 0.12, m + r * 0.5],
    [cx - r * 0.06, m + r * 0.3],
    [cx - r * 0.24, m + r * 0.5],
    [cx - r * 0.4, m + r * 0.3],
  ]);
}

/** The operator's phone off the hook, and the shape that put it down. */
function drawOperator({ ctx, W, H, u, twitch }: Frame): void {
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#101218';
  for (let x = 60; x < W; x += 170) ctx.fillRect(x, 0, 120, 590);
  const cx = W * 0.5 + twitch;
  const rise = ease(u);
  ctx.fillStyle = '#020203';
  ellipse(ctx, cx, 620 - rise * 390, 104 + rise * 34, 134 + rise * 42);
  polygon(ctx, [
    [cx - 360, H],
    [cx - 280, 680 - rise * 230],
    [cx - 70, 620 - rise * 260],
    [cx + 70, 620 - rise * 260],
    [cx + 280, 680 - rise * 230],
    [cx + 360, H],
  ]);
  ctx.fillStyle = '#a5a49a';
  const eyeY = 596 - rise * 390;
  ellipse(ctx, cx - 38, eyeY, 7, 5);
  ellipse(ctx, cx + 38, eyeY, 7, 5);
  ctx.fillStyle = '#060608';
  ctx.fillRect(0, 590, W, 130);
}

/** Nothing on the channel except snow, and a face settling in it. */
function drawDeadAir({ ctx, W, H, u, tMs, twitch }: Frame): void {
  ctx.fillStyle = '#101114';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = ease(u * 1.5) * 0.9;
  drawFace(ctx, W / 2 + twitch * 0.4, H * 0.48, 200, 285, u);
  ctx.globalAlpha = 1;
  // Over the face, not under it: the snow is what it is coming through.
  // Reduced effects has no twitch, and holds the snow still with it.
  let seed = (twitch === 0 ? 1 : Math.floor(tMs / 90) * 2654435761) >>> 0;
  ctx.fillStyle = '#7c7e82';
  for (let i = 0; i < 2600; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed % W;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    ctx.fillRect(x, seed % H, 3, 2);
  }
}

const DRAW: Record<ApparitionKind, (frame: Frame) => void> = {
  anchor: drawAnchor,
  gourd: drawGourd,
  operator: drawOperator,
  deadair: drawDeadAir,
};

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
  const u = clamp01(tMs / Math.max(1, durationMs));
  const twitch = reduced ? 0 : Math.sin(tMs * 0.031) * Math.sin(tMs * 0.0073) * 7;
  DRAW[kind]({ ctx, W, H, u, twitch, tMs });
  if (text) {
    ctx.fillStyle = '#d9d7cb';
    ctx.font = '44px "Courier New", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, 648, W - 60);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

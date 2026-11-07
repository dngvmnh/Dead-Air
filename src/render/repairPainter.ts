/**
 * Earlier tears, badly mended by someone who is not the viewer (requirement 4.2):
 * a rough seam, yellowed tape across it, and one square of wallpaper put back in
 * the wrong place and at the wrong angle. Painted onto a copy of the wall, so the
 * paper is whole again and can be torn again. Fixed by each stroke's seed, so the
 * repair looks the same on every load.
 */

import type { StoredStroke } from '../core/memory.ts';
import { bakeWallpaper } from './roomWallpaper.ts';

// Plain paper to cut the misplaced square from, one per wall size.
let paperCache: { w: number; h: number; canvas: HTMLCanvasElement } | null = null;
function plainPaper(w: number, h: number): HTMLCanvasElement {
  if (!paperCache || paperCache.w !== w || paperCache.h !== h) paperCache = { w, h, canvas: bakeWallpaper(w, h).canvas };
  return paperCache.canvas;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return (a >>> 8) / 16777216;
  };
}

function tracePath(ctx: CanvasRenderingContext2D, pts: ReadonlyArray<readonly [number, number]>, dx = 0, dy = 0): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x + dx, y + dy);
    else ctx.lineTo(x + dx, y + dy);
  });
  ctx.stroke();
}

function paintRepair(ctx: CanvasRenderingContext2D, paper: HTMLCanvasElement, stroke: StoredStroke, W: number, H: number): void {
  const rnd = seeded(stroke.seed);
  const pts = stroke.points.map(([x, y]) => [x * W, y * H] as const);

  // A seam that never quite closes: dark in the gap, paper fibre along one lip.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const jagged = pts.flatMap(([x, y], i) => {
    const next = pts[i + 1];
    if (!next) return [[x, y] as const];
    return [[x, y] as const, [(x + next[0]) / 2 + (rnd() - 0.5) * 7, (y + next[1]) / 2 + (rnd() - 0.5) * 7] as const];
  });
  ctx.strokeStyle = 'rgba(4, 3, 2, 0.92)';
  ctx.lineWidth = 3.5;
  tracePath(ctx, jagged);
  ctx.strokeStyle = 'rgba(214, 204, 176, 0.5)';
  ctx.lineWidth = 1;
  tracePath(ctx, jagged, 2, 1.5);

  // One piece of the wall, from somewhere else, put back here. Cut from plain paper,
  // never from the room as drawn, or it could carry a scrap of the note or a frame.
  const [mx, my] = pts[Math.floor(pts.length / 2)]!;
  const size = 62 + rnd() * 44;
  const sx = rnd() * Math.max(1, W - size);
  const sy = rnd() * Math.max(1, H - size);
  const corners = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    const r = (size / 2) * (0.82 + rnd() * 0.36);
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  });
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate((rnd() < 0.5 ? -1 : 1) * (0.2 + rnd() * 0.45));
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = '#16100a';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip();
  ctx.drawImage(paper, sx, sy, size * 1.3, size * 1.3, -size * 0.65, -size * 0.65, size * 1.3, size * 1.3);
  ctx.restore();

  // Tape, every so often, at whatever angle was easiest. Added last, because it
  // holds the patch down too.
  let carried = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    carried += Math.hypot(bx - ax, by - ay);
    if (carried < 58) continue;
    carried = 0;
    const along = Math.atan2(by - ay, bx - ax);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(along + Math.PI / 2 + (rnd() - 0.5) * 0.7);
    const w = 46 + rnd() * 26;
    const h = 13 + rnd() * 5;
    // Brighter than feels right, because the room is dim by Act 2 and this has to read.
    ctx.fillStyle = `rgba(${226 + rnd() * 26}, ${198 + rnd() * 22}, ${122 + rnd() * 22}, 0.94)`;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = 'rgba(60, 44, 20, 0.35)';
    ctx.fillRect(-w / 2, -h / 2 + 1, w, 1);
    ctx.fillRect(-w / 2, h / 2 - 2, w, 1);
    ctx.restore();
  }
}

/** A copy of `base` with these strokes mended. `base` itself is left alone. */
export function paintRepairs(base: HTMLCanvasElement, strokes: readonly StoredStroke[]): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext('2d');
  if (!ctx) return base;
  ctx.drawImage(base, 0, 0);
  const paper = strokes.length > 0 ? plainPaper(out.width, out.height) : base;
  for (const stroke of strokes) paintRepair(ctx, paper, stroke, out.width, out.height);
  return out;
}

/**
 * Bakes what a tear reveals, by act (design §4, requirement 3). Original
 * procedural art that implies and never shows: no gore, no real people, no real
 * places. Every word comes from `core/behindState`, so it is the viewer's real
 * history or the fixed sign-off text.
 *
 * Marks and text repeat across the wall, because a rip only ever shows a slot of
 * it. Most repeats land in the bands the set leaves exposed.
 */

import type { BehindView } from '../core/behindState.ts';
import { SIGN_OFF_LINES } from './overlayRenderer.ts';
import { bakeBehindPlaster } from './roomWallpaper.ts';
import type { BehindLayer } from './tearRenderer.ts';

const W = 1024;
const H = 768;

interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function surface(fill: string): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for behind layer');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, W, H);
  return { canvas, ctx };
}

function plasterSurface(dim: number): Surface {
  const s = surface('#000000');
  s.ctx.drawImage(bakeBehindPlaster(W, H).canvas, 0, 0);
  if (dim > 0) {
    s.ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
    s.ctx.fillRect(0, 0, W, H);
  }
  return s;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return (a >>> 8) / 16777216;
  };
}

/** Where marks go: a staggered grid over the whole wall, so any gash finds some. */
function markSites(seed: number, stepX: number, stepY: number): Array<[number, number]> {
  const rnd = seeded(seed);
  const sites: Array<[number, number]> = [];
  let row = 0;
  for (let y = stepY * 0.5; y < H; y += stepY) {
    for (let x = row % 2 === 0 ? stepX * 0.3 : stepX * 0.8; x < W; x += stepX) {
      sites.push([x + (rnd() - 0.5) * 14, y + (rnd() - 0.5) * 14]);
    }
    row += 1;
  }
  return sites;
}

/** Older wallpaper left under the top layer. Ordinary, which is the point. */
function oldWallpaper(ctx: CanvasRenderingContext2D): void {
  const rnd = seeded(0x51ab);
  for (let i = 0; i < 26; i += 1) {
    const x = rnd() * W;
    const y = rnd() * H;
    const w = 40 + rnd() * 130;
    const h = 30 + rnd() * 100;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rnd() - 0.5) * 0.3);
    ctx.fillStyle = 'rgb(112, 92, 86)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(58, 40, 40, 0.8)';
    for (let fy = 8; fy < h; fy += 22) {
      for (let fx = 8; fx < w; fx += 22) {
        ctx.beginPath();
        ctx.arc(fx, fy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

/**
 * Pencil tally marks in fives: the viewer's real count, at every site. Drawn on
 * the emissive layer because graphite glinting is what makes them readable in a
 * hole this dark.
 */
function tallyMarks(ctx: CanvasRenderingContext2D, count: number): void {
  if (count <= 0) return;
  const rnd = seeded(0x7a11);
  ctx.strokeStyle = 'rgba(120, 117, 108, 0.7)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const [sx, sy] of markSites(0x7a11, 92, 72)) {
    let x = sx - 26;
    let y = sy - 12;
    for (let i = 1; i <= Math.min(count, 40); i += 1) {
      if (i % 5 === 0) {
        ctx.beginPath();
        ctx.moveTo(x - 36, y + 19);
        ctx.lineTo(x + 2, y + 3);
        ctx.stroke();
        x += 12;
      } else {
        ctx.beginPath();
        ctx.moveTo(x + (rnd() - 0.5) * 2, y);
        ctx.lineTo(x + (rnd() - 0.5) * 3, y + 22);
        ctx.stroke();
        x += 8;
      }
      if (i % 10 === 0) {
        x = sx - 26;
        y += 28;
      }
    }
  }
}

/** Where the far televisions sit, as fractions of the wall. */
const FAR_TVS = [[0.07, 0.34], [0.93, 0.62], [0.3, 0.05], [0.68, 0.94], [0.08, 0.8], [0.92, 0.2]] as const;

/** Words keep this far from a far television, so the two never overlap. */
function nearFarTv(x: number, y: number): boolean {
  return FAR_TVS.some(([fx, fy]) => Math.abs(x - fx * W) < 110 && Math.abs(y - fy * H) < 76);
}

/**
 * Words dug into the plaster. Stacked a word to a row, because a rip is a narrow
 * slot and a long line would never be read through one.
 */
function scratchedText(ctx: CanvasRenderingContext2D, lines: readonly string[]): void {
  if (lines.length === 0) return;
  const rnd = seeded(0x5c2a);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 19px "Courier New", monospace';
  ctx.fillStyle = 'rgb(138, 130, 112)';
  markSites(0x5c2a, 128, 118).forEach(([x, y], i) => {
    if (nearFarTv(x, y)) return;
    const words = lines[i % lines.length]!.split(' ');
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rnd() - 0.5) * 0.12);
    words.forEach((word, row) => ctx.fillText(word, 0, (row - (words.length - 1) / 2) * 22));
    ctx.restore();
  });
}

/** A tiny second television, far off in the gap, showing nothing but snow. */
function farTelevisions(ctx: CanvasRenderingContext2D): void {
  const rnd = seeded(0x2f7e);
  for (const [fx, fy] of FAR_TVS) {
    const w = 30;
    const h = 22;
    const x = fx * W - w / 2;
    const y = fy * H - h / 2;
    const glow = ctx.createRadialGradient(fx * W, fy * H, 2, fx * W, fy * H, 48);
    glow.addColorStop(0, 'rgba(120, 130, 150, 0.32)');
    glow.addColorStop(1, 'rgba(120, 130, 150, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 48, y - 48, w + 96, h + 96);
    for (let py = 0; py < h; py += 2) {
      for (let px = 0; px < w; px += 2) {
        const v = 70 + rnd() * 100;
        ctx.fillStyle = `rgb(${v}, ${v}, ${v + 8})`;
        ctx.fillRect(x + px, y + py, 2, 2);
      }
    }
  }
}

/** Rows of dim sets, all showing the fixed sign-off text and nothing else. */
function rowsOfTelevisions(ctx: CanvasRenderingContext2D): void {
  const lines = SIGN_OFF_LINES.filter((l) => l.length > 0);
  const tw = 148;
  const th = 108;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '7.5px "Courier New", monospace';
  for (let y = 6; y < H; y += th + 14) {
    for (let x = 6; x < W; x += tw + 12) {
      ctx.fillStyle = 'rgb(16, 15, 14)';
      ctx.fillRect(x - 5, y - 5, tw + 10, th + 10);
      ctx.fillStyle = 'rgb(22, 24, 28)';
      ctx.fillRect(x, y, tw, th);
      ctx.fillStyle = 'rgb(168, 170, 160)';
      lines.forEach((line, i) => ctx.fillText(line, x + tw / 2, y + th / 2 + (i - 1) * 14));
    }
  }
}

/** Bake the layer for this viewer. `reduced` removes the movement in the dark. */
export function bakeBehindLayer(view: BehindView, reduced: boolean): BehindLayer {
  switch (view.act) {
    case 0: {
      const s = plasterSurface(0);
      oldWallpaper(s.ctx);
      return { albedo: s.canvas, emissive: null, holeFloor: 0.32, motion: 0 };
    }
    case 1: {
      const s = plasterSurface(0);
      const marks = surface('#000000');
      tallyMarks(marks.ctx, view.tally);
      return { albedo: s.canvas, emissive: marks.canvas, holeFloor: 0.26, motion: 0 };
    }
    case 2: {
      const s = plasterSurface(0.35);
      const glow = surface('#000000');
      scratchedText(glow.ctx, view.lines);
      farTelevisions(glow.ctx);
      return { albedo: s.canvas, emissive: glow.canvas, holeFloor: 0.2, motion: 0 };
    }
    case 3: {
      // Mostly darkness. Only the very rim of a tear shows the wall was ever there.
      const s = plasterSurface(0.86);
      return { albedo: s.canvas, emissive: null, holeFloor: 0.04, motion: reduced ? 0 : 0.8 };
    }
    default: {
      const s = surface('#040404');
      const glow = surface('#000000');
      rowsOfTelevisions(glow.ctx);
      return { albedo: s.canvas, emissive: glow.canvas, holeFloor: 0.05, motion: 0 };
    }
  }
}

/**
 * Two pale points at the viewer's last tear, on an otherwise empty layer. Seen
 * only through a hole, because only the behind pass ever samples it.
 */
export function bakeGlimpse(x01: number, y01: number): HTMLCanvasElement {
  const s = surface('#000000');
  const cx = x01 * W;
  const cy = y01 * H;
  for (const dx of [-16, 16]) {
    const eye = s.ctx.createRadialGradient(cx + dx, cy, 0.5, cx + dx, cy, 9);
    eye.addColorStop(0, 'rgba(226, 222, 204, 0.95)');
    eye.addColorStop(0.45, 'rgba(170, 164, 142, 0.38)');
    eye.addColorStop(1, 'rgba(170, 164, 142, 0)');
    s.ctx.fillStyle = eye;
    s.ctx.fillRect(cx + dx - 10, cy - 10, 20, 20);
  }
  return s.canvas;
}

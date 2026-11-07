/** Small pure helpers for art shaded per pixel instead of drawn in shapes. */

export function smooth(edge0: number, edge1: number, v: number): number {
  const c = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return c * c * (3 - 2 * c);
}

export function bump(dx: number, dy: number, rx: number, ry: number): number {
  return Math.exp(-((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)));
}

export function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function noise(x: number, y: number): number {
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

export function fbm(x: number, y: number): number {
  return noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.15;
}

/** Signed distance to a capsule from (ax, ay) to (bx, by), radius `r`. */
export function capsule(x: number, y: number, ax: number, ay: number, bx: number, by: number, r: number): number {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.min(1, Math.max(0, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - dx * t, py - dy * t) - r;
}

/** Capsule that narrows from `r0` at (ax, ay) to `r1` at (bx, by): a talon or a fang. */
export function taper(x: number, y: number, ax: number, ay: number, bx: number, by: number, r0: number, r1: number): number {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.min(1, Math.max(0, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - dx * t, py - dy * t) - (r0 + (r1 - r0) * t);
}

/** Thin dark lines wandering through a surface: veins, not cracks. 1 on a line. */
export function veins(x: number, y: number, scale: number, width: number): number {
  return smooth(width, 0, Math.abs(fbm(x * scale, y * scale) - 0.5));
}

export type Crack = readonly [number, number, number, number, number];

/**
 * Jagged lines running out from `origins` and forking as they go. Each segment is
 * ax, ay, bx, by, half-width. Fixed by `seed`, so a surface always breaks the same way.
 */
export function makeCracks(seed: number, origins: ReadonlyArray<readonly [number, number, number]>, steps = 9): Crack[] {
  let a = seed >>> 0;
  const rnd = (): number => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return (a >>> 8) / 16777216;
  };
  const out: Crack[] = [];
  const grow = (x0: number, y0: number, angle0: number, n: number, w: number): void => {
    let x = x0;
    let y = y0;
    let angle = angle0;
    for (let i = 0; i < n; i += 1) {
      angle += (rnd() - 0.5) * 1.15;
      const len = 0.035 + rnd() * 0.075;
      const nx = x + Math.cos(angle) * len;
      const ny = y + Math.sin(angle) * len;
      const width = w * (1 - (i / n) * 0.8);
      out.push([x, y, nx, ny, width]);
      if (rnd() < 0.3 && n - i > 2) grow(nx, ny, angle + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), n - i - 1, width * 0.6);
      x = nx;
      y = ny;
    }
  };
  for (const [x, y, angle] of origins) grow(x, y, angle, steps, 0.008);
  return out;
}

/** 1 on a crack, falling to 0 just off it. */
export function crackAt(x: number, y: number, cracks: readonly Crack[]): number {
  let best = 0;
  for (const [ax, ay, bx, by, w] of cracks) {
    if (x < Math.min(ax, bx) - 0.02 || x > Math.max(ax, bx) + 0.02 || y < Math.min(ay, by) - 0.02 || y > Math.max(ay, by) + 0.02) continue;
    const d = capsule(x, y, ax, ay, bx, by, 0);
    if (d < w * 1.6) best = Math.max(best, smooth(w * 1.6, w * 0.5, d));
  }
  return best;
}

export function rotate(x: number, y: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

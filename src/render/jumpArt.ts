/**
 * Ten scares that are not a face. Each is shaded per pixel, because flat shapes read
 * as a cartoon, and each has two poses so a jump can cut between them. All original
 * and procedural: no gore, no real person, never a white field or saturated red
 * (requirement 11.7). Coordinates are -1..1 with y down; a 16:10 window shows about
 * -0.65..0.65 of y at the widest shot, so the part that matters stays in there.
 */

import { bump, capsule, crackAt, fbm, hash, makeCracks, rotate, smooth, taper } from './fieldMath.ts';

export const ART_KINDS = ['hands', 'eye', 'maw', 'doll', 'crowd', 'snow', 'pumpkin', 'spider', 'skull', 'claws'] as const;
export type ArtKind = (typeof ART_KINDS)[number];
export type Pose = 0 | 1;

type Rgb = readonly [number, number, number];
interface Art {
  /** Colours at luminance 0, 0.5 and 1. */
  palette: readonly [Rgb, Rgb, Rgb];
  field: (x: number, y: number, pose: Pose) => number;
}

// --- hands: black against fogged glass, pressing in, with a finger too many ---

function handDistance(x: number, y: number): number {
  let d = capsule(x, y, -0.2, 0.3, 0.2, 0.3, 0.3);
  d = Math.min(d, capsule(x, y, -0.27, 0.12, 0.27, 0.12, 0.17));
  for (const [bx, tx, tipY] of [[-0.36, -0.62, -0.42], [-0.2, -0.33, -0.72], [-0.04, -0.07, -0.82], [0.12, 0.2, -0.76], [0.27, 0.46, -0.56], [0.4, 0.74, -0.24]] as const) {
    d = Math.min(d, taper(x, y, bx, 0.06, tx, tipY, 0.088, 0.05));
  }
  return Math.min(d, taper(x, y, 0.42, 0.42, 0.86, 0.2, 0.11, 0.055));
}

const HANDS: Record<Pose, ReadonlyArray<readonly [number, number, number, number]>> = {
  0: [[-0.48, 0.16, 0.74, -0.24], [0.5, 0.2, 0.8, 0.28]],
  1: [[-0.7, -0.16, 0.5, -0.42], [-0.06, 0.26, 0.72, -0.06], [0.68, 0.02, 0.6, 0.46], [0.2, -0.36, 0.44, 0.16], [-0.62, 0.48, 0.54, 0.18]],
};

function hands(x: number, y: number, pose: Pose): number {
  // Fogged glass lit from this side, with runs where the wet has started to drip.
  const drip = smooth(0.62, 0.8, fbm(x * 26, y * 1.6));
  let l = (0.2 + 0.44 * fbm(x * 2 + 1, y * 2 + 2)) * (1 - 0.5 * drip);
  for (const [cx, cy, s, a] of HANDS[pose]) {
    const [u, v] = rotate((x - cx) / s, (y - cy) / s, a);
    const d = handDistance(u, v);
    if (d < 0) {
      // Black, except where flesh presses hard enough to catch the light.
      const press = smooth(-0.05, -0.22, d);
      l = 0.012 + 0.2 * press * (0.5 + fbm(u * 9, v * 9)) * smooth(-0.1, 0.25, v);
    } else {
      // The wipe around each hand, where the fog has been pushed away.
      l *= 1 - 0.65 * Math.exp(-(d * d) / 0.007);
    }
  }
  return l;
}

// --- eye: one, and it fills everything ----------------------------------------

const EYE_VEINS = makeCracks(0x3e11, [[-0.98, 0, -0.1], [-0.8, -0.18, 0.2], [-0.82, 0.12, -0.2], [0.98, 0, 3.2], [0.8, 0.14, 3.4], [0.84, -0.16, 2.9], [-0.55, 0.26, -0.4], [0.5, -0.32, 2.5]], 11);

function eye(x: number, y: number, pose: Pose): number {
  const open = pose === 1 ? 1.28 : 1;
  const edge = Math.max(0, 1 - (x / 0.98) ** 2);
  const lidUp = -0.44 * open * edge;
  const lidDown = 0.33 * open * edge;
  const inside = y > lidUp && y < lidDown;
  if (!inside) {
    const fold = Math.abs(Math.sin((y - lidUp * 0.8) * 34 + fbm(x * 5, y * 5) * 9)) ** 5;
    const near = Math.min(Math.abs(y - lidUp), Math.abs(y - lidDown));
    const lash = y < lidUp && near < 0.22 ? smooth(0.8, 1, Math.sin(x * 92 + y * 14) * 0.5 + 0.5) * smooth(0.22, 0.02, near) : 0;
    return (0.05 + 0.2 * fbm(x * 8, y * 8)) * (1 - 0.4 * fold) * smooth(0, 0.14, near) * (1 - lash);
  }
  const shade = smooth(0, 0.16, y - lidUp) * smooth(0, 0.06, lidDown - y);
  const ix = pose === 1 ? -0.1 : 0.03;
  const iy = pose === 1 ? 0.03 : -0.03;
  const r = Math.hypot(x - ix, y - iy);
  const R = 0.34;
  let l: number;
  if (r < R) {
    const a = Math.atan2(y - iy, x - ix);
    const strands = 0.5 + 0.5 * Math.sin(a * 46 + fbm(x * 9, y * 9) * 6);
    l = (0.13 + 0.3 * strands * smooth(R, R * 0.35, r)) * smooth(R, R * 0.88, r);
    const pupil = pose === 1 ? 0.035 : 0.085;
    l *= smooth(pupil, pupil * 1.25, r);
    l += 0.5 * bump(x - ix + 0.1, y - iy + 0.11, 0.022, 0.016);
  } else {
    const vein = crackAt(x, y, EYE_VEINS) * smooth(R * 0.95, R * 1.25, r);
    l = (0.68 - 0.3 * r) * (0.8 + 0.3 * fbm(x * 9, y * 9)) * (1 - 0.72 * vein);
  }
  return l * (0.1 + 0.9 * shade);
}

// --- maw: rows of teeth, and it is closing -----------------------------------

function teeth(x: number, y: number, base: number, height: number, width: number, down: boolean, phase: number): number {
  const curve = base + (down ? -1 : 1) * 0.2 * x * x;
  const column = x / width + phase;
  const tx = column - Math.floor(column) - 0.5;
  const uneven = 0.62 + 0.62 * hash(Math.floor(column), down ? 3 : 8);
  const reach = height * uneven * Math.max(0, 1 - 2 * Math.abs(tx)) ** 0.75;
  const from = down ? curve - y : y - curve;
  if (from < 0 || from > reach) return -1;
  // Round across the tooth, stained at the root, and wet down one edge.
  const round = Math.sqrt(Math.max(0, 1 - (2 * tx) ** 2));
  const stain = 0.42 + 0.58 * smooth(0, reach * 0.8, from);
  const wet = 0.32 * bump(tx + 0.17, 0, 0.05, 1);
  return ((0.14 + 0.46 * round) * stain * (0.75 + 0.45 * fbm(x * 30, y * 8)) + wet * stain) * smooth(0, 0.016, reach - from + 0.002);
}

function maw(x: number, y: number, pose: Pose): number {
  const gap = pose === 1 ? 0.36 : 0.6;
  const gum = (u: number, v: number): number => 0.09 * fbm(u * 7, v * 11) + 0.2 * smooth(0.68, 0.8, fbm(u * 19, v * 19));
  const gumU = y < -gap - 0.1 ? gum(x, y) : 0;
  const gumD = y > gap + 0.1 ? gum(x + 4, y) : 0;
  let l = Math.max(gumU, gumD, 0.004);
  // Back rows first, so the front ones cut across them.
  for (const [depth, dim] of [[0.46, 0.2], [0.7, 0.48], [1, 1]] as const) {
    const base = gap / depth + 0.14;
    const width = 0.27 * depth;
    const h = 0.6 * depth;
    const up = teeth(x, y, -base, h, width, false, depth * 3.1);
    if (up >= 0) l = up * dim;
    const dn = teeth(x, y, base, h, width, true, depth * 1.7 + 0.5);
    if (dn >= 0) l = dn * dim;
  }
  return l * (1 - 0.55 * smooth(0.45, 1, Math.abs(x)));
}

// --- doll: porcelain, cracked, with nothing behind the eyes -------------------

const DOLL_CRACKS: Record<Pose, ReadonlyArray<ReturnType<typeof makeCracks>[number]>> = {
  0: makeCracks(0xd011, [[-0.42, -0.3, -2.2], [0.5, 0.2, 0.7], [-0.1, 0.6, 2.2]]),
  1: makeCracks(0xd012, [[-0.47, -0.2, -2.4], [-0.5, 0.05, 2.7], [-0.2, -0.15, -0.5], [-0.28, 0.1, 0.9], [0.5, 0.2, 0.7], [0.02, 0.58, 1.9], [0.16, 0.5, 0.2]], 11),
};

function doll(x0: number, y0: number, pose: Pose): number {
  const [x, y] = rotate(x0, y0 - 0.02, pose === 1 ? 0.42 : -0.05);
  const d = Math.hypot(x / 0.86, (y + 0.02) / 1.05);
  if (d >= 1) {
    const hair = smooth(0.42, 0.62, fbm(x * 3, y * 22));
    return 0.1 * hair * smooth(1.45, 1, d);
  }
  // One weak lamp from the side, so half of it is lost.
  const lamp = 0.2 + 0.8 * smooth(0.95, -0.5, x + y * 0.2);
  let l = (0.26 + 0.46 * Math.sqrt(1 - d * d)) * lamp * (0.94 + 0.12 * fbm(x * 9, y * 9));
  l += 0.2 * bump(x + 0.36, y + 0.5, 0.16, 0.09) * lamp; // the glaze catching light
  l *= 1 - 0.3 * bump(Math.abs(x) - 0.5, y - 0.26, 0.17, 0.13); // painted cheeks, faded
  l *= 1 - 0.75 * bump(Math.abs(x) - 0.31, y + 0.47, 0.17, 0.012); // thin high brows

  // The eyes are holes, and the left has started to break outward.
  for (const side of [-1, 1] as const) {
    const ex = x - side * 0.31;
    const ey = y + 0.09;
    const wide = pose === 1 && side === -1 ? 1.28 : 1;
    const r = Math.hypot(ex / (0.205 * wide), ey / (0.23 * wide)) + (fbm(x * 15, y * 15) - 0.5) * (wide > 1 ? 0.5 : 0.06);
    l *= smooth(0.96, 1.1, r);
    if (r < 1.02) l += 0.4 * bump(ex + 0.07, ey + 0.09, 0.024, 0.02);
    // Lashes, painted on a long time ago.
    if (r > 1.04 && r < 1.14 && ey < -0.08) l *= 1 - 0.5 * smooth(0.8, 0.98, Math.sin(Math.atan2(ey, ex) * 44) * 0.5 + 0.5);
  }

  // The mouth is small and painted until it is not.
  const mouth = Math.hypot(x / 0.1, (y - 0.47) / 0.045);
  l *= 0.4 + 0.6 * smooth(0.8, 1.05, mouth);
  if (pose === 1) {
    const broken = Math.hypot((x - 0.03) / 0.2, (y - 0.56) / 0.16) + (fbm(x * 16, y * 16) - 0.5) * 0.7;
    l *= smooth(0.88, 1.02, broken);
  }

  // Cracks last, because they are on top of everything else.
  l *= 1 - 0.92 * crackAt(x, y, DOLL_CRACKS[pose]);
  return l * smooth(1, 0.92, d);
}

// --- crowd: everyone has turned round -----------------------------------------

interface Head {
  x: number;
  y: number;
  s: number;
  light: number;
  seed: number;
}

function crowdHeads(pose: Pose): Head[] {
  const out: Head[] = [];
  const close = pose === 1 ? 1.32 : 1;
  for (const [row, count, y, size, light] of [[0, 11, -0.5, 0.11, 0.1], [1, 9, -0.32, 0.16, 0.2], [2, 7, -0.06, 0.23, 0.4], [3, 4, 0.26, 0.38, 0.86]] as const) {
    for (let i = 0; i < count; i += 1) {
      const across = ((i + 0.5) / count) * 2 - 1;
      out.push({
        x: (across * 1.08 + (hash(i, row) - 0.5) * 0.09) * close,
        y: (y + (hash(row, i) - 0.5) * 0.05) * close,
        s: size * close,
        light,
        seed: i * 7 + row * 31,
      });
    }
  }
  return out;
}

const CROWD: Record<Pose, Head[]> = { 0: crowdHeads(0), 1: crowdHeads(1) };

function crowd(x: number, y: number, pose: Pose): number {
  let l = 0.004;
  for (const h of CROWD[pose]) {
    const u = (x - h.x) / h.s;
    const v = (y - h.y) / h.s;
    if (v > -1.2 && v < 3.6 && Math.abs(u) < 1.6) {
      // Shoulders blot out whoever stands behind.
      const body = capsule(u, v, -0.68, 1.5, 0.68, 1.5, 0.4) < 0 || capsule(u, v, 0, 0.8, 0, 1.4, 0.16) < 0;
      if (body) l = 0.008;
    }
    // Long heads, narrowing hard to the chin.
    const width = 0.56 - 0.2 * smooth(0, 1.2, v);
    const d = Math.hypot(u / width, v / 1.16);
    if (d >= 1) continue;
    // Lit weakly from below and in front: brow and cheekbone, nothing between.
    const round = Math.sqrt(1 - d * d);
    let f = (0.1 + 0.62 * round * round) * (0.45 + 1.05 * fbm(u * 5 + h.seed, v * 5)) * h.light;
    f *= 1 - 0.78 * bump(Math.abs(u) - 0.27, v - 0.42, 0.13, 0.26);
    f += 0.1 * h.light * bump(u, v - 0.02, 0.05, 0.22);
    for (const side of [-1, 1] as const) {
      const r = Math.hypot((u - side * 0.21) / 0.135, (v + 0.2) / 0.11);
      f *= smooth(0.62, 1.2, r);
      f += 0.8 * h.light * bump(u - side * 0.21, v + 0.2, 0.017, 0.017);
    }
    if (pose === 1) f *= smooth(0.82, 1.05, Math.hypot(u / 0.075, (v - 0.64) / 0.3));
    else f *= 1 - 0.8 * bump(u, v - 0.66, 0.15, 0.014);
    l = f;
  }
  return l;
}

// --- snow: something standing in the static, and only the static shows it -----

function snow(x: number, y: number, pose: Pose): number {
  const n = hash(Math.floor((x + 3) * 95), Math.floor((y + 3) * 95));
  const field = (0.12 + 0.5 * n) * (0.82 + 0.28 * fbm(x * 2, y * 9));
  const s = pose === 1 ? 1.46 : 1;
  const u = x / s;
  const v = (y - (pose === 1 ? 0.2 : 0)) / s;
  const rag = (fbm(u * 8, v * 8) - 0.5) * 0.09;
  let d = Math.hypot(u / 0.2, (v + 0.34) / 0.31) - 1;
  d = Math.min(d, capsule(u, v, 0, -0.14, 0, 0.05, 0.075));
  d = Math.min(d, capsule(u, v, -0.33, 0.1, 0.33, 0.1, 0.11));
  d = Math.min(d, taper(u, v, 0, 0.1, 0, 1, 0.3, 0.55));
  // Arms up, finished in too many fingers.
  const ax = Math.abs(u);
  d = Math.min(d, capsule(ax, v, 0.33, 0.08, 0.62, -0.3, 0.04));
  for (const [tx, ty] of [[0.5, -0.58], [0.6, -0.64], [0.7, -0.6], [0.8, -0.5], [0.84, -0.36]] as const) {
    d = Math.min(d, taper(ax, v, 0.62, -0.3, tx, ty, 0.024, 0.008));
  }
  const body = smooth(0.012, -0.03, d + rag);
  let l = field * (1 - body * 0.97);
  for (const side of [-1, 1] as const) l += 0.95 * bump(u - side * 0.082, v + 0.37, 0.024, 0.016);
  return l;
}

// --- pumpkin: carved by something that had only heard of faces ----------------

/** A slit that leans, hacked out rather than cut. */
function slitIn(x: number, y: number, cx: number, cy: number, w: number, h: number, lean: number): boolean {
  const t = (y - (cy - h / 2)) / h;
  if (t < 0 || t > 1) return false;
  const hack = (fbm(x * 16, y * 16) - 0.5) * 0.05;
  return Math.abs(x - cx - lean * (1 - t)) < w * t ** 0.8 + hack;
}

function pumpkin(x: number, y: number, pose: Pose): number {
  const d = Math.hypot(x / 1.0, (y - 0.03) / 0.86);
  if (d >= 1) return 0.006;
  const round = Math.sqrt(1 - d * d);
  const ribs = 0.28 + 0.72 * Math.abs(Math.cos(Math.asin(Math.max(-1, Math.min(1, x / 1.02))) * 5.5)) ** 0.8;
  // Weak light from under the chin, and mould eating the skin.
  const under = 0.22 + 0.78 * smooth(-0.8, 0.8, y);
  const mould = smooth(0.5, 0.7, fbm(x * 4 + 3, y * 4));
  const l = (0.03 + 0.34 * round) * ribs * under * (0.6 + 0.8 * fbm(x * 9, y * 26)) * (1 - 0.82 * mould);

  const eyeH = pose === 1 ? 0.56 : 0.46;
  const grin = 0.42 - 0.5 * x * x;
  const half = (pose === 1 ? 0.27 : 0.17) * Math.max(0, 1 - (x / 0.84) ** 2) ** 0.5;
  const col = x / 0.17 + 0.5;
  const tx = col - Math.floor(col) - 0.5;
  const uneven = 0.5 + hash(Math.floor(col), 4);
  const fang = Math.max(0, 1 - 3.1 * Math.abs(tx)) * half * 1.15 * uneven;
  const from = y - grin;
  const hack = (fbm(x * 14, y * 14) - 0.5) * 0.045;
  const inMouth = Math.abs(from) + hack < half && (from < 0 ? from > -half + fang : from < half - fang * (0.5 + hash(Math.floor(col), 9) * 0.5));
  const inEye = slitIn(Math.abs(x), y, 0.38, -0.25, 0.2, eyeH, -0.14);
  const inNose = slitIn(x, y, 0.02, 0.05, 0.05, 0.13, 0.02);
  if (inMouth || inEye || inNose) {
    // A flame low inside: the holes burn at the bottom and go dark at the top.
    const flame = 0.22 + 0.72 * smooth(-0.62, 0.62, y) + 0.5 * (fbm(x * 8, y * 4) - 0.5);
    return Math.min(0.92, Math.max(0.1, flame));
  }
  return l * (1 - 0.5 * smooth(0.72, 1, d));
}

// --- spider: from closer than anyone has ever wanted to see one ---------------

const LEGS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [0.3, -0.2, 0.72, -0.72, 1.12, -0.42],
  [0.36, -0.08, 0.92, -0.42, 1.25, 0.05],
  [0.36, 0.06, 0.95, -0.02, 1.2, 0.58],
  [0.28, 0.2, 0.74, 0.34, 0.95, 0.92],
];

function spider(x: number, y: number, pose: Pose): number {
  const s = pose === 1 ? 1.42 : 1;
  const u = x / s;
  const v = (y + (pose === 1 ? 0.1 : 0)) / s;
  const ax = Math.abs(u);
  let l = 0.008;
  const hair = fbm(u * 34, v * 34);

  let leg = 9;
  for (const [ax0, ay0, kx, ky, ex, ey] of LEGS) {
    leg = Math.min(leg, taper(ax, v, ax0, ay0, kx, ky, 0.072, 0.052), taper(ax, v, kx, ky, ex, ey, 0.052, 0.018));
  }
  if (leg < 0.012 * (0.5 + hair)) l = (0.1 + 0.2 * smooth(0, -0.05, leg)) * (0.5 + 0.9 * hair);

  // The abdomen behind, then the head in front.
  const belly = Math.hypot(u / 0.5, (v + 0.52) / 0.36);
  if (belly < 1) l = (0.05 + 0.16 * (1 - belly)) * (0.45 + 1.1 * hair);
  const body = Math.hypot(u / 0.44, (v - 0.02) / 0.37);
  if (body < 1 + (hair - 0.5) * 0.09) l = (0.08 + 0.28 * Math.sqrt(Math.max(0, 1 - body * body))) * (0.42 + 1.15 * hair);

  // Fangs, which are the only clean thing about it.
  const fang = taper(ax, v, 0.13, 0.25, 0.05, 0.66, 0.085, 0.006);
  if (fang < 0) l = (0.3 + 0.42 * smooth(-0.08, 0, fang)) * (0.72 + 0.5 * fbm(u * 12, v * 5));

  // Eight eyes, all of them on you.
  for (const [ex, ey, r] of [[0.1, -0.1, 0.075], [0.27, -0.17, 0.052], [0.07, -0.24, 0.042], [0.2, -0.3, 0.032]] as const) {
    const de = Math.hypot(ax - ex, v - ey) / r;
    if (de < 1) {
      l = 0.03 + 0.1 * (1 - de);
      l += 0.92 * bump(ax - ex + r * 0.3, v - ey + r * 0.34, r * 0.3, r * 0.26);
    }
  }
  return l;
}

// --- skull: the jaw comes down further than a jaw comes down ------------------

const SKULL_CRACKS = makeCracks(0x5c01, [[0.12, -0.92, 1.3], [-0.5, -0.62, 0.9], [0.56, -0.38, 2.7], [-0.14, -0.5, 1.8], [0.3, 0.22, 0.6]], 11);

function skull(x0: number, y0: number, pose: Pose): number {
  const [x, y] = rotate(x0, y0 + 0.03, pose === 1 ? -0.16 : 0.08);
  const ax = Math.abs(x);
  const dome = Math.hypot(x / 0.76, (y + 0.28) / 0.68);
  const cheek = capsule(x, y, -0.27, 0.1, 0.27, 0.1, 0.24);
  const inHead = dome < 1 || cheek < 0;
  const drop = pose === 1 ? 0.27 : 0.04;
  const jawV = y - drop;
  const jaw = capsule(x, jawV, -0.26, 0.45, 0.26, 0.45, 0.12);
  if (!inHead && jaw >= 0) return 0.006;

  // A lamp from low on one side. The far half of the head is barely there.
  const lamp = 0.1 + 0.9 * smooth(0.85, -0.55, x - y * 0.25);
  const form = 0.16 + 0.5 * Math.sqrt(Math.max(0, 1 - Math.min(1, dome) ** 2));
  let l = form * lamp * (0.62 + 0.72 * fbm(x * 8, y * 8));
  if (inHead) {
    l *= 1 - 0.95 * crackAt(x, y, SKULL_CRACKS);
    l *= 1 - 0.72 * bump(ax - 0.62, y - 0.0, 0.14, 0.2); // temple hollows
    l *= 1 - 0.6 * bump(ax - 0.34, y - 0.26, 0.15, 0.09); // under the cheekbones
    l += 0.2 * lamp * bump(ax - 0.3, y + 0.39, 0.2, 0.055); // the brow ridge

    for (const side of [-1, 1] as const) {
      const sx = x - side * 0.29;
      const sy = y + 0.11;
      // Sockets sag at the outer corner, and their edges are rough.
      const r = Math.hypot(sx / 0.21, (sy - side * sx * 0.3) / 0.19) + (fbm(x * 14, y * 14) - 0.5) * 0.22;
      l *= smooth(0.82, 1.06, r);
      if (pose === 1) l += 0.85 * bump(sx, sy, 0.017, 0.017);
    }
    const noseW = 0.12 * smooth(-0.14, 0.18, y) + (fbm(x * 20, y * 20) - 0.5) * 0.03;
    if (Math.abs(x) < noseW && y > -0.1 && y < 0.17) l *= 0.03;
  }

  // Each tooth is its own, and a few are gone.
  const col = x / 0.085 + 0.5;
  const idx = Math.floor(col);
  const tx = Math.abs(col - idx - 0.5);
  const round = Math.sqrt(Math.max(0, 1 - (tx * 2) ** 2));
  const toothAt = (v: number, from: number, to: number, seed: number): number => {
    const missing = hash(idx, seed) < 0.16;
    const end = to - hash(idx, seed + 1) * 0.04;
    if (missing || v < from || v > end) return 0.012;
    return (0.1 + 0.58 * round) * lamp * (0.65 + 0.6 * fbm(x * 22, y * 9)) * smooth(0, 0.02, end - v);
  };
  if (Math.abs(x) < 0.36) {
    if (y > 0.24 && y < 0.39) l = toothAt(y, 0.24, 0.39, 2);
    if (jawV > 0.31 && jawV < 0.42) l = toothAt(jawV, 0.31, 0.42, 6);
  }
  if (y >= 0.39 && jawV <= 0.31) l = 0.004;
  return l;
}

// --- claws: the window tears, and what tore it is still coming through --------

const SLASHES: ReadonlyArray<readonly [number, number, number, number]> = [
  [-0.26, -0.95, -0.92, 0.84],
  [0.14, -1, -0.46, 0.96],
  [0.56, -1, -0.02, 1],
  [0.98, -0.92, 0.42, 0.9],
];

function claws(x: number, y: number, pose: Pose): number {
  let l = (0.06 + 0.14 * fbm(x * 3, y * 14)) * (0.6 + 0.8 * fbm(x * 30, y * 7));
  const wide = pose === 1 ? 1.75 : 1;
  for (const [ax, ay, bx, by] of SLASHES) {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    const w = 0.082 * wide * Math.sin(Math.PI * t) ** 0.6;
    const ragged = (fbm(x * 18, y * 18) - 0.5) * 0.06 + (fbm(x * 54, y * 54) - 0.5) * 0.024;
    const d = Math.hypot(x - ax - dx * t, y - ay - dy * t) - w + ragged;
    if (d < 0) l = 0.01 + 0.03 * smooth(0, -0.03, d) * (1 - smooth(-0.03, -0.1, d));
    else if (d < 0.05) l = Math.max(l, 0.66 * smooth(0.05, 0.005, d) * (0.5 + 0.8 * fbm(x * 40, y * 40)));
  }
  // Eyes in the dark behind the wall, seen only through the gashes.
  if (l < 0.05) {
    for (const [ex, ey] of [[-0.12, -0.15], [0.328, -0.2]] as const) l = Math.max(l, 0.95 * bump(x - ex, y - ey, 0.034, 0.026));
  }
  if (pose === 1) {
    // And now the talons, curling round the torn edge.
    for (const [ax, ay, bx, by] of SLASHES) {
      const mx = ax + (bx - ax) * 0.72;
      const my = ay + (by - ay) * 0.72;
      const d = Math.min(taper(x, y, mx + 0.09, my + 0.5, mx, my, 0.09, 0.05), taper(x, y, mx, my, mx - 0.1, my - 0.38, 0.05, 0.004));
      if (d < 0) l = (0.26 + 0.6 * smooth(-0.05, 0, d)) * (0.6 + 0.7 * fbm(x * 9, y * 22));
    }
  }
  return l;
}

const ART: Record<ArtKind, Art> = {
  hands: { field: hands, palette: [[0, 0, 0], [0.42, 0.44, 0.42], [0.92, 0.9, 0.82]] },
  eye: { field: eye, palette: [[0, 0, 0], [0.4, 0.36, 0.3], [0.92, 0.88, 0.72]] },
  maw: { field: maw, palette: [[0, 0, 0], [0.42, 0.3, 0.22], [0.92, 0.84, 0.6]] },
  doll: { field: doll, palette: [[0, 0, 0], [0.5, 0.45, 0.4], [0.94, 0.9, 0.82]] },
  crowd: { field: crowd, palette: [[0, 0, 0], [0.36, 0.42, 0.38], [0.84, 0.92, 0.84]] },
  snow: { field: snow, palette: [[0, 0, 0], [0.48, 0.5, 0.54], [0.92, 0.93, 0.96]] },
  pumpkin: { field: pumpkin, palette: [[0.01, 0, 0], [0.85, 0.36, 0.04], [1, 0.86, 0.36]] },
  spider: { field: spider, palette: [[0, 0, 0], [0.38, 0.32, 0.28], [0.92, 0.92, 0.9]] },
  skull: { field: skull, palette: [[0, 0, 0], [0.48, 0.44, 0.36], [0.94, 0.9, 0.76]] },
  claws: { field: claws, palette: [[0, 0, 0], [0.42, 0.36, 0.3], [0.94, 0.9, 0.8]] },
};

/** Luminance of a scare at (x, y), clamped. Pure, so its limits can be tested. */
export function artLuminance(kind: ArtKind, x: number, y: number, pose: Pose): number {
  const raw = Math.min(1, Math.max(0, ART[kind].field(x, y, pose)));
  // Corners fall away, as they do on a badly lit, badly exposed frame.
  return raw * (1 - 0.42 * smooth(0.45, 1.25, Math.hypot(x, y * 1.3)));
}

function colourAt(palette: Art['palette'], l: number, channel: 0 | 1 | 2): number {
  const [low, mid, high] = palette;
  return l < 0.5 ? low[channel] + (mid[channel] - low[channel]) * l * 2 : mid[channel] + (high[channel] - mid[channel]) * (l - 0.5) * 2;
}

/** RGBA for a `size` square of this scare. Pure, so a worker can run it. */
export function artPixels(kind: ArtKind, pose: Pose, size: number): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const { palette } = ART[kind];
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const l = artLuminance(kind, (px / (size - 1)) * 2 - 1, (py / (size - 1)) * 2 - 1, pose);
      const i = (py * size + px) * 4;
      data[i] = colourAt(palette, l, 0) * 255;
      data[i + 1] = colourAt(palette, l, 1) * 255;
      data[i + 2] = colourAt(palette, l, 2) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

/**
 * Deterministic Verlet tear sheet (design §2). Pure core logic: no DOM, no
 * `Date.now`, no `Math.random` — `dtMs` and the `seed` are arguments (tech.md).
 * The renderer uploads these node positions; this module only simulates.
 *
 * A sheet is a grid of nodes joined by structural and diagonal constraints.
 * Outer-edge nodes are pinned, so paper rips rather than flying off. A
 * constraint whose length exceeds `restLength * tearLimit` breaks permanently
 * (`broken` is never reset). Grabbed nodes are pulled toward a target each step.
 *
 * Positions live in grid units (one unit per cell); the caller scales to
 * canvas pixels. `z` carries curl/lift for the renderer's lighting and shadow.
 */

export interface TearSheet {
  cols: number;
  rows: number;
  /** Current positions. */
  xs: Float32Array;
  ys: Float32Array;
  zs: Float32Array;
  /** Previous positions (Verlet integrates from the implicit velocity x - px). */
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  /** 1 for a pinned node, which never moves. */
  pinned: Uint8Array;
  /** Flattened pairs of node indices: [a0, b0, a1, b1, ...]. */
  constraints: Int32Array;
  /** Rest length per constraint (indexed by constraint number, = pair index). */
  restLength: Float32Array;
  /** 1 once a constraint has broken; never reset to 0. */
  broken: Uint8Array;
  /** Per-constraint stretch ratio at which it breaks (jittered by the seed). */
  tearLimit: Float32Array;
  /** Node id -> target position for an active grab (sparse). */
  grabbed: Map<number, { x: number; y: number }>;
}

/**
 * Chosen grid sizes (design §2 said ~96×60 wall / ~48×36 tube, "tune to meet
 * the budget"). Measured with `tsx` on this machine (an upper bound vs the
 * browser), the design sizes cost ~9 ms/frame — over the 3 ms budget (req
 * 10.2). These tuned sizes stay under 3 ms each: wall 48×30 ≈ 2.3 ms, tube
 * 36×28 ≈ 1.6 ms. Re-confirm in-browser at the budget check (task 13).
 */
export const WALL_COLS = 48;
export const WALL_ROWS = 30;
export const TUBE_COLS = 36;
export const TUBE_ROWS = 28;

/** Gravity per ms^2, tuned so a detached piece falls at a readable pace. */
const GRAVITY = 0.00004;
/** Verlet damping (slight energy loss so the sheet settles). */
const DAMPING = 0.98;
/** Fixed simulation sub-step (design §2). */
const FIXED_DT_MS = 16.6667;
/** Constraint-solver iterations per sub-step (design §2). */
const SOLVER_ITERATIONS = 3;
/** Base stretch ratio at which a constraint tears, before per-constraint jitter. */
const BASE_TEAR_LIMIT = 1.6;
/** How much the seed jitters each constraint's tear limit (± this fraction). */
const TEAR_JITTER = 0.5;

/** A small deterministic PRNG (mulberry32); seeded, so no Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flat node index for a grid coordinate. */
export function nodeIndex(sheet: { cols: number }, col: number, row: number): number {
  return row * sheet.cols + col;
}

/** Number of constraints that have broken. */
export function countBroken(sheet: TearSheet): number {
  let n = 0;
  for (let i = 0; i < sheet.broken.length; i += 1) if (sheet.broken[i] === 1) n += 1;
  return n;
}

/**
 * Build a `cols`×`rows` sheet. Outer-edge nodes are pinned. Constraints run
 * along grid lines (horizontal, vertical) and both diagonals. Tear limits are
 * jittered deterministically by `seed` so tears wander like paper fibre.
 */
export function createSheet(cols: number, rows: number, seed: number): TearSheet {
  const n = cols * rows;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const zs = new Float32Array(n);
  const pinned = new Uint8Array(n);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      xs[i] = c;
      ys[i] = r;
      zs[i] = 0;
      if (c === 0 || c === cols - 1 || r === 0 || r === rows - 1) pinned[i] = 1;
    }
  }

  // Constraints: right, down, and the two diagonals of each cell.
  const pairs: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (c + 1 < cols) pairs.push(i, i + 1); // right
      if (r + 1 < rows) pairs.push(i, i + cols); // down
      if (c + 1 < cols && r + 1 < rows) {
        pairs.push(i, i + cols + 1); // down-right diagonal
        pairs.push(i + 1, i + cols); // down-left diagonal
      }
    }
  }

  const constraints = Int32Array.from(pairs);
  const count = constraints.length / 2;
  const restLength = new Float32Array(count);
  const broken = new Uint8Array(count);
  const tearLimit = new Float32Array(count);
  const rand = mulberry32(seed);

  for (let k = 0; k < count; k += 1) {
    const a = constraints[k * 2]!;
    const b = constraints[k * 2 + 1]!;
    const dx = xs[a]! - xs[b]!;
    const dy = ys[a]! - ys[b]!;
    restLength[k] = Math.hypot(dx, dy);
    // Jitter in [1 - TEAR_JITTER, 1 + TEAR_JITTER] × BASE, deterministic by seed.
    tearLimit[k] = BASE_TEAR_LIMIT * (1 + (rand() * 2 - 1) * TEAR_JITTER);
  }

  return {
    cols,
    rows,
    xs,
    ys,
    zs,
    px: xs.slice(),
    py: ys.slice(),
    pz: zs.slice(),
    pinned,
    constraints,
    restLength,
    broken,
    tearLimit,
    grabbed: new Map(),
  };
}

/** Begin dragging node `id` toward `(x, y)`. */
export function grab(sheet: TearSheet, id: number, x: number, y: number): void {
  if (id < 0 || id >= sheet.xs.length) return;
  sheet.grabbed.set(id, { x, y });
}

/** Move an active grab's target. A no-op if `id` is not grabbed. */
export function moveGrab(sheet: TearSheet, id: number, x: number, y: number): void {
  const g = sheet.grabbed.get(id);
  if (g) {
    g.x = x;
    g.y = y;
  }
}

/** Release a grab. */
export function release(sheet: TearSheet, id: number): void {
  sheet.grabbed.delete(id);
}

/**
 * Advance the sheet by `dtMs`, split into fixed sub-steps so the simulation is
 * stable and frame-rate independent. Each sub-step integrates, pulls grabbed
 * nodes to their targets, then satisfies (and possibly breaks) constraints.
 */
export function stepSheet(sheet: TearSheet, dtMs: number): void {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return;
  // Cap the catch-up so a huge dt (a backgrounded tab) can't explode the sim.
  const clamped = Math.min(dtMs, 100);
  let remaining = clamped;
  while (remaining > 0) {
    const dt = Math.min(FIXED_DT_MS, remaining);
    subStep(sheet, dt);
    remaining -= dt;
  }
}

function subStep(sheet: TearSheet, dt: number): void {
  integrate(sheet, dt);
  // Pull grabbed nodes to their targets before solving, so the drag propagates.
  for (const [id, target] of sheet.grabbed) {
    if (sheet.pinned[id] === 1) continue;
    sheet.xs[id] = target.x;
    sheet.ys[id] = target.y;
  }
  for (let iter = 0; iter < SOLVER_ITERATIONS; iter += 1) {
    satisfyConstraints(sheet);
  }
}

function integrate(sheet: TearSheet, dt: number): void {
  const { xs, ys, zs, px, py, pz, pinned } = sheet;
  const g = GRAVITY * dt * dt;
  for (let i = 0; i < xs.length; i += 1) {
    if (pinned[i] === 1) continue;
    const cx = xs[i]!;
    const cy = ys[i]!;
    const cz = zs[i]!;
    // Verlet: next = current + (current - previous) * damping + accel.
    const nx = cx + (cx - px[i]!) * DAMPING;
    const ny = cy + (cy - py[i]!) * DAMPING + g;
    // z gently relaxes toward 0 so lifted flaps settle flat.
    const nz = cz + (cz - pz[i]!) * DAMPING * 0.9;
    px[i] = cx;
    py[i] = cy;
    pz[i] = cz;
    xs[i] = Number.isFinite(nx) ? nx : cx;
    ys[i] = Number.isFinite(ny) ? ny : cy;
    zs[i] = Number.isFinite(nz) ? nz : cz;
  }
}

function satisfyConstraints(sheet: TearSheet): void {
  const { xs, ys, constraints, restLength, broken, tearLimit, pinned, grabbed } = sheet;
  const count = restLength.length;
  for (let k = 0; k < count; k += 1) {
    if (broken[k] === 1) continue;
    const a = constraints[k * 2]!;
    const b = constraints[k * 2 + 1]!;
    const dx = xs[b]! - xs[a]!;
    const dy = ys[b]! - ys[a]!;
    const dist = Math.hypot(dx, dy);
    const rest = restLength[k]!;
    if (dist <= 0 || !Number.isFinite(dist)) continue;
    // Break permanently once stretched past the (jittered) tear limit.
    if (dist > rest * tearLimit[k]!) {
      broken[k] = 1;
      continue;
    }
    const diff = (dist - rest) / dist;
    const aPinned = pinned[a] === 1 || grabbed.has(a);
    const bPinned = pinned[b] === 1 || grabbed.has(b);
    // Distribute the correction according to which ends can move.
    let wa = 0.5;
    let wb = 0.5;
    if (aPinned && bPinned) continue;
    if (aPinned) {
      wa = 0;
      wb = 1;
    } else if (bPinned) {
      wa = 1;
      wb = 0;
    }
    const ox = dx * diff;
    const oy = dy * diff;
    if (wa > 0) {
      xs[a] = xs[a]! + ox * wa;
      ys[a] = ys[a]! + oy * wa;
    }
    if (wb > 0) {
      xs[b] = xs[b]! - ox * wb;
      ys[b] = ys[b]! - oy * wb;
    }
  }
}

/**
 * Connected-component label of every node reachable from a pinned node through
 * unbroken constraints. A node in no pinned component is part of a detached
 * piece (design §2: the renderer lets those fall and removes them). Run on
 * break events, not every frame.
 */
export function attachedToPinned(sheet: TearSheet): Uint8Array {
  const n = sheet.xs.length;
  const attached = new Uint8Array(n);
  // Adjacency from unbroken constraints.
  const adj: number[][] = Array.from({ length: n }, () => []);
  const count = sheet.restLength.length;
  for (let k = 0; k < count; k += 1) {
    if (sheet.broken[k] === 1) continue;
    const a = sheet.constraints[k * 2]!;
    const b = sheet.constraints[k * 2 + 1]!;
    adj[a]!.push(b);
    adj[b]!.push(a);
  }
  // BFS from every pinned node.
  const queue: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (sheet.pinned[i] === 1) {
      attached[i] = 1;
      queue.push(i);
    }
  }
  while (queue.length > 0) {
    const i = queue.pop()!;
    for (const j of adj[i]!) {
      if (attached[j] === 0) {
        attached[j] = 1;
        queue.push(j);
      }
    }
  }
  return attached;
}

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
  /** 1 once a node has been shoved open by a cut, so repeated cuts cannot widen it. */
  peeled: Uint8Array;
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

/**
 * Gravity in grid-units per ms². Rest length is 1 unit and a constraint tears
 * past ~1.6×, so gravity must be gentle: the sheet sags a little and holds, and
 * only a viewer's drag (or a detached piece) stretches a constraint to breaking.
 * At dt≈16.67 ms this adds ~5e-4 units/sub-step — a slow, stable sag.
 */
const GRAVITY = 0.0000018;
/** Verlet damping (slight energy loss so the sheet settles). */
const DAMPING = 0.98;
/** Fixed simulation sub-step (design §2). */
const FIXED_DT_MS = 16.6667;
/** Constraint-solver iterations per sub-step (design §2). */
const SOLVER_ITERATIONS = 3;
/**
 * Stretch ratio at which a constraint tears. Jittered per constraint by the
 * seed so tears wander like fibre, but ALWAYS > 1 — a limit below 1 would make
 * a constraint break at (or near) its rest length, ripping the sheet apart on
 * its own. Range: [MIN, MIN + RANGE] = [1.35, 1.85].
 */
const TEAR_LIMIT_MIN = 1.35;
const TEAR_LIMIT_RANGE = 0.5;
/**
 * How close to the pointer's path a constraint must be to be cut, in grid cells.
 * The hole is every triangle with a cut edge, so this sets the rip's width: at
 * 0.5 a 300 px drag on 1440x900 opens about 40 to 80 px, a rip and not a panel.
 */
export const CUT_RADIUS = 0.5;

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
    // Always > 1 (see TEAR_LIMIT_MIN), deterministic by seed.
    tearLimit[k] = TEAR_LIMIT_MIN + rand() * TEAR_LIMIT_RANGE;
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
    peeled: new Uint8Array(n),
  };
}

/**
 * Begin dragging a node toward `(x, y)`. `id` IS the node index (design §2):
 * the grabbed node is held at the target each sub-step, so the constraint to a
 * neighbour stretches and tears. A caller with multiple pointers maps each
 * pointer to the node it grabbed and passes that node index here.
 */
export function grab(sheet: TearSheet, id: number, x: number, y: number): void {
  if (id < 0 || id >= sheet.xs.length) return;
  sheet.grabbed.set(id, { x, y });
}

/** Move an active grab's target. A no-op if node `id` is not grabbed. */
export function moveGrab(sheet: TearSheet, id: number, x: number, y: number): void {
  const g = sheet.grabbed.get(id);
  if (g) {
    g.x = x;
    g.y = y;
  }
}

/** Release the grab on node `id`. */
export function release(sheet: TearSheet, id: number): void {
  sheet.grabbed.delete(id);
}

/** Squared distance from point p to segment ab, in grid units. */
function distToSegSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + vx * t;
  const cy = ay + vy * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

/**
 * Break every constraint whose midpoint lies within `radius` grid cells of the
 * pointer path segment `(ax,ay)→(bx,by)` (grid units). This is what makes the
 * gash FOLLOW THE POINTER at any drag speed (requirement 1.x, task 5a.3): a
 * grabbed node alone tears only a local patch and skips cells on a fast flick,
 * whereas cutting along the swept segment opens a continuous slit under the
 * path. Interior constraints only — a pinned-to-pinned edge (the frame) is
 * never cut, so the sheet still hangs. Returns how many were newly broken.
 */
export function cutPath(sheet: TearSheet, ax: number, ay: number, bx: number, by: number, radius = CUT_RADIUS): number {
  const { xs, ys, constraints, broken, restLength, pinned } = sheet;
  const count = restLength.length;
  const r2 = radius * radius;
  let cut = 0;
  for (let k = 0; k < count; k += 1) {
    if (broken[k] === 1) continue;
    const a = constraints[k * 2]!;
    const b = constraints[k * 2 + 1]!;
    // Keep the outer frame intact so paper rips but does not fall away.
    if (pinned[a] === 1 && pinned[b] === 1) continue;
    const mx = (xs[a]! + xs[b]!) * 0.5;
    const my = (ys[a]! + ys[b]!) * 0.5;
    if (distToSegSq(mx, my, ax, ay, bx, by) <= r2) {
      broken[k] = 1;
      cut += 1;
      // Lift the two freed sides so the flaps catch the light. The hole itself
      // comes from dropping triangles with a cut edge, so it stays open however
      // the sheet settles (task 5a.3).
      const dirx = bx - ax;
      const diry = by - ay;
      const dlen = Math.hypot(dirx, diry) || 1;
      // Perpendicular to the drag direction.
      const nx = -diry / dlen;
      const ny = dirx / dlen;
      peel(sheet, a, nx, ny);
      peel(sheet, b, -nx, -ny);
    }
  }
  return cut;
}

/**
 * Lift a freed node and nudge it off the cut, once only. A node touches many
 * cut constraints, so an unguarded shove accumulates into the stretched spikes
 * and panel-sized holes this replaces. No velocity is added, so it stays put.
 */
function peel(sheet: TearSheet, i: number, nx: number, ny: number): void {
  if (sheet.pinned[i] === 1 || sheet.peeled[i] === 1) return;
  sheet.peeled[i] = 1;
  const SHOVE = 0.16; // grid units
  const LIFT = 0.5;
  const dx = nx * SHOVE;
  const dy = ny * SHOVE;
  sheet.xs[i] = sheet.xs[i]! + dx;
  sheet.ys[i] = sheet.ys[i]! + dy;
  sheet.px[i] = sheet.px[i]! + dx;
  sheet.py[i] = sheet.py[i]! + dy;
  sheet.zs[i] = Math.max(sheet.zs[i]!, LIFT);
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

/** How long rebuilding a wall may hold up a load (design §6). */
export const REPLAY_BUDGET_MS = 100;
const REPLAY_SETTLE_STEPS = 24;

/**
 * Cut stored strokes (normalised points) into `sheet` and let the flaps settle,
 * newest first, so anything past the budget costs the oldest. Rebuilt damage only
 * has to look like the same damage. Returns how many strokes went in.
 */
export function replayStrokes(
  sheet: TearSheet,
  strokes: ReadonlyArray<{ points: ReadonlyArray<readonly [number, number]> }>,
  now: () => number,
  budgetMs = REPLAY_BUDGET_MS,
): number {
  const start = now();
  let kept = 0;
  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    if (now() - start >= budgetMs) break;
    const { points } = strokes[i]!;
    for (let p = 1; p < points.length; p += 1) {
      const [ax, ay] = points[p - 1]!;
      const [bx, by] = points[p]!;
      cutPath(sheet, ax * (sheet.cols - 1), ay * (sheet.rows - 1), bx * (sheet.cols - 1), by * (sheet.rows - 1));
    }
    kept += 1;
  }
  if (kept > 0) {
    for (let s = 0; s < REPLAY_SETTLE_STEPS && now() - start < budgetMs; s += 1) stepSheet(sheet, 16.67);
  }
  return kept;
}

/**
 * Something behind the sheet pressing it towards the viewer around (gx, gy). Lift
 * eases to a dome inside `radius` and back to flat in the ring outside it, so a
 * moving push leaves nothing raised behind it, and strength 0 lets the sheet down.
 * Moves positions and their history together, so it adds no velocity and cannot
 * tear anything on its own.
 */
export function pushSheet(sheet: TearSheet, gx: number, gy: number, radius: number, strength: number): void {
  const { cols, rows, xs, ys, zs, px, py, pz, pinned } = sheet;
  const reach = radius * 2;
  const c0 = Math.max(0, Math.floor(gx - reach));
  const c1 = Math.min(cols - 1, Math.ceil(gx + reach));
  const r0 = Math.max(0, Math.floor(gy - reach));
  const r1 = Math.min(rows - 1, Math.ceil(gy + reach));
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const i = r * cols + c;
      if (pinned[i] === 1) continue;
      const d = Math.hypot(c - gx, r - gy);
      if (d > reach) continue;
      const u = d / radius;
      const target = u < 1 ? strength * (1 - u * u) ** 2 : 0;
      const next = zs[i]! + (target - zs[i]!) * 0.35;
      zs[i] = next;
      pz[i] = next;
      if (target > 0 && d > 0) {
        // The paper bows out around whatever is behind it.
        const shift = (0.05 * target * (c - gx)) / Math.max(d, 1);
        const shiftY = (0.05 * target * (r - gy)) / Math.max(d, 1);
        xs[i] = xs[i]! + shift;
        px[i] = px[i]! + shift;
        ys[i] = ys[i]! + shiftY;
        py[i] = py[i]! + shiftY;
      }
    }
  }
}

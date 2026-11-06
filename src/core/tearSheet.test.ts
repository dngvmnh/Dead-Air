import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createSheet,
  grab,
  moveGrab,
  release,
  cutPath,
  stepSheet,
  nodeIndex,
  countBroken,
  type TearSheet,
} from './tearSheet.ts';

/**
 * The tear simulation is pure core logic (design §2): no DOM, no Date.now, no
 * Math.random — dt and seed are arguments. These tests lock the four fast-check
 * properties from the design plus the functional behaviour a tear needs:
 * stretching a constraint past its limit breaks it permanently.
 */

function allFinite(sheet: TearSheet): boolean {
  for (let i = 0; i < sheet.xs.length; i += 1) {
    if (!Number.isFinite(sheet.xs[i]!) || !Number.isFinite(sheet.ys[i]!) || !Number.isFinite(sheet.zs[i]!)) {
      return false;
    }
  }
  return true;
}

function snapshotPinned(sheet: TearSheet): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < sheet.pinned.length; i += 1) {
    if (sheet.pinned[i] === 1) out.push([sheet.xs[i]!, sheet.ys[i]!, sheet.zs[i]!]);
  }
  return out;
}

describe('createSheet', () => {
  it('builds a grid with outer-edge nodes pinned and constraints present', () => {
    const s = createSheet(8, 6, 123);
    expect(s.xs.length).toBe(8 * 6);
    // Corners and edges are pinned so paper rips instead of flying off.
    expect(s.pinned[nodeIndex(s, 0, 0)]).toBe(1);
    expect(s.pinned[nodeIndex(s, 7, 0)]).toBe(1);
    expect(s.pinned[nodeIndex(s, 0, 5)]).toBe(1);
    expect(s.pinned[nodeIndex(s, 7, 5)]).toBe(1);
    // An interior node is free.
    expect(s.pinned[nodeIndex(s, 3, 3)]).toBe(0);
    // Structural constraints exist (grid lines + diagonals).
    expect(s.constraints.length).toBeGreaterThan(0);
    expect(s.restLength.length).toBe(s.constraints.length / 2);
    expect(countBroken(s)).toBe(0);
  });

  it('is deterministic: same cols/rows/seed give identical state', () => {
    const a = createSheet(10, 8, 42);
    const b = createSheet(10, 8, 42);
    expect(Array.from(a.xs)).toEqual(Array.from(b.xs));
    expect(Array.from(a.tearLimit)).toEqual(Array.from(b.tearLimit));
    // A different seed jitters the tear limits differently.
    const c = createSheet(10, 8, 43);
    expect(Array.from(c.tearLimit)).not.toEqual(Array.from(a.tearLimit));
  });
});

describe('stepSheet', () => {
  it('keeps positions finite under gravity for many steps', () => {
    const s = createSheet(12, 9, 7);
    for (let i = 0; i < 200; i += 1) stepSheet(s, 16.67);
    expect(allFinite(s)).toBe(true);
  });

  it('a resting sheet never tears itself (stable under gravity alone)', () => {
    // No grab: gentle gravity must sag, not rip. The wall grid is the real one.
    const s = createSheet(48, 30, 1);
    for (let i = 0; i < 600; i += 1) stepSheet(s, 16.67);
    expect(countBroken(s)).toBe(0);
    expect(allFinite(s)).toBe(true);
  });

  it('never moves a pinned node', () => {
    const s = createSheet(12, 9, 7);
    const before = snapshotPinned(s);
    // Grab an interior node (grab id IS the node index, design §2) and yank it.
    const n = nodeIndex(s, 6, 4);
    grab(s, n, s.xs[n]!, s.ys[n]!);
    moveGrab(s, n, s.xs[n]! + 500, s.ys[n]! + 500);
    for (let i = 0; i < 60; i += 1) stepSheet(s, 16.67);
    release(s, n);
    for (let i = 0; i < 60; i += 1) stepSheet(s, 16.67);
    expect(snapshotPinned(s)).toEqual(before);
  });

  it('a stretched constraint breaks, and a broken one never rejoins', () => {
    const s = createSheet(16, 12, 99);
    const node = nodeIndex(s, 8, 6);
    grab(s, node, s.xs[node]!, s.ys[node]!);
    // Drag far past any tear limit to guarantee a break.
    for (let i = 0; i < 40; i += 1) {
      moveGrab(s, node, s.xs[node]! + 2000, s.ys[node]! - 2000);
      stepSheet(s, 16.67);
    }
    const brokenAfterTear = countBroken(s);
    expect(brokenAfterTear).toBeGreaterThan(0);
    release(s, node);
    // Let it settle: the broken count can only grow, never shrink.
    let prev = brokenAfterTear;
    for (let i = 0; i < 120; i += 1) {
      stepSheet(s, 16.67);
      const now = countBroken(s);
      expect(now).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });
});

describe('cutPath (gash follows the pointer, task 5a.3)', () => {
  it('breaks interior constraints along the swept segment', () => {
    const s = createSheet(48, 30, 1);
    const before = countBroken(s);
    // Cut a vertical segment down the middle, well inside the frame.
    const cut = cutPath(s, 24, 6, 24, 24, 1);
    expect(cut).toBeGreaterThan(0);
    expect(countBroken(s)).toBe(before + cut);
  });

  it('follows the path at any speed: one long jump still cuts a continuous slit', () => {
    // A fast flick jumps many cells in a single move. cutPath must still break
    // constraints all along the segment, not just at the ends.
    const s = createSheet(48, 30, 2);
    cutPath(s, 20, 5, 20, 25, 1);
    // Every interior row crossed by the segment must have a broken constraint
    // near column 20 — i.e. the slit is continuous, not two end nicks.
    let rowsWithBreak = 0;
    for (let r = 6; r <= 24; r += 1) {
      const target = nodeIndex(s, 20, r);
      let near = false;
      for (let k = 0; k < s.restLength.length; k += 1) {
        if (s.broken[k] !== 1) continue;
        if (s.constraints[k * 2] === target || s.constraints[k * 2 + 1] === target) {
          near = true;
          break;
        }
      }
      if (near) rowsWithBreak += 1;
    }
    // Almost every row along the slit is cut (allow a little slack at the ends).
    expect(rowsWithBreak).toBeGreaterThanOrEqual(16);
  });

  it('never cuts the pinned frame, so the sheet still hangs', () => {
    const s = createSheet(16, 12, 3);
    // Sweep right along the very top edge, which is all pinned-to-pinned.
    cutPath(s, 1, 0, 14, 0, 1);
    // No constraint whose BOTH ends are pinned may be broken.
    for (let k = 0; k < s.restLength.length; k += 1) {
      const a = s.constraints[k * 2]!;
      const b = s.constraints[k * 2 + 1]!;
      if (s.pinned[a] === 1 && s.pinned[b] === 1) expect(s.broken[k]).toBe(0);
    }
    // The sheet stays finite and no pinned node moved into NaN.
    expect(allFinite(s)).toBe(true);
  });

  it('is deterministic and broken-only-grows after a cut and settle', () => {
    const run = (): number[] => {
      const s = createSheet(20, 16, 7);
      cutPath(s, 10, 4, 10, 12, 1);
      for (let i = 0; i < 60; i += 1) stepSheet(s, 16.67);
      return Array.from(s.broken);
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);

    // After the cut, stepping only ever adds breaks.
    const s = createSheet(20, 16, 7);
    cutPath(s, 10, 4, 10, 12, 1);
    let prev = countBroken(s);
    for (let i = 0; i < 120; i += 1) {
      stepSheet(s, 16.67);
      const now = countBroken(s);
      expect(now).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });
});

describe('fast-check properties (design §2)', () => {
  it('positions stay finite for any grab/move/step sequence', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 20 }),
        fc.integer({ min: 4, max: 16 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.array(
          fc.record({
            dx: fc.double({ min: -3000, max: 3000, noNaN: true }),
            dy: fc.double({ min: -3000, max: 3000, noNaN: true }),
            dt: fc.double({ min: 1, max: 50, noNaN: true }),
          }),
          { maxLength: 30 },
        ),
        (cols, rows, seed, moves) => {
          const s = createSheet(cols, rows, seed);
          const node = nodeIndex(s, Math.floor(cols / 2), Math.floor(rows / 2));
          grab(s, node, s.xs[node]!, s.ys[node]!);
          for (const m of moves) {
            moveGrab(s, node, s.xs[node]! + m.dx, s.ys[node]! + m.dy);
            stepSheet(s, m.dt);
          }
          expect(allFinite(s)).toBe(true);
        },
      ),
    );
  });

  it('a broken constraint is never un-broken by any step sequence', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), fc.array(fc.double({ min: 1, max: 50, noNaN: true }), { maxLength: 40 }), (seed, dts) => {
        const s = createSheet(10, 8, seed);
        const node = nodeIndex(s, 5, 4);
        grab(s, node, s.xs[node]!, s.ys[node]!);
        moveGrab(s, node, s.xs[node]! + 5000, s.ys[node]! + 5000);
        const brokenSet = new Set<number>();
        for (const dt of dts) {
          stepSheet(s, dt);
          for (let c = 0; c < s.broken.length; c += 1) {
            if (s.broken[c] === 1) {
              // Once seen broken, it must stay broken forever.
              brokenSet.add(c);
            }
          }
          for (const c of brokenSet) expect(s.broken[c]).toBe(1);
        }
      }),
    );
  });

  it('same seed and inputs produce the same state', () => {
    const run = (): TearSheet => {
      const s = createSheet(12, 9, 2024);
      const node = nodeIndex(s, 6, 4);
      grab(s, node, s.xs[node]!, s.ys[node]!);
      for (let i = 0; i < 20; i += 1) {
        moveGrab(s, node, s.xs[node]! + 100 * i, s.ys[node]! + 50 * i);
        stepSheet(s, 16.67);
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(Array.from(a.xs)).toEqual(Array.from(b.xs));
    expect(Array.from(a.ys)).toEqual(Array.from(b.ys));
    expect(Array.from(a.broken)).toEqual(Array.from(b.broken));
  });
});

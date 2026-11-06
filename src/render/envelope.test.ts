import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  bootDrive,
  isComplete,
  progress,
  rampValue,
  shutdownDrive,
  smoothstep,
} from './envelope.ts';

describe('progress', () => {
  it('is 0 at or before the start and 1 at or after the end', () => {
    expect(progress(1000, 1000, 500)).toBe(0);
    expect(progress(1000, 900, 500)).toBe(0);
    expect(progress(1000, 1500, 500)).toBe(1);
    expect(progress(1000, 9999, 500)).toBe(1);
  });

  it('is the linear fraction within the window', () => {
    expect(progress(1000, 1250, 500)).toBeCloseTo(0.5, 5);
    expect(progress(0, 100, 400)).toBeCloseTo(0.25, 5);
  });

  it('snaps to 1 for a zero, negative or non-finite duration (no divide by zero)', () => {
    expect(progress(1000, 1000, 0)).toBe(1);
    expect(progress(1000, 1000, -5)).toBe(1);
    expect(progress(1000, 1000, Number.NaN)).toBe(1);
    expect(progress(1000, 1000, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('always returns a value in [0,1] for any finite inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e6, max: 1e6 }),
        fc.integer({ min: -1e6, max: 1e6 }),
        fc.integer({ min: 1, max: 1e6 }),
        (start, now, dur) => {
          const p = progress(start, now, dur);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe('smoothstep', () => {
  it('fixes the endpoints and midpoint', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 5);
  });

  it('clamps out-of-range inputs', () => {
    expect(smoothstep(-2)).toBe(0);
    expect(smoothstep(5)).toBe(1);
  });

  it('is monotonic non-decreasing', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          expect(smoothstep(hi)).toBeGreaterThanOrEqual(smoothstep(lo) - 1e-9);
        },
      ),
    );
  });
});

describe('rampValue', () => {
  it('equals `from` at/before the start and `to` at/after the end', () => {
    expect(rampValue(1000, 1000, 500, 0, 1)).toBe(0);
    expect(rampValue(1000, 500, 500, 0, 1)).toBe(0);
    expect(rampValue(1000, 1500, 500, 0, 1)).toBe(1);
    expect(rampValue(1000, 5000, 500, 0, 1)).toBe(1);
  });

  it('stays within [from,to] and is monotonic over the window (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        (ta, tb) => {
          const start = 0;
          const dur = 2000;
          const from = 0;
          const to = 1;
          const lo = Math.min(ta, tb);
          const hi = Math.max(ta, tb);
          const vLo = rampValue(start, lo, dur, from, to);
          const vHi = rampValue(start, hi, dur, from, to);
          // In range.
          expect(vLo).toBeGreaterThanOrEqual(0);
          expect(vLo).toBeLessThanOrEqual(1);
          // Monotonic non-decreasing for an increasing from→to ramp.
          expect(vHi).toBeGreaterThanOrEqual(vLo - 1e-9);
        },
      ),
    );
  });

  it('ramps downward when from > to, staying within [to,from]', () => {
    const mid = rampValue(0, 1000, 2000, 1, 0);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0);
    expect(rampValue(0, 0, 2000, 1, 0)).toBe(1);
    expect(rampValue(0, 2000, 2000, 1, 0)).toBe(0);
  });
});

describe('bootDrive', () => {
  it('starts dark and collapsed, ends bright and full', () => {
    const start = bootDrive(0, 0, 1400);
    expect(start.power).toBe(0);
    expect(start.collapse).toBe(1);
    const end = bootDrive(0, 1400, 1400);
    expect(end.power).toBe(1);
    expect(end.collapse).toBe(0);
  });

  it('brightens and uncollapses monotonically through the window', () => {
    const a = bootDrive(0, 300, 1400);
    const b = bootDrive(0, 900, 1400);
    expect(b.power).toBeGreaterThanOrEqual(a.power);
    expect(b.collapse).toBeLessThanOrEqual(a.collapse);
  });
});

describe('shutdownDrive', () => {
  it('starts bright and full, ends dark and collapsed to a line', () => {
    const start = shutdownDrive(0, 0, 700);
    expect(start.power).toBe(1);
    expect(start.collapse).toBe(0);
    const end = shutdownDrive(0, 700, 700);
    expect(end.power).toBe(0);
    expect(end.collapse).toBe(1);
  });

  it('darkens and collapses monotonically through the window', () => {
    const a = shutdownDrive(0, 150, 700);
    const b = shutdownDrive(0, 500, 700);
    expect(b.power).toBeLessThanOrEqual(a.power);
    expect(b.collapse).toBeGreaterThanOrEqual(a.collapse);
  });
});

describe('isComplete', () => {
  it('is false mid-window and true at/after the end', () => {
    expect(isComplete(0, 699, 700)).toBe(false);
    expect(isComplete(0, 700, 700)).toBe(true);
    expect(isComplete(0, 701, 700)).toBe(true);
  });
});

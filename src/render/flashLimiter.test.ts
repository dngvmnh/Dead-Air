import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FLASH_WINDOW_MS,
  FlashLimiter,
  MAX_FLASHES_PER_SECOND,
} from './flashLimiter.ts';

describe('FlashLimiter', () => {
  it('permits exactly three flashes then denies within the same second (req 13.1)', () => {
    const fl = new FlashLimiter();
    expect(fl.tryFlash(0)).toBe(true);
    expect(fl.tryFlash(100)).toBe(true);
    expect(fl.tryFlash(200)).toBe(true);
    // Fourth flash inside the 1s window is denied.
    expect(fl.tryFlash(300)).toBe(false);
    expect(fl.tryFlash(999)).toBe(false);
  });

  it('allows another flash once the oldest leaves the rolling window', () => {
    const fl = new FlashLimiter();
    fl.tryFlash(0);
    fl.tryFlash(100);
    fl.tryFlash(200);
    expect(fl.tryFlash(500)).toBe(false);
    // At 1001ms the flash at t=0 has aged out (window is (t-1000, t]).
    expect(fl.tryFlash(1001)).toBe(true);
    // But still capped: the 100 and 200 flashes remain in-window.
    expect(fl.tryFlash(1002)).toBe(false);
  });

  it('reports remaining capacity', () => {
    const fl = new FlashLimiter();
    expect(fl.remaining(0)).toBe(3);
    fl.tryFlash(0);
    expect(fl.remaining(0)).toBe(2);
    fl.tryFlash(10);
    fl.tryFlash(20);
    expect(fl.remaining(20)).toBe(0);
  });

  it('denies everything while suppressed (reduced effects / reduced motion, req 13.2)', () => {
    const fl = new FlashLimiter();
    fl.setSuppressed(true);
    expect(fl.tryFlash(0)).toBe(false);
    expect(fl.remaining(0)).toBe(0);
    fl.setSuppressed(false);
    expect(fl.tryFlash(0)).toBe(true);
  });

  it('reset forgets recorded flashes', () => {
    const fl = new FlashLimiter();
    fl.tryFlash(0);
    fl.tryFlash(1);
    fl.tryFlash(2);
    expect(fl.tryFlash(3)).toBe(false);
    fl.reset();
    expect(fl.tryFlash(3)).toBe(true);
  });

  it('a zero cap denies all flashes', () => {
    const fl = new FlashLimiter(0);
    expect(fl.tryFlash(0)).toBe(false);
  });

  it('NEVER grants more than three flashes in ANY rolling one-second window (property)', () => {
    fc.assert(
      fc.property(
        // A rising sequence of request times across ~5 seconds.
        fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 0, maxLength: 400 }),
        (rawTimes) => {
          const times = [...rawTimes].sort((a, b) => a - b);
          const fl = new FlashLimiter();
          const granted: number[] = [];
          for (const t of times) {
            if (fl.tryFlash(t)) granted.push(t);
          }
          // Check every granted flash: at most MAX in the window ending at it.
          for (let i = 0; i < granted.length; i += 1) {
            const windowStart = granted[i]! - FLASH_WINDOW_MS;
            let count = 0;
            for (const g of granted) {
              // Flashes within (end-1000, end]; the limiter evicts <= cutoff.
              if (g > windowStart && g <= granted[i]!) count += 1;
            }
            expect(count).toBeLessThanOrEqual(MAX_FLASHES_PER_SECOND);
          }
          return true;
        },
      ),
    );
  });

  it('honours a custom window length', () => {
    const fl = new FlashLimiter(2, 500);
    expect(fl.tryFlash(0)).toBe(true);
    expect(fl.tryFlash(100)).toBe(true);
    expect(fl.tryFlash(200)).toBe(false);
    // After 500ms the first ages out.
    expect(fl.tryFlash(501)).toBe(true);
  });
});

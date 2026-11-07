import { describe, expect, it } from 'vitest';
import { jumpKindSchema } from '../content/schema.ts';
import { jumpShotAt } from './jumpScare.ts';
import { ART_KINDS, artLuminance } from './jumpArt.ts';

describe('jumpShotAt', () => {
  it.each(jumpKindSchema.options)('%s fills the window from its first frame, with no approach', (kind) => {
    expect(jumpShotAt(kind, 0).scale).toBeGreaterThanOrEqual(1);
  });

  it.each(jumpKindSchema.options)('%s changes pose by a cut and never backs away', (kind) => {
    expect(jumpShotAt(kind, 0).pose).toBe(0);
    expect(jumpShotAt(kind, 700).pose).toBe(1);
    expect(jumpShotAt(kind, 700).scale).toBeGreaterThanOrEqual(jumpShotAt(kind, 0).scale);
  });
});

describe('artLuminance', () => {
  // What the window shows at the widest shot: never a white field, and never so
  // dark that the cut reads as nothing at all (requirement 11.7).
  it.each(ART_KINDS.flatMap((k) => [[k, 0], [k, 1]] as const))('%s pose %i stays dim enough and shows something', (kind, pose) => {
    let sum = 0;
    let n = 0;
    for (let y = -0.62; y <= 0.62; y += 0.031) {
      for (let x = -1; x <= 1; x += 0.031) {
        const l = artLuminance(kind, x, y, pose);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(1);
        sum += l;
        n += 1;
      }
    }
    const mean = sum / n;
    expect(mean).toBeGreaterThan(0.02);
    expect(mean).toBeLessThan(0.6);
  });
});

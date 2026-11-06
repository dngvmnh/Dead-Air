import { describe, expect, it } from 'vitest';
import { FACE_MAX_LUMINANCE, faceLuminance } from './faceField.ts';
import type { ApparitionKind } from './apparition.ts';

const KINDS: ApparitionKind[] = ['anchor', 'gourd', 'operator', 'deadair'];

describe('faceLuminance', () => {
  for (const kind of KINDS) {
    it(`${kind}: has a head, a stare and a mouth, and is never a white field`, () => {
      expect(faceLuminance(kind, 0.95, 0.95)).toBe(0);
      // The tiny pupil is dark, with a pale eye right beside it.
      expect(faceLuminance(kind, -0.33, -0.2)).toBeLessThan(0.08);
      expect(faceLuminance(kind, -0.33 + 0.07, -0.2)).toBeGreaterThan(0.2);
      for (let y = -1; y <= 1; y += 0.04) {
        for (let x = -1; x <= 1; x += 0.04) {
          expect(faceLuminance(kind, x, y)).toBeLessThanOrEqual(FACE_MAX_LUMINANCE);
        }
      }
    });
  }

  it('makes the mouth a dark void', () => {
    expect(faceLuminance('anchor', 0.01, 0.65)).toBeLessThan(0.02);
  });
});

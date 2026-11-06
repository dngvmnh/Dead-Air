import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { activeCaptions, layerVisible, sampleKeyframes, type Keyframe } from './scene.ts';

describe('layerVisible (LayerWhen, requirement 8.3)', () => {
  const vars = (visits: number, act: number) => ({ visits, act });

  it('is always visible with no when clause', () => {
    expect(layerVisible(undefined, vars(1, 0))).toBe(true);
  });

  it('respects inclusive visit bounds', () => {
    expect(layerVisible({ minVisits: 2 }, vars(1, 0))).toBe(false);
    expect(layerVisible({ minVisits: 2 }, vars(2, 0))).toBe(true);
    expect(layerVisible({ maxVisits: 2 }, vars(3, 0))).toBe(false);
    expect(layerVisible({ minVisits: 2, maxVisits: 2 }, vars(2, 0))).toBe(true);
    expect(layerVisible({ minVisits: 2, maxVisits: 2 }, vars(3, 0))).toBe(false);
  });

  it('respects inclusive act bounds', () => {
    expect(layerVisible({ minAct: 2 }, vars(1, 1))).toBe(false);
    expect(layerVisible({ minAct: 2 }, vars(1, 2))).toBe(true);
    expect(layerVisible({ maxAct: 1 }, vars(1, 2))).toBe(false);
  });

  it('requires all present bounds to hold', () => {
    const when = { minVisits: 2, minAct: 1 };
    expect(layerVisible(when, vars(2, 0))).toBe(false);
    expect(layerVisible(when, vars(1, 1))).toBe(false);
    expect(layerVisible(when, vars(2, 1))).toBe(true);
  });
});

describe('sampleKeyframes', () => {
  const kfs: Keyframe[] = [
    { atMs: 0, x: 0, opacity: 0 },
    { atMs: 1000, x: 100, opacity: 1 },
    { atMs: 2000, x: 100, opacity: 1, text: 'LIVE' },
  ];

  it('returns {} for an empty or absent track', () => {
    expect(sampleKeyframes(undefined, 500)).toEqual({});
    expect(sampleKeyframes([], 500)).toEqual({});
  });

  it('holds the first keyframe before the start', () => {
    expect(sampleKeyframes(kfs, -100)).toEqual({ x: 0, opacity: 0 });
  });

  it('holds the last keyframe after the end', () => {
    expect(sampleKeyframes(kfs, 9999)).toEqual({ x: 100, opacity: 1, text: 'LIVE' });
  });

  it('linearly interpolates numeric fields between keyframes', () => {
    const s = sampleKeyframes(kfs, 500);
    expect(s.x).toBeCloseTo(50, 6);
    expect(s.opacity).toBeCloseTo(0.5, 6);
  });

  it('steps text to the earlier keyframe value', () => {
    // Between kf[1] (no text) and kf[2] (text LIVE): earlier has no text.
    expect(sampleKeyframes(kfs, 1500).text).toBeUndefined();
    // At/after kf[2] the text holds.
    expect(sampleKeyframes(kfs, 2000).text).toBe('LIVE');
  });

  it('holds a field defined on only one side of a segment', () => {
    const track: Keyframe[] = [
      { atMs: 0, x: 10 },
      { atMs: 100, y: 20 },
    ];
    const s = sampleKeyframes(track, 50);
    expect(s.x).toBe(10); // only on the left — held
    expect(s.y).toBe(20); // only on the right — held
  });

  it('property: interpolated opacity stays within the endpoints', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: 0, max: 1000 }), (a, b, t) => {
        const track: Keyframe[] = [
          { atMs: 0, opacity: a },
          { atMs: 1000, opacity: b },
        ];
        const o = sampleKeyframes(track, t).opacity ?? 0;
        expect(o).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
        expect(o).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
      }),
    );
  });
});

describe('activeCaptions (requirement 13.3)', () => {
  const caps = [
    { atMs: 0, endMs: 1000, text: 'one' },
    { atMs: 900, endMs: 2000, text: 'two' },
  ];

  it('returns captions whose window contains the instant (half-open)', () => {
    expect(activeCaptions(caps, 500)).toEqual(['one']);
    expect(activeCaptions(caps, 950)).toEqual(['one', 'two']);
    expect(activeCaptions(caps, 1000)).toEqual(['two']); // end is exclusive
    expect(activeCaptions(caps, 2000)).toEqual([]);
  });

  it('returns [] for no captions', () => {
    expect(activeCaptions(undefined, 10)).toEqual([]);
  });
});

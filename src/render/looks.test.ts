import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_LOOK,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  LOOK_PRESETS,
  cappedResolution,
  lookPreset,
  uniformsFor,
} from './looks.ts';
import { type Look } from '../core/types.ts';

const ALL_LOOKS: Look[] = ['broadcast', 'vhs', 'deadair'];
const PRESET_KEYS = [
  'curvature',
  'scanline',
  'mask',
  'bloom',
  'aberration',
  'noise',
  'vignette',
] as const;

describe('look presets', () => {
  it('defines a preset for every Look, including broadcast and deadair (req 5.2)', () => {
    for (const look of ALL_LOOKS) {
      expect(LOOK_PRESETS[look]).toBeDefined();
    }
    expect(LOOK_PRESETS.broadcast).toBeDefined();
    expect(LOOK_PRESETS.deadair).toBeDefined();
  });

  it('gives every preset a finite non-negative value for each effect', () => {
    for (const look of ALL_LOOKS) {
      const preset = lookPreset(look);
      for (const key of PRESET_KEYS) {
        expect(Number.isFinite(preset[key])).toBe(true);
        expect(preset[key]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('makes deadair the most degraded look: stronger curvature, scanlines and vignette than broadcast', () => {
    const broadcast = LOOK_PRESETS.broadcast;
    const deadair = LOOK_PRESETS.deadair;
    expect(deadair.curvature).toBeGreaterThan(broadcast.curvature);
    expect(deadair.scanline).toBeGreaterThan(broadcast.scanline);
    expect(deadair.vignette).toBeGreaterThan(broadcast.vignette);
    expect(deadair.noise).toBeGreaterThan(broadcast.noise);
  });

  it('gives vhs heavier bloom and chroma smear than broadcast', () => {
    expect(LOOK_PRESETS.vhs.bloom).toBeGreaterThan(LOOK_PRESETS.broadcast.bloom);
    expect(LOOK_PRESETS.vhs.aberration).toBeGreaterThan(LOOK_PRESETS.broadcast.aberration);
  });

  it('keeps presets distinct from one another', () => {
    const serialised = ALL_LOOKS.map((l) => JSON.stringify(LOOK_PRESETS[l]));
    expect(new Set(serialised).size).toBe(ALL_LOOKS.length);
  });
});

describe('uniformsFor', () => {
  it('merges a look preset with inert transient defaults into a complete uniform set', () => {
    const u = uniformsFor('broadcast', [320, 240]);
    // Look fields come from the preset.
    expect(u.curvature).toBe(LOOK_PRESETS.broadcast.curvature);
    expect(u.resolution).toEqual([320, 240]);
    // Transient fields default to inert (dark, no disturbance).
    expect(u.power).toBe(0);
    expect(u.static).toBe(0);
    expect(u.roll).toBe(0);
    expect(u.tear).toBe(0);
    expect(u.collapse).toBe(0);
    expect(u.time).toBe(0);
  });

  it('lets a caller override transient fields without touching the preset', () => {
    const u = uniformsFor('deadair', [960, 720], { static: 1, power: 0.5 });
    expect(u.static).toBe(1);
    expect(u.power).toBe(0.5);
    expect(u.curvature).toBe(LOOK_PRESETS.deadair.curvature);
  });

  it('exposes a sensible default look', () => {
    expect(ALL_LOOKS).toContain(DEFAULT_LOOK);
  });
});

describe('cappedResolution (requirement 5.4)', () => {
  it('caps the internal resolution at 960×720 for large screens', () => {
    const r = cappedResolution(3840, 2160);
    expect(r.width).toBe(INTERNAL_WIDTH);
    expect(r.height).toBe(INTERNAL_HEIGHT);
  });

  it('matches the cap exactly at 960×720', () => {
    const r = cappedResolution(960, 720);
    expect(r).toEqual({ width: 960, height: 720 });
  });

  it('scales down to fit a smaller box while preserving the 4:3 aspect', () => {
    const r = cappedResolution(480, 360);
    expect(r).toEqual({ width: 480, height: 360 });
  });

  it('never exceeds the cap regardless of CSS size (no DPR / no upscaling)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        (w, h) => {
          const r = cappedResolution(w, h);
          expect(r.width).toBeLessThanOrEqual(INTERNAL_WIDTH);
          expect(r.height).toBeLessThanOrEqual(INTERNAL_HEIGHT);
          expect(r.width).toBeGreaterThanOrEqual(1);
          expect(r.height).toBeGreaterThanOrEqual(1);
        },
      ),
    );
  });

  it('returns a 1×1 surface for degenerate or non-finite inputs', () => {
    expect(cappedResolution(0, 100)).toEqual({ width: 1, height: 1 });
    expect(cappedResolution(100, 0)).toEqual({ width: 1, height: 1 });
    expect(cappedResolution(-5, 100)).toEqual({ width: 1, height: 1 });
    expect(cappedResolution(Number.NaN, 100)).toEqual({ width: 1, height: 1 });
    expect(cappedResolution(Number.POSITIVE_INFINITY, 100)).toEqual({ width: 1, height: 1 });
  });
});

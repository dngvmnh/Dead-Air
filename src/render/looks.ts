/**
 * Look presets (requirement 5.2) and the internal-resolution cap (5.4).
 *
 * A "look" is a named set of shader-effect amounts. Each per-item `Look` from
 * core/types.ts maps to one preset here. Presets describe the *resting* look:
 * curvature, scanlines, mask, bloom, aberration, noise and vignette. The
 * transient fields the state machine drives — roll, tear, collapse, static,
 * power, time, resolution — default to inert here and are overridden per frame
 * by the renderer and by tasks 4.2 / 4.3.
 *
 * Pure data and pure helpers: no WebGL, no DOM.
 */

import { type Look } from '../core/types.ts';
import { type CrtUniforms } from './crtShader.ts';

/** The look-defined portion of the uniforms: steady-state effect amounts. */
export type LookPreset = Pick<
  CrtUniforms,
  'curvature' | 'scanline' | 'mask' | 'bloom' | 'aberration' | 'noise' | 'vignette'
>;

/**
 * `broadcast` — a clean, well-tuned set. Gentle curvature and scanlines, a
 * little bloom. This is the default for channels 02, 04 and 07.
 */
const BROADCAST: LookPreset = {
  curvature: 0.12,
  scanline: 0.18,
  mask: 0.1,
  bloom: 0.25,
  aberration: 0.6,
  noise: 0.04,
  vignette: 0.35,
};

/**
 * `vhs` — a worn tape: softer, heavier bloom and chroma smear, more grain.
 * Shipped now so channels can opt in; the tracking-noise indicator is stretch
 * task 24 and does not belong to this preset yet.
 */
const VHS: LookPreset = {
  curvature: 0.16,
  scanline: 0.22,
  mask: 0.06,
  bloom: 0.45,
  aberration: 1.6,
  noise: 0.1,
  vignette: 0.4,
};

/**
 * `deadair` — channel 13's wrong, decaying signal. Strong curvature and
 * vignette, pronounced scanlines and mask, heavier baseline noise so the
 * picture always feels on the edge of breaking up.
 */
const DEADAIR: LookPreset = {
  curvature: 0.22,
  scanline: 0.32,
  mask: 0.18,
  bloom: 0.3,
  aberration: 1.1,
  noise: 0.14,
  vignette: 0.6,
};

export const LOOK_PRESETS: Readonly<Record<Look, LookPreset>> = {
  broadcast: BROADCAST,
  vhs: VHS,
  deadair: DEADAIR,
};

/** The look used before any source is on screen (tuning, stand-by, slate). */
export const DEFAULT_LOOK: Look = 'broadcast';

export function lookPreset(look: Look): LookPreset {
  return LOOK_PRESETS[look];
}

/**
 * Inert transient state: no disturbance, dark screen. Combined with a preset
 * this yields a complete, valid `CrtUniforms`. Later tasks override the
 * transient fields (power during boot, static during tuning, and so on).
 */
export const INERT_TRANSIENT: Omit<CrtUniforms, keyof LookPreset | 'resolution'> = {
  time: 0,
  roll: 0,
  tear: 0,
  collapse: 0,
  static: 0,
  power: 0,
};

/**
 * Build a complete uniform set from a look and the current transient state.
 * Pure; the renderer calls this each frame once 4.2/4.3 compute the transient
 * part. For now it lets tests and the happy-path renderer produce a valid set.
 */
export function uniformsFor(
  look: Look,
  resolution: readonly [number, number],
  transient: Partial<Omit<CrtUniforms, keyof LookPreset | 'resolution'>> = {},
): CrtUniforms {
  return {
    ...lookPreset(look),
    resolution,
    ...INERT_TRANSIENT,
    ...transient,
  };
}

/** Internal render resolution cap (requirement 5.4): 4:3 at 960×720. */
export const INTERNAL_WIDTH = 960;
export const INTERNAL_HEIGHT = 720;

/**
 * Compute the internal render resolution for a tube of the given CSS size.
 *
 * The internal resolution is CAPPED and must NOT follow device pixel ratio
 * (tech.md budget): a 4K display still renders at most 960×720 internally and
 * the browser scales the canvas up. We fit the 4:3 cap inside the available
 * box, preserving aspect, and never upscale past the cap. Returns integer
 * pixels, each at least 1.
 */
export function cappedResolution(
  cssWidth: number,
  cssHeight: number,
): { width: number; height: number } {
  // Degenerate or non-finite inputs collapse to a 1×1 surface rather than NaN.
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth <= 0 || cssHeight <= 0) {
    return { width: 1, height: 1 };
  }

  // Scale the capped 4:3 target down to fit the box; never above 1 (no DPR,
  // no upscaling beyond the cap).
  const scale = Math.min(1, cssWidth / INTERNAL_WIDTH, cssHeight / INTERNAL_HEIGHT);
  const width = Math.max(1, Math.round(INTERNAL_WIDTH * scale));
  const height = Math.max(1, Math.round(INTERNAL_HEIGHT * scale));
  return { width, height };
}

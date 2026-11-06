/**
 * Transition envelopes for the CRT renderer (design.md §10, requirements 1.3,
 * 1.4, 2.3). Pure math — no WebGL, no DOM, no wall-clock reads. The renderer
 * (src/render/CrtRenderer.ts) owns the clock; these helpers turn an elapsed
 * time into the shader-uniform values for boot, shutdown and tuning.
 *
 * Boot warms the tube up: the picture expands from a collapsed line to full and
 * brightens (uCollapse 1→0, uPower 0→1) within the boot window (≤1500ms).
 * Shutdown collapses the picture back to a line and dot and darkens (uCollapse
 * 0→1, uPower 1→0) within the shutdown window (≤800ms). Tuning holds full snow
 * (uStatic = 1) while the station is acquired (350–700ms), then releases it.
 *
 * None of this is a DOM/CSS animation: these values feed shader uniforms only.
 */

/** The transition the renderer is currently playing, if any. */
export type EnvelopePhase = 'idle' | 'boot' | 'shutdown';

/** Shader-facing drive values an envelope produces at a given instant. */
export interface EnvelopeDrive {
  /** 0..1 brightness/warm-up envelope → uPower. */
  power: number;
  /** 0..1 vertical collapse to a line → uCollapse (0 = full picture). */
  collapse: number;
}

/**
 * Linear progress through a window, clamped to [0,1]. Returns 0 at or before
 * `startMs`, 1 at or after `startMs + durationMs`, and the linear fraction in
 * between. A non-positive or non-finite duration snaps straight to 1 (the
 * transition is already over), so callers never divide by zero.
 */
export function progress(startMs: number, nowMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  const t = (nowMs - startMs) / durationMs;
  if (!Number.isFinite(t)) return 1;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * Smoothstep easing on a [0,1] input. Monotonic non-decreasing, with f(0)=0 and
 * f(1)=1, so eased transitions keep the same endpoints and ordering as the raw
 * progress. Gives the warm-up/collapse a softer start and end than linear.
 */
export function smoothstep(x: number): number {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

/**
 * Interpolate from `from` to `to` by an eased fraction of the window. The
 * result always stays within [min(from,to), max(from,to)] and is monotonic in
 * `nowMs`, equalling `from` at/before the start and `to` at/after the end.
 */
export function rampValue(
  startMs: number,
  nowMs: number,
  durationMs: number,
  from: number,
  to: number,
): number {
  const p = smoothstep(progress(startMs, nowMs, durationMs));
  return from + (to - from) * p;
}

/**
 * Boot envelope: warm up from a dark collapsed line to a full, bright picture.
 * power 0→1, collapse 1→0 across the boot window.
 */
export function bootDrive(startMs: number, nowMs: number, durationMs: number): EnvelopeDrive {
  return {
    power: rampValue(startMs, nowMs, durationMs, 0, 1),
    collapse: rampValue(startMs, nowMs, durationMs, 1, 0),
  };
}

/**
 * Shutdown envelope: collapse the picture back to a line and darken.
 * power 1→0, collapse 0→1 across the shutdown window. At the end the screen is
 * a dark dot (collapse 1, power 0) before the renderer idles to black.
 */
export function shutdownDrive(startMs: number, nowMs: number, durationMs: number): EnvelopeDrive {
  return {
    power: rampValue(startMs, nowMs, durationMs, 1, 0),
    collapse: rampValue(startMs, nowMs, durationMs, 0, 1),
  };
}

/** True once a transition started at `startMs` has run its full duration. */
export function isComplete(startMs: number, nowMs: number, durationMs: number): boolean {
  return progress(startMs, nowMs, durationMs) >= 1;
}

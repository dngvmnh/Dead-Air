/**
 * Pure scene logic (design §6): layer visibility (`LayerWhen` visit/act
 * variants, requirement 8.3) and keyframe interpolation. No DOM, no drawing —
 * this is the part the renderer and the tests share, kept in `core` so the
 * drawing code in `render/sceneRenderer.ts` is a thin shell over tested maths.
 *
 * Scenes are time-addressable (design §6): every function here is a pure
 * function of the time offset, so the broadcast clock can seek to any instant
 * with no accumulated state.
 */

import type { CaptionInput, KeyframeInput, LayerWhenInput } from '../content/schema.ts';

/** What the current visit looks like, fed to `LayerWhen` (requirement 8.3). */
export interface SceneVars {
  /** How many times this channel has been visited (1 on the first visit). */
  visits: number;
  /** Escalation act 0..4 (design §8). */
  act: number;
}

/**
 * Is a layer visible for the current visit/act? A missing bound is open on that
 * side, and an absent `when` means always visible. Bounds are inclusive so a
 * variant can target an exact visit (`minVisits: 2, maxVisits: 2`).
 */
export function layerVisible(when: LayerWhenInput | undefined, vars: SceneVars): boolean {
  if (!when) return true;
  if (when.minVisits !== undefined && vars.visits < when.minVisits) return false;
  if (when.maxVisits !== undefined && vars.visits > when.maxVisits) return false;
  if (when.minAct !== undefined && vars.act < when.minAct) return false;
  if (when.maxAct !== undefined && vars.act > when.maxAct) return false;
  return true;
}

/**
 * A keyframe as authored: a time offset plus any subset of animatable fields.
 * Aliased to the schema's inferred type so the renderer can pass parsed scene
 * keyframes straight in under `exactOptionalPropertyTypes`.
 */
export type Keyframe = KeyframeInput;

/** The interpolated animatable state of a layer at a given instant. */
export interface KeyframeState {
  x?: number;
  y?: number;
  opacity?: number;
  scale?: number;
  text?: string;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Sample the keyframe track at `tMs`. Before the first keyframe we hold the
 * first; after the last we hold the last; between two we linearly interpolate
 * the numeric fields. `text` is a step value (it takes the earlier keyframe's
 * value until the next keyframe's time is reached), because interpolating a
 * string is meaningless.
 *
 * Keyframes are assumed sorted by `atMs` (the authored data is; the scene
 * schema does not reorder). An empty track yields an empty state.
 */
export function sampleKeyframes(keyframes: readonly Keyframe[] | undefined, tMs: number): KeyframeState {
  if (!keyframes || keyframes.length === 0) return {};
  const first = keyframes[0];
  if (first === undefined) return {};
  if (tMs <= first.atMs) return pick(first);

  const last = keyframes[keyframes.length - 1];
  if (last === undefined) return {};
  if (tMs >= last.atMs) return pick(last);

  // Find the surrounding pair [a, b) with a.atMs <= tMs < b.atMs.
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (a === undefined || b === undefined) break;
    if (tMs >= a.atMs && tMs < b.atMs) {
      const span = b.atMs - a.atMs;
      const t = span <= 0 ? 0 : (tMs - a.atMs) / span;
      return {
        ...numField('x', a.x, b.x, t),
        ...numField('y', a.y, b.y, t),
        ...numField('opacity', a.opacity, b.opacity, t),
        ...numField('scale', a.scale, b.scale, t),
        // text is stepped: the earlier keyframe's value holds until b.
        ...(a.text !== undefined ? { text: a.text } : {}),
      };
    }
  }
  return pick(last);
}

/**
 * Interpolate a numeric field between two keyframes: lerp when both define it,
 * hold whichever side defines it when only one does, omit when neither does.
 */
function numField(
  key: 'x' | 'y' | 'opacity' | 'scale',
  a: number | undefined,
  b: number | undefined,
  t: number,
): Partial<Record<'x' | 'y' | 'opacity' | 'scale', number>> {
  if (typeof a === 'number' && typeof b === 'number') return { [key]: lerp(a, b, t) };
  if (typeof a === 'number') return { [key]: a };
  if (typeof b === 'number') return { [key]: b };
  return {};
}

function pick(k: Keyframe): KeyframeState {
  return {
    ...(k.x !== undefined ? { x: k.x } : {}),
    ...(k.y !== undefined ? { y: k.y } : {}),
    ...(k.opacity !== undefined ? { opacity: k.opacity } : {}),
    ...(k.scale !== undefined ? { scale: k.scale } : {}),
    ...(k.text !== undefined ? { text: k.text } : {}),
  };
}

/**
 * The captions active at `tMs` (requirement 13.3): any caption whose
 * `[atMs, endMs)` window contains the instant. Usually one; the renderer shows
 * them stacked if several overlap.
 */
export function activeCaptions(
  captions: readonly CaptionInput[] | undefined,
  tMs: number,
): string[] {
  if (!captions) return [];
  return captions.filter((c) => tMs >= c.atMs && tMs < c.endMs).map((c) => c.text);
}

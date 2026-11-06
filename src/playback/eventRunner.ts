/**
 * Runs a horror event's steps in order (design §9, requirement 9.3–9.6). The
 * sequencing lives here; the actual effects (static, slate, scene, voice, flash,
 * shader pulse, silence, sign-off) are injected as `EventOps`, so this is unit-
 * testable without a renderer, audio engine or DOM.
 *
 * Degradation (requirement 9.6): if a step's media cannot load, the runner
 * presents that step's captions over static and continues — an event never
 * crashes the TV. The caption text is pre-resolved by the caller (templates are
 * filled against real memory before the steps reach here), so this runner only
 * sequences and degrades.
 */

import type { EventStepInput, SfxCue } from '../content/schema.ts';
import type { Look } from '../core/types.ts';

/**
 * A step whose template text has already been filled (design §9: templates are
 * resolved against real memory before running). Mirrors `EventStepInput` but
 * carries the resolved caption/slate text.
 */
export type ResolvedStep = EventStepInput;

export interface EventOps {
  /** Show procedural static for `ms`, optionally under a look. */
  showStatic(ms: number, look?: Look): Promise<void>;
  /** Show a slate with text for `ms`. */
  showSlate(text: string, ms: number): Promise<void>;
  /** Play a scene by id. Rejects if the scene/media cannot load. */
  playScene(sceneId: string): Promise<void>;
  /** Speak a line (voice url or stems) with a caption. Rejects if media fails. */
  speak(opts: { url?: string; stems?: string[]; caption: string }): Promise<void>;
  /** Flash the previously captured frame for `ms` (gated by flashLimiter). */
  flashPrevious(ms: number): Promise<void>;
  /** Pulse a shader effect for `ms` (gated by flashLimiter). */
  shaderPulse(effect: 'roll' | 'tear' | 'collapse', ms: number): Promise<void>;
  /** Silence for `ms`. */
  silence(ms: number): Promise<void>;
  /** Begin the sign-off cut (the fixed text is handled by the state machine). */
  signOff(): Promise<void>;
  /** Degrade: show caption text over static for `ms` when media failed (9.6). */
  captionsOverStatic(caption: string, ms: number): Promise<void>;
  /** Play a sound. Resolves after `ms` if given, otherwise at once. */
  sfx(cue: SfxCue, gain: number, ms?: number): Promise<void>;
  /** Show a wrong picture on the tube for `ms`. */
  apparition(kind: 'anchor' | 'gourd' | 'operator' | 'deadair', text: string | undefined, ms: number): Promise<void>;
  /** The figure fills the whole window for `ms`, from the tube or the last tear. */
  jump(kind: 'anchor' | 'gourd' | 'operator' | 'deadair', ms: number, from: 'tube' | 'tear'): Promise<void>;
  /** Sink or restore the room's lights over `ms`. */
  roomLights(level: number, ms: number): Promise<void>;
  /** Something pale behind the viewer's tears for `ms`. */
  roomGlimpse(ms: number): Promise<void>;
  /** True if the run should abort (e.g. the viewer surfed away). */
  cancelled(): boolean;
}

/** A sensible default duration for a degraded caption-over-static fallback. */
const DEGRADE_MS = 2500;

/**
 * Execute `steps` in order against `ops`. Resolves when the event completes or
 * is cancelled. Never throws: a failing media step degrades to captions over
 * static (requirement 9.6). Returns whether every step ran without degradation.
 */
export async function runEventSteps(steps: readonly ResolvedStep[], ops: EventOps): Promise<boolean> {
  let clean = true;
  for (const step of steps) {
    if (ops.cancelled()) return clean;
    try {
      await runStep(step, ops);
    } catch {
      clean = false;
      // Degrade to this step's caption (if any) over static, then continue.
      const caption = captionOf(step);
      if (caption) await safe(() => ops.captionsOverStatic(caption, DEGRADE_MS));
      else await safe(() => ops.showStatic(DEGRADE_MS));
    }
  }
  return clean;
}

function runStep(step: ResolvedStep, ops: EventOps): Promise<void> {
  switch (step.do) {
    case 'static':
      return ops.showStatic(step.ms, step.look);
    case 'slate':
      return ops.showSlate(step.text, step.ms);
    case 'scene':
      return ops.playScene(step.sceneId);
    case 'voice':
      return ops.speak({
        ...(step.url === undefined ? {} : { url: step.url }),
        ...(step.stems === undefined ? {} : { stems: step.stems }),
        caption: step.caption,
      });
    case 'flashPrevious':
      return ops.flashPrevious(step.ms);
    case 'shaderPulse':
      return ops.shaderPulse(step.effect, step.ms);
    case 'silence':
      return ops.silence(step.ms);
    case 'signOff':
      return ops.signOff();
    case 'sfx':
      return ops.sfx(step.cue, step.gain ?? 1, step.ms);
    case 'apparition':
      return ops.apparition(step.kind, step.text, step.ms);
    case 'jump':
      return ops.jump(step.kind, step.ms, step.from ?? 'tube');
    case 'roomLights':
      return ops.roomLights(step.level, step.ms);
    case 'roomGlimpse':
      return ops.roomGlimpse(step.ms);
  }
}

/** The caption/slate text a step would show, for degraded fallback. */
function captionOf(step: ResolvedStep): string | null {
  if (step.do === 'voice') return step.caption;
  if (step.do === 'slate') return step.text;
  if (step.do === 'apparition') return step.text ?? null;
  return null;
}

async function safe(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // The degradation path itself must never throw.
  }
}

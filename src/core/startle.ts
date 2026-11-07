/**
 * Startles: short, scarce scares that come back to the programme (requirement
 * 11). Pure, with randomness injected. Scheduling, what counts as room-only, and
 * how long an event holds the picture all live here, so they can be tested and
 * the validator can use the same answers.
 */

import type { EventStepInput, HorrorEventInput } from '../content/schema.ts';

/** The first comes almost at once: the viewer has barely found the picture. */
const FIRST_MS: readonly [number, number] = [6_000, 12_000];
/** Near enough to keep the viewer on edge, uneven enough not to be predictable. */
const LATER_MS: readonly [number, number] = [10_000, 22_000];
const DEMO_FIRST_MS: readonly [number, number] = [4_000, 8_000];
const DEMO_LATER_MS: readonly [number, number] = [6_000, 14_000];

/** Channel-hopping this many times brings a startle forward. */
export const SURF_TRIGGER = 2;
/** A surfer's startle waits this long after landing, so it hits the new picture. */
export const SURF_SETTLE_MS = 700;

/** A surfer cannot bring one on sooner than this after the last: two together spend each other. */
export const SURF_MIN_GAP_MS = 8000;

/** How long until the next startle check. */
export function nextStartleDelay(random: () => number, demo: boolean, first: boolean): number {
  const [low, high] = demo ? (first ? DEMO_FIRST_MS : DEMO_LATER_MS) : first ? FIRST_MS : LATER_MS;
  return low + random() * (high - low);
}

const ROOM_STEPS: ReadonlySet<EventStepInput['do']> = new Set(['sfx', 'roomLights', 'roomGlimpse']);

/** A room-only event plays over the programme and never touches the picture. */
export function isRoomOnly(event: Pick<HorrorEventInput, 'steps'>): boolean {
  return event.steps.every((step) => ROOM_STEPS.has(step.do));
}

/**
 * True if the event can play with the programme still running behind it. A jump
 * covers the window for a moment but leaves the programme alone underneath.
 */
export function keepsProgramme(event: Pick<HorrorEventInput, 'steps'>): boolean {
  return event.steps.every((step) => ROOM_STEPS.has(step.do) || step.do === 'jump');
}

/** Voice lines hold the picture this long (see `speak` in useTelevision). */
const VOICE_HOLD_MS = 1800;

/** How long an event holds up the sequence. A scene has no bound here. */
export function eventLengthMs(event: Pick<HorrorEventInput, 'steps'>): number {
  return event.steps.reduce((sum, step) => {
    switch (step.do) {
      case 'scene':
        return Number.POSITIVE_INFINITY;
      case 'voice':
        return sum + VOICE_HOLD_MS;
      case 'signOff':
        return sum;
      case 'sfx':
        return sum + (step.ms ?? 0);
      default:
        return sum + step.ms;
    }
  }, 0);
}

/** Answers a tear. The first of a session always answers; see `onTearEnd`. */
export const TEAR_ANSWER_CHANCE = 0.6;

/** A startle must be over within this, so the viewer is back before it wears thin. */
export const STARTLE_MAX_MS = 6000;

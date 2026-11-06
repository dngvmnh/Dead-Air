/**
 * Startles: short, scarce scares that come back to the programme (requirement
 * 15). Pure, with randomness injected. Scheduling, what counts as room-only, and
 * how long an event holds the picture all live here, so they can be tested and
 * the validator can use the same answers.
 */

import type { EventStepInput, HorrorEventInput } from '../content/schema.ts';
import { DEMO_DIVISOR } from './memory.ts';

/** The first startle of a session waits this long, so it cannot greet the viewer. */
const FIRST_MS: readonly [number, number] = [45_000, 90_000];
/** Later ones are far enough apart that the viewer stops expecting them. */
const LATER_MS: readonly [number, number] = [60_000, 180_000];

/** How long until the next startle check. */
export function nextStartleDelay(random: () => number, demo: boolean, first: boolean): number {
  const [low, high] = first ? FIRST_MS : LATER_MS;
  const divisor = demo ? DEMO_DIVISOR : 1;
  return (low + random() * (high - low)) / divisor;
}

const ROOM_STEPS: ReadonlySet<EventStepInput['do']> = new Set(['sfx', 'roomLights', 'roomGlimpse']);

/** A room-only event plays over the programme and never touches the picture. */
export function isRoomOnly(event: Pick<HorrorEventInput, 'steps'>): boolean {
  return event.steps.every((step) => ROOM_STEPS.has(step.do));
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

/** A startle must be over within this, so the viewer is back before it wears thin. */
export const STARTLE_MAX_MS = 6000;

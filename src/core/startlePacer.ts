/**
 * When a startle lands (requirement 11.12). A jump that answers what the viewer just
 * did is worse than one that arrives on a timer, so a startle that comes due waits a
 * few seconds for the viewer to click, tune or tear, and lands on that. If they do
 * nothing it comes anyway, so keeping still is no shelter. Between due times an
 * action can now and then set one off by itself.
 *
 * The balance:
 * - Never two within `MIN_GAP_MS`, and never more than `CAP` in any minute.
 * - After two in a row set off by the viewer, the next one ignores them and comes on
 *   the clock, so the viewer cannot learn that sitting still is safe, or that acting
 *   is what brings them.
 * - An action between due times rarely sets one off, and only after a quiet spell.
 *
 * Pure: time and randomness come in. The caller fires the startle and reports back
 * with `fired`, because the director may still refuse one.
 */

import { nextStartleDelay, SURF_MIN_GAP_MS, SURF_SETTLE_MS, SURF_TRIGGER, TEAR_ANSWER_CHANCE } from './startle.ts';

/** What the viewer did. A tune is a channel landing; a tear is one that just finished. */
export type PacerAction = 'press' | 'tune' | 'tear';

export interface PacerState {
  /** When the next one comes due, or null before the first picture. */
  dueAt: number | null;
  /** While due and waiting for the viewer, the time it stops waiting. */
  armedUntil: number | null;
  /** When each recent startle fired, newest last. */
  firedAt: readonly number[];
  /** How many in a row the viewer set off. */
  actionStreak: number;
  /** Channel landings since the last startle. */
  surfs: number;
  /** Tears finished this session. */
  tears: number;
}

export interface PacerContext {
  now: number;
  random: () => number;
  demo: boolean;
}

/** Fire now, or after `delayMs`, or not at all. */
export interface PacerDecision {
  state: PacerState;
  fireInMs: number | null;
}

/** Two closer than this spend each other. */
export const MIN_GAP_MS = SURF_MIN_GAP_MS;
const DEMO_MIN_GAP_MS = 6000;
/** The most in any minute. */
export const CAP = 4;
const DEMO_CAP = 5;
const WINDOW_MS = 60_000;
/** How long a due startle waits for the viewer, at most. */
const ARM_MS: readonly [number, number] = [2500, 5500];
/** After this many set off by the viewer, the next one comes on the clock. */
export const ACTION_STREAK_LIMIT = 2;
/** How likely a press between due times is to set one off, once fully rested. */
const AMBUSH_CHANCE = 0.2;
/** How long after the minimum gap it takes to be fully rested. */
const RESTED_MS = 12_000;
/**
 * A press lands the jump on the click itself. A tune waits for the new picture, and
 * a finished tear gets a breath, so the hand has just left the wall.
 */
const DELAY_MS: Record<PacerAction, number> = {
  press: 60,
  tune: SURF_SETTLE_MS,
  tear: 250,
};

export function initialPacer(): PacerState {
  return {
    dueAt: null,
    armedUntil: null,
    firedAt: [],
    actionStreak: 0,
    surfs: 0,
    tears: 0,
  };
}

function minGap(demo: boolean): number {
  return demo ? DEMO_MIN_GAP_MS : MIN_GAP_MS;
}

/** Whether a startle is allowed at all right now. */
export function pacerAllows(state: PacerState, now: number, demo: boolean): boolean {
  const last = state.firedAt[state.firedAt.length - 1];
  if (last !== undefined && now - last < minGap(demo)) return false;
  const recent = state.firedAt.filter((t) => now - t < WINDOW_MS).length;
  return recent < (demo ? DEMO_CAP : CAP);
}

/** Every half second or so while on air. */
export function pacerTick(state: PacerState, ctx: PacerContext): PacerDecision {
  const { now, random, demo } = ctx;
  if (state.dueAt === null) {
    return {
      state: { ...state, dueAt: now + nextStartleDelay(random, demo, true) },
      fireInMs: null,
    };
  }
  if (now < state.dueAt) return { state, fireInMs: null };
  if (!pacerAllows(state, now, demo)) {
    // Over the limit: let it come due again a little later.
    return {
      state: { ...state, dueAt: now + 2000, armedUntil: null },
      fireInMs: null,
    };
  }
  if (state.armedUntil === null) {
    // The viewer has had their share: this one does not wait for them.
    if (state.actionStreak >= ACTION_STREAK_LIMIT) return { state, fireInMs: 0 };
    const [low, high] = ARM_MS;
    return {
      state: { ...state, armedUntil: now + low + random() * (high - low) },
      fireInMs: null,
    };
  }
  // Waited, and they did nothing.
  if (now >= state.armedUntil) return { state, fireInMs: 0 };
  return { state, fireInMs: null };
}

/** The viewer did something. */
export function pacerAct(state: PacerState, action: PacerAction, ctx: PacerContext): PacerDecision {
  const { now, random, demo } = ctx;
  let next = state;
  let wanted: boolean;
  if (action === 'tune') {
    next = { ...next, surfs: next.surfs + 1 };
    // A surfer is looking for something to happen.
    wanted = next.surfs >= SURF_TRIGGER;
  } else if (action === 'tear') {
    next = { ...next, tears: next.tears + 1 };
    // The first tear of a session always answers: it is the moment the viewer finds
    // out the wall is not just a wall (11.5).
    wanted = next.tears === 1 || random() < TEAR_ANSWER_CHANCE;
  } else {
    const last = state.firedAt[state.firedAt.length - 1] ?? Number.NEGATIVE_INFINITY;
    const rested = Math.min(1, Math.max(0, (now - last - minGap(demo)) / RESTED_MS));
    wanted = random() < AMBUSH_CHANCE * rested;
  }
  // A startle that is due and waiting takes any action.
  const armed = state.armedUntil !== null;
  if (!armed && !wanted) return { state: next, fireInMs: null };
  if (!pacerAllows(next, now, demo)) return { state: next, fireInMs: null };
  // Several in a row from the viewer: leave this one to the clock.
  if (!armed && next.actionStreak >= ACTION_STREAK_LIMIT) return { state: next, fireInMs: null };
  return { state: next, fireInMs: DELAY_MS[action] };
}

/** A startle really fired. `byViewer` if an action set it off. */
export function pacerFired(state: PacerState, ctx: PacerContext, byViewer: boolean): PacerState {
  const { now, random, demo } = ctx;
  return {
    ...state,
    dueAt: now + nextStartleDelay(random, demo, false),
    armedUntil: null,
    firedAt: [...state.firedAt.filter((t) => now - t < WINDOW_MS), now],
    actionStreak: byViewer ? state.actionStreak + 1 : 0,
    surfs: 0,
  };
}

/** The director refused it (a YouTube item, a room event running): try again soon. */
export function pacerRefused(state: PacerState, now: number): PacerState {
  return { ...state, dueAt: now + 1500, armedUntil: null };
}

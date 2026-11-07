/**
 * Viewer memory (design §8, requirement 7 and 8). Pure logic only: the reducer,
 * the act computation and the demo-divisor live here; persistence to
 * localStorage is `persistence/memoryStore.ts`. No DOM, no Date.now,
 * no Math.random — time is always an argument (tech.md core purity).
 *
 * The memory is the single input to escalation: the director and scene `when`
 * variants read it, and the act it yields never decreases except after a reset
 * (requirement 8.1).
 */

import { CHANNEL_CYCLE, type ChannelId } from './types.ts';

export type Act = 0 | 1 | 2 | 3 | 4;

export interface ChannelMemory {
  visits: number;
  watchMs: number;
  lastVisitedAt: number | null;
}

/** One tear, in normalised wall coordinates (requirement 4.1). */
export interface StoredStroke {
  seed: number;
  /** The session it was made in, so a later one can find it mended. */
  session: number;
  points: Array<[number, number]>;
}

export interface RoomMemory {
  strokes: StoredStroke[];
  figureStep: number;
  objectVariant: number;
  ripBackDone: boolean;
}

export interface ViewerMemory {
  schemaVersion: 2;
  firstSeenAt: number;
  lastSeenAt: number;
  sessionCount: number;
  totalWatchMs: number;
  channels: Record<ChannelId, ChannelMemory>;
  /** The 50 most recent channel visits, oldest first. */
  visitOrder: ChannelId[];
  lastChannel: ChannelId | null;
  firedEvents: Record<string, { count: number; lastAt: number }>;
  act: Act;
  noticeSeen: boolean;
  settings: { volume: number; muted: boolean; captions: boolean; reducedEffects: boolean };
  room: RoomMemory;
}

/** What version 1 stored: everything except the room. */
export type ViewerMemoryV1 = Omit<ViewerMemory, 'schemaVersion' | 'room'> & { schemaVersion: 1 };

export const MEMORY_SCHEMA_VERSION = 2 as const;
/** The oldest stroke drops first past this (design §6). */
export const STROKE_CAP = 24;
export const STROKE_POINT_CAP = 32;
export const VISIT_ORDER_LIMIT = 50;
/** A gap longer than this since last activity starts a new session (req 7.5). */
export const NEW_SESSION_GAP_MS = 30 * 60 * 1000;
/**
 * `?demo=1` divides time thresholds and cooldowns by this (requirement 8.2,
 * dead-air-room requirement 9.3). This is the SINGLE source of the demo
 * divisor: the director reads it too, so a demo run is consistent everywhere.
 */
export const DEMO_DIVISOR = 8;

function emptyChannels(): Record<ChannelId, ChannelMemory> {
  const out = {} as Record<ChannelId, ChannelMemory>;
  for (const id of CHANNEL_CYCLE) {
    out[id] = { visits: 0, watchMs: 0, lastVisitedAt: null };
  }
  return out;
}

export function createMemory(nowMs: number): ViewerMemory {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    firstSeenAt: nowMs,
    lastSeenAt: nowMs,
    sessionCount: 1,
    totalWatchMs: 0,
    channels: emptyChannels(),
    visitOrder: [],
    lastChannel: null,
    firedEvents: {},
    act: 0,
    noticeSeen: false,
    // Captions default ON until real recorded voice exists (task 21): event
    // voice lines have no audio yet, so their caption is their only output
    // (requirement 13.3). The viewer can turn CC off.
    settings: { volume: 1, muted: false, captions: true, reducedEffects: false },
    room: emptyRoom(),
  };
}

function emptyRoom(): RoomMemory {
  return { strokes: [], figureStep: 0, objectVariant: 0, ripBackDone: false };
}

/** Version 1 to 2 (requirement 4.3): every field kept, and an empty room added. */
export function migrateMemory(old: ViewerMemoryV1): ViewerMemory {
  return { ...old, schemaVersion: MEMORY_SCHEMA_VERSION, room: emptyRoom() };
}

/** Thin a path to the cap, keeping both ends, and round it so it stores small. */
export function thinPoints(points: ReadonlyArray<readonly [number, number]>, cap = STROKE_POINT_CAP): Array<[number, number]> {
  const clamp = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
  const pick =
    points.length <= cap
      ? points
      : Array.from({ length: cap }, (_, i) => points[Math.round((i * (points.length - 1)) / (cap - 1))]!);
  return pick.map(([x, y]) => [clamp(x), clamp(y)]);
}

/** Which tears are still open, and which someone has mended (requirement 4.2). */
export function splitTears(mem: ViewerMemory): { open: StoredStroke[]; mended: StoredStroke[] } {
  const repairing = mem.sessionCount >= 2 && mem.act >= 2;
  const mended = repairing ? mem.room.strokes.filter((s) => s.session < mem.sessionCount) : [];
  return { open: mem.room.strokes.filter((s) => !mended.includes(s)), mended };
}

// --- Act computation (design §8) -------------------------------------------

function distinctChannels(mem: ViewerMemory): number {
  return CHANNEL_CYCLE.filter((id) => mem.channels[id].visits > 0).length;
}

function anyRevisited(mem: ViewerMemory): boolean {
  return CHANNEL_CYCLE.some((id) => mem.channels[id].visits >= 2);
}

function allFourVisited(mem: ViewerMemory): boolean {
  return CHANNEL_CYCLE.every((id) => mem.channels[id].visits > 0);
}

/**
 * The act implied by the memory right now, before monotonicity. `demo` divides
 * the time thresholds by {@link DEMO_DIVISOR} (requirement 8.2). Act 4 is only
 * ever set by the sign-off completing (design §8), never derived here, so this
 * returns at most 3.
 */
export function naturalAct(mem: ViewerMemory, demo: boolean): Act {
  const d = demo ? DEMO_DIVISOR : 1;
  const min = (minutes: number): number => (minutes * 60 * 1000) / d;

  // Act 3 — Terminal: ≥2 min, all four channels, and E07 fired.
  if (mem.totalWatchMs >= min(2) && allFourVisited(mem) && (mem.firedEvents['E07']?.count ?? 0) > 0) {
    return 3;
  }
  // Act 2 — Aware: ≥1 min and ≥3 distinct channels, OR ≥2 sessions and ≥2 distinct.
  const distinct = distinctChannels(mem);
  if (
    (mem.totalWatchMs >= min(1) && distinct >= 3) ||
    (mem.sessionCount >= 2 && distinct >= 2)
  ) {
    return 2;
  }
  // Act 1 — Unease: ≥20 s total, or a channel revisited.
  if (mem.totalWatchMs >= min(1 / 3) || anyRevisited(mem)) {
    return 1;
  }
  return 0;
}

/**
 * The effective act: the natural act, floored by the act already recorded so it
 * never decreases (requirement 8.1), and pinned to 4 once after-hours is set.
 */
export function effectiveAct(mem: ViewerMemory, demo: boolean): Act {
  if (mem.act === 4) return 4;
  const natural = naturalAct(mem, demo);
  return (natural > mem.act ? natural : mem.act) as Act;
}

// --- Reducer (design §8) ---------------------------------------------------

export type MemoryAction =
  | { type: 'visit'; channel: ChannelId; atMs: number }
  | { type: 'watch'; channel: ChannelId; deltaMs: number }
  | { type: 'eventFired'; eventId: string; atMs: number }
  | { type: 'signOffComplete' }
  | { type: 'touch'; atMs: number }
  | { type: 'setSettings'; settings: Partial<ViewerMemory['settings']> }
  | { type: 'addStroke'; seed: number; points: ReadonlyArray<readonly [number, number]> }
  | { type: 'ackNotice' };

/**
 * Advance memory by one action, recomputing the monotonic act. `demo` only
 * affects the thresholds, never what is stored (requirement 8.2). Pure: returns
 * a new object, never mutates the input.
 */
export function memoryReducer(mem: ViewerMemory, action: MemoryAction, demo: boolean): ViewerMemory {
  const next = applyAction(mem, action);
  return { ...next, act: effectiveAct(next, demo) };
}

function applyAction(mem: ViewerMemory, action: MemoryAction): ViewerMemory {
  switch (action.type) {
    case 'visit': {
      const ch = mem.channels[action.channel];
      const visitOrder = [...mem.visitOrder, action.channel].slice(-VISIT_ORDER_LIMIT);
      return {
        ...mem,
        lastSeenAt: action.atMs,
        lastChannel: action.channel,
        visitOrder,
        channels: {
          ...mem.channels,
          [action.channel]: {
            ...ch,
            visits: ch.visits + 1,
            lastVisitedAt: action.atMs,
          },
        },
      };
    }
    case 'watch': {
      if (action.deltaMs <= 0) return mem;
      const ch = mem.channels[action.channel];
      return {
        ...mem,
        totalWatchMs: mem.totalWatchMs + action.deltaMs,
        channels: {
          ...mem.channels,
          [action.channel]: { ...ch, watchMs: ch.watchMs + action.deltaMs },
        },
      };
    }
    case 'eventFired': {
      const prev = mem.firedEvents[action.eventId];
      return {
        ...mem,
        firedEvents: {
          ...mem.firedEvents,
          [action.eventId]: { count: (prev?.count ?? 0) + 1, lastAt: action.atMs },
        },
      };
    }
    case 'signOffComplete':
      return { ...mem, act: 4 };
    case 'touch':
      return { ...mem, lastSeenAt: action.atMs };
    case 'setSettings':
      return { ...mem, settings: { ...mem.settings, ...action.settings } };
    case 'ackNotice':
      return { ...mem, noticeSeen: true };
    case 'addStroke': {
      if (action.points.length < 2) return mem;
      const stroke: StoredStroke = { seed: action.seed, session: mem.sessionCount, points: thinPoints(action.points) };
      return { ...mem, room: { ...mem.room, strokes: [...mem.room.strokes, stroke].slice(-STROKE_CAP) } };
    }
  }
}

/**
 * Begin a session at `nowMs`: bump `sessionCount` when more than
 * {@link NEW_SESSION_GAP_MS} has elapsed since last activity (requirement 7.5).
 * Always refreshes `lastSeenAt`. A fresh memory (sessionCount 1, lastSeenAt ==
 * firstSeenAt) is left at 1.
 */
export function beginSession(mem: ViewerMemory, nowMs: number, demo: boolean): ViewerMemory {
  const isFresh = mem.sessionCount === 1 && mem.firstSeenAt === mem.lastSeenAt;
  const gap = nowMs - mem.lastSeenAt;
  const bumped = !isFresh && gap > NEW_SESSION_GAP_MS;
  const next: ViewerMemory = {
    ...mem,
    sessionCount: bumped ? mem.sessionCount + 1 : mem.sessionCount,
    lastSeenAt: nowMs,
  };
  return { ...next, act: effectiveAct(next, demo) };
}

/**
 * The demo time divisor applied to a fresh memory's visible act, exposed for
 * the UI to reason about `?demo=1`. (The act itself is computed above.)
 */
export function demoActive(search: string): boolean {
  return new URLSearchParams(search).get('demo') === '1';
}

/**
 * The previous DIFFERENT channel the viewer came from, derived from
 * `visitOrder` (design §9 template variables, requirement 10.1). Distinct from
 * `mem.lastChannel`, which is the channel most recently tuned (and the one to
 * boot on, requirement 1.3). The last entry in `visitOrder` is the current
 * channel; we scan back for the first entry that differs from it. Returns null
 * when the viewer has only ever been on one channel.
 *
 * Example: visiting 04 then 02 leaves `lastChannel = 02` (boot there) but
 * `previousDifferentChannel = 04` ("you came from channel 04"). Rapid surfing
 * that lands on 02 records one visit for 02, so "came from" is the channel
 * before that landing.
 */
export function previousDifferentChannel(mem: ViewerMemory): ChannelId | null {
  const order = mem.visitOrder;
  if (order.length === 0) return null;
  const current = order[order.length - 1];
  for (let i = order.length - 2; i >= 0; i -= 1) {
    const ch = order[i];
    if (ch !== undefined && ch !== current) return ch;
  }
  return null;
}

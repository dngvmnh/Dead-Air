import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  beginSession,
  createMemory,
  DEMO_DIVISOR,
  effectiveAct,
  memoryReducer,
  naturalAct,
  NEW_SESSION_GAP_MS,
  previousDifferentChannel,
  VISIT_ORDER_LIMIT,
  type ViewerMemory, splitTears, STROKE_CAP, STROKE_POINT_CAP, thinPoints, RIP_BACK_SEED } from './memory.ts';
import type { ChannelId } from './types.ts';

const MIN = 60_000;

function withWatch(ms: number): ViewerMemory {
  return { ...createMemory(0), totalWatchMs: ms };
}

function visitAll(mem: ViewerMemory, atMs = 1): ViewerMemory {
  let m = mem;
  for (const ch of [2, 4, 7, 13] as ChannelId[]) m = memoryReducer(m, { type: 'visit', channel: ch, atMs }, false);
  return m;
}

describe('createMemory', () => {
  it('starts empty at act 0, session 1', () => {
    const m = createMemory(1000);
    expect(m.act).toBe(0);
    expect(m.sessionCount).toBe(1);
    expect(m.totalWatchMs).toBe(0);
    expect(m.visitOrder).toEqual([]);
    expect(m.channels[2].visits).toBe(0);
  });
});

describe('previousDifferentChannel (requirement 7/9/10)', () => {
  function visitSeq(...chs: ChannelId[]): ViewerMemory {
    let m = createMemory(0);
    chs.forEach((ch, i) => {
      m = memoryReducer(m, { type: 'visit', channel: ch, atMs: i + 1 }, false);
    });
    return m;
  }

  it('is null when only one channel has ever been visited', () => {
    expect(previousDifferentChannel(visitSeq(2))).toBeNull();
    expect(previousDifferentChannel(createMemory(0))).toBeNull();
  });

  it('is the channel the viewer came from, not the current one', () => {
    // On 02 after coming from 04: lastChannel is 02 (boot there), but the
    // previous different channel is 04.
    const m = visitSeq(4, 2);
    expect(m.lastChannel).toBe(2);
    expect(previousDifferentChannel(m)).toBe(4);
  });

  it('skips repeated visits to the current channel', () => {
    // Surfing 07 -> 13 -> 13 -> 13 lands on 13; came from 07.
    expect(previousDifferentChannel(visitSeq(7, 13, 13, 13))).toBe(7);
  });

  it('tracks the most recent different channel across a longer path', () => {
    expect(previousDifferentChannel(visitSeq(2, 4, 7, 13))).toBe(7);
    expect(previousDifferentChannel(visitSeq(2, 4, 2))).toBe(4);
  });
});

describe('reducer: visit', () => {
  it('increments visits, records lastChannel and visit order', () => {
    let m = createMemory(0);
    m = memoryReducer(m, { type: 'visit', channel: 2, atMs: 10 }, false);
    m = memoryReducer(m, { type: 'visit', channel: 4, atMs: 20 }, false);
    expect(m.channels[2].visits).toBe(1);
    expect(m.lastChannel).toBe(4);
    expect(m.visitOrder).toEqual([2, 4]);
  });

  it('caps visit order at 50 (requirement 7.1)', () => {
    let m = createMemory(0);
    for (let i = 0; i < 60; i += 1) m = memoryReducer(m, { type: 'visit', channel: 2, atMs: i }, false);
    expect(m.visitOrder.length).toBe(VISIT_ORDER_LIMIT);
    expect(m.channels[2].visits).toBe(60);
  });
});

describe('reducer: watch', () => {
  it('accumulates total and per-channel watch time, ignoring non-positive deltas', () => {
    let m = createMemory(0);
    m = memoryReducer(m, { type: 'watch', channel: 2, deltaMs: 1000 }, false);
    m = memoryReducer(m, { type: 'watch', channel: 2, deltaMs: 500 }, false);
    m = memoryReducer(m, { type: 'watch', channel: 2, deltaMs: -100 }, false);
    expect(m.totalWatchMs).toBe(1500);
    expect(m.channels[2].watchMs).toBe(1500);
  });
});

describe('act computation (design §8)', () => {
  it('act 1 at 3 min total, or on a revisit', () => {
    expect(naturalAct(withWatch(3 * MIN), false)).toBe(1);
    let m = createMemory(0);
    m = memoryReducer(m, { type: 'visit', channel: 2, atMs: 1 }, false);
    m = memoryReducer(m, { type: 'visit', channel: 2, atMs: 2 }, false);
    expect(naturalAct(m, false)).toBeGreaterThanOrEqual(1);
  });

  it('act 2 needs 8 min and 3 distinct channels, or 2 sessions and 2 distinct', () => {
    let m = withWatch(8 * MIN);
    m = memoryReducer(m, { type: 'visit', channel: 2, atMs: 1 }, false);
    m = memoryReducer(m, { type: 'visit', channel: 4, atMs: 2 }, false);
    expect(naturalAct(m, false)).toBe(1); // only 2 distinct
    m = memoryReducer(m, { type: 'visit', channel: 7, atMs: 3 }, false);
    expect(naturalAct(m, false)).toBe(2);

    let s = { ...createMemory(0), sessionCount: 2 };
    s = memoryReducer(s, { type: 'visit', channel: 2, atMs: 1 }, false);
    s = memoryReducer(s, { type: 'visit', channel: 4, atMs: 2 }, false);
    expect(naturalAct(s, false)).toBe(2);
  });

  it('act 3 needs 14 min, all four channels, and E07 fired', () => {
    let m = withWatch(14 * MIN);
    m = visitAll(m);
    expect(naturalAct(m, false)).toBe(2); // E07 not fired yet
    m = memoryReducer(m, { type: 'eventFired', eventId: 'E07', atMs: 1 }, false);
    expect(naturalAct(m, false)).toBe(3);
  });

  it('never derives act 4 (only sign-off sets it)', () => {
    let m = withWatch(999 * MIN);
    m = visitAll(m);
    m = memoryReducer(m, { type: 'eventFired', eventId: 'E07', atMs: 1 }, false);
    expect(naturalAct(m, false)).toBe(3);
  });

  it('demo divides time thresholds by DEMO_DIVISOR (requirement 8.2 / room 9.3)', () => {
    // The single constant is 8 (dead-air-room requirement 9.3).
    expect(DEMO_DIVISOR).toBe(8);
    const almost = withWatch(MIN / DEMO_DIVISOR);
    expect(naturalAct(almost, false)).toBe(0);
    expect(naturalAct(almost, true)).toBe(1);
  });
});

describe('act monotonicity (requirement 8.1)', () => {
  it('never decreases as memory changes', () => {
    let m = withWatch(8 * MIN);
    m = visitAll(m);
    m = memoryReducer(m, { type: 'touch', atMs: 1 }, false);
    expect(m.act).toBe(2);
    // A later action that would imply a lower natural act keeps act at 2.
    m = { ...m, totalWatchMs: 0 };
    m = memoryReducer(m, { type: 'touch', atMs: 2 }, false);
    expect(m.act).toBe(2);
  });

  it('sign-off sets act 4 and it stays 4', () => {
    let m = memoryReducer(createMemory(0), { type: 'signOffComplete' }, false);
    expect(m.act).toBe(4);
    m = memoryReducer(m, { type: 'watch', channel: 2, deltaMs: 1000 }, false);
    expect(effectiveAct(m, false)).toBe(4);
  });

  it('property: effectiveAct is >= the stored act for any single action', () => {
    const actions = fc.oneof(
      fc.record({ type: fc.constant('watch' as const), channel: fc.constantFrom(2, 4, 7, 13), deltaMs: fc.integer({ min: 0, max: 60_000 }) }),
      fc.record({ type: fc.constant('visit' as const), channel: fc.constantFrom(2, 4, 7, 13), atMs: fc.integer({ min: 0, max: 10_000 }) }),
      fc.record({ type: fc.constant('touch' as const), atMs: fc.integer({ min: 0, max: 10_000 }) }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), actions, (startAct, action) => {
        const base: ViewerMemory = { ...createMemory(0), act: startAct as ViewerMemory['act'] };
        const next = memoryReducer(base, action as never, false);
        expect(next.act).toBeGreaterThanOrEqual(base.act);
      }),
    );
  });
});

describe('beginSession (requirement 7.5)', () => {
  it('leaves a fresh memory at session 1', () => {
    const m = beginSession(createMemory(1000), 1000 + NEW_SESSION_GAP_MS + 1, false);
    expect(m.sessionCount).toBe(1);
  });

  it('bumps the session count after a gap longer than 30 minutes', () => {
    // Make it non-fresh first (lastSeenAt != firstSeenAt).
    let m = memoryReducer(createMemory(0), { type: 'touch', atMs: 1000 }, false);
    m = beginSession(m, 1000 + NEW_SESSION_GAP_MS + 1, false);
    expect(m.sessionCount).toBe(2);
  });

  it('does not bump within the gap', () => {
    let m = memoryReducer(createMemory(0), { type: 'touch', atMs: 1000 }, false);
    m = beginSession(m, 1000 + 60_000, false);
    expect(m.sessionCount).toBe(1);
  });
});

describe('tear memory (requirement 4)', () => {
  const line = [[0.1, 0.1], [0.2, 0.2]] as const;

  it('stores a stroke with its session, and ignores a click with no path', () => {
    let m = createMemory(1);
    m = memoryReducer(m, { type: 'addStroke', seed: 4, points: [[0.1, 0.1]] }, false);
    expect(m.room.strokes).toHaveLength(0);
    m = memoryReducer({ ...m, sessionCount: 3 }, { type: 'addStroke', seed: 4, points: line }, false);
    expect(m.room.strokes[0]).toEqual({ seed: 4, session: 3, points: [[0.1, 0.1], [0.2, 0.2]] });
  });

  it('drops the oldest stroke at the cap', () => {
    let m = createMemory(1);
    for (let seed = 0; seed < STROKE_CAP + 3; seed += 1) m = memoryReducer(m, { type: 'addStroke', seed, points: line }, false);
    expect(m.room.strokes).toHaveLength(STROKE_CAP);
    expect(m.room.strokes[0]?.seed).toBe(3);
  });

  it('thins a long path to the cap, keeping both ends, and clamps it into range', () => {
    const long = Array.from({ length: 200 }, (_, i) => [i / 199, 1.5] as const);
    const thin = thinPoints(long);
    expect(thin).toHaveLength(STROKE_POINT_CAP);
    expect(thin[0]).toEqual([0, 1]);
    expect(thin.at(-1)).toEqual([1, 1]);
  });

  it('mends only earlier tears, and only in a later session from Act 2', () => {
    const base = createMemory(1);
    const strokes = [{ seed: 1, session: 1, points: [[0, 0], [1, 1]] as Array<[number, number]> }, { seed: 2, session: 2, points: [[0, 0], [1, 1]] as Array<[number, number]> }];
    const room = { ...base.room, strokes };
    const ids = (m: ViewerMemory) => {
      const { open, mended } = splitTears(m);
      return [open.map((s) => s.seed), mended.map((s) => s.seed)];
    };
    expect(ids({ ...base, room, sessionCount: 2, act: 2 })).toEqual([[2], [1]]);
    expect(ids({ ...base, room, sessionCount: 2, act: 1 })).toEqual([[1, 2], []]);
    expect(ids({ ...base, room, sessionCount: 1, act: 3 })).toEqual([[1, 2], []]);
  });
});

describe('it rips back (requirement 6)', () => {
  const path = [[0.1, 0.1], [0.1, 0.9]] as const;

  it('records the tear once', () => {
    let m = memoryReducer(createMemory(1), { type: 'ripBack', points: path }, false);
    m = memoryReducer(m, { type: 'ripBack', points: path }, false);
    expect(m.room.ripBackDone).toBe(true);
    expect(m.room.strokes).toHaveLength(1);
    expect(m.room.strokes[0]?.seed).toBe(RIP_BACK_SEED);
  });

  it('is never mended, and never falls out at the cap', () => {
    let m = memoryReducer(createMemory(1), { type: 'ripBack', points: path }, false);
    for (let seed = 0; seed < STROKE_CAP + 5; seed += 1) m = memoryReducer(m, { type: 'addStroke', seed, points: path }, false);
    expect(m.room.strokes).toHaveLength(STROKE_CAP);
    expect(m.room.strokes.some((s) => s.seed === RIP_BACK_SEED)).toBe(true);
    const { open, mended } = splitTears({ ...m, sessionCount: 2, act: 3 });
    expect(open.map((s) => s.seed)).toEqual([RIP_BACK_SEED]);
    expect(mended).toHaveLength(STROKE_CAP - 1);
  });
});

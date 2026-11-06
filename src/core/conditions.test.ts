import { describe, expect, it } from 'vitest';
import { evaluateCondition, type ConditionContext } from './conditions.ts';
import { createMemory, memoryReducer, type ViewerMemory } from './memory.ts';
import type { ConditionInput } from '../content/schema.ts';
import type { ChannelId } from './types.ts';

const ctx: ConditionContext = { channel: 2, localHour: 12 };

function mem(build: (m: ViewerMemory) => ViewerMemory): ViewerMemory {
  return build(createMemory(0));
}

function visit(m: ViewerMemory, ch: ChannelId, n = 1): ViewerMemory {
  let out = m;
  for (let i = 0; i < n; i += 1) out = memoryReducer(out, { type: 'visit', channel: ch, atMs: i }, false);
  return out;
}

describe('evaluateCondition', () => {
  it('visitsGte with an explicit channel', () => {
    const m = visit(createMemory(0), 4, 2);
    expect(evaluateCondition({ visitsGte: { channel: 4, n: 2 } }, m, ctx)).toBe(true);
    expect(evaluateCondition({ visitsGte: { channel: 4, n: 3 } }, m, ctx)).toBe(false);
  });

  it('visitsGte with "current" resolves to the context channel', () => {
    const m = visit(createMemory(0), 2, 3);
    expect(evaluateCondition({ visitsGte: { channel: 'current', n: 3 } }, m, ctx)).toBe(true);
  });

  it('distinctChannelsGte counts visited channels', () => {
    let m = visit(createMemory(0), 2);
    m = visit(m, 4);
    expect(evaluateCondition({ distinctChannelsGte: 2 }, m, ctx)).toBe(true);
    expect(evaluateCondition({ distinctChannelsGte: 3 }, m, ctx)).toBe(false);
  });

  it('watchMsGte, lastChannelIs, eventFired, sessionCountGte', () => {
    let m = mem((x) => ({ ...x, totalWatchMs: 5000, sessionCount: 2 }));
    m = visit(m, 7);
    m = memoryReducer(m, { type: 'eventFired', eventId: 'E05', atMs: 1 }, false);
    expect(evaluateCondition({ watchMsGte: 5000 }, m, ctx)).toBe(true);
    expect(evaluateCondition({ lastChannelIs: 7 }, m, ctx)).toBe(true);
    expect(evaluateCondition({ lastChannelIs: 2 }, m, ctx)).toBe(false);
    expect(evaluateCondition({ eventFired: 'E05' }, m, ctx)).toBe(true);
    expect(evaluateCondition({ eventFired: 'E99' }, m, ctx)).toBe(false);
    expect(evaluateCondition({ sessionCountGte: 2 }, m, ctx)).toBe(true);
  });

  it('localHourBetween handles a window that wraps midnight', () => {
    const m = createMemory(0);
    expect(evaluateCondition({ localHourBetween: [0, 4] }, m, { channel: 2, localHour: 2 })).toBe(true);
    expect(evaluateCondition({ localHourBetween: [0, 4] }, m, { channel: 2, localHour: 5 })).toBe(false);
    // 22..4 wraps: 23 and 1 inside, 12 outside.
    expect(evaluateCondition({ localHourBetween: [22, 4] }, m, { channel: 2, localHour: 23 })).toBe(true);
    expect(evaluateCondition({ localHourBetween: [22, 4] }, m, { channel: 2, localHour: 1 })).toBe(true);
    expect(evaluateCondition({ localHourBetween: [22, 4] }, m, { channel: 2, localHour: 12 })).toBe(false);
  });

  it('all / any / not compose', () => {
    let m = visit(createMemory(0), 2, 2);
    m = mem(() => ({ ...m, totalWatchMs: 10_000 }));
    const cond: ConditionInput = {
      all: [{ visitsGte: { channel: 'current', n: 2 } }, { not: { watchMsGte: 999_999 } }],
    };
    expect(evaluateCondition(cond, m, ctx)).toBe(true);
    expect(evaluateCondition({ any: [{ watchMsGte: 999_999 }, { lastChannelIs: 2 }] }, m, ctx)).toBe(true);
  });
});

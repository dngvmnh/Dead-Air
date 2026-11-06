import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decideEvent, GLOBAL_GAP_MS, type DecideInput } from './director.ts';
import { createMemory, memoryReducer, type ViewerMemory } from './memory.ts';
import type { HorrorEventInput } from '../content/schema.ts';
import type { Item, Seam } from './types.ts';

function ev(over: Partial<HorrorEventInput> = {}): HorrorEventInput {
  return {
    id: 'E',
    minAct: 0,
    channels: 'any',
    seams: ['tune-in'],
    when: { distinctChannelsGte: 0 },
    limit: {},
    priority: 0,
    steps: [{ do: 'silence', ms: 100 }],
    ...over,
  };
}

function baseInput(over: Partial<DecideInput> = {}): DecideInput {
  return {
    memory: createMemory(0),
    channel: 2,
    seam: 'tune-in',
    currentSource: null,
    nowMs: 1_000_000,
    localHour: 12,
    lastEventAt: null,
    sessionFired: {},
    events: [],
    random: () => 0,
    ...over,
  };
}

describe('decideEvent filtering', () => {
  it('returns null when no event matches the channel or seam', () => {
    expect(decideEvent(baseInput({ events: [ev({ channels: [13] })] }))).toBeNull();
    expect(decideEvent(baseInput({ events: [ev({ seams: ['item-boundary'] })] }))).toBeNull();
  });

  it('respects the act window', () => {
    const e = ev({ id: 'A2', minAct: 2 });
    expect(decideEvent(baseInput({ events: [e] }))?.id).toBeUndefined(); // act 0
    const m = { ...createMemory(0), act: 2 } as ViewerMemory;
    expect(decideEvent(baseInput({ events: [e], memory: m }))?.id).toBe('A2');
  });

  it('enforces perViewer and perSession limits', () => {
    const m = memoryReducer(createMemory(0), { type: 'eventFired', eventId: 'V', atMs: 1 }, false);
    const perViewer = ev({ id: 'V', limit: { perViewer: 1 } });
    expect(decideEvent(baseInput({ events: [perViewer], memory: m }))).toBeNull();

    const perSession = ev({ id: 'S', limit: { perSession: 2 } });
    expect(
      decideEvent(baseInput({ events: [perSession], sessionFired: { S: 2 } })),
    ).toBeNull();
    expect(
      decideEvent(baseInput({ events: [perSession], sessionFired: { S: 1 } }))?.id,
    ).toBe('S');
  });

  it('enforces the condition', () => {
    const e = ev({ when: { visitsGte: { channel: 2, n: 3 } } });
    expect(decideEvent(baseInput({ events: [e] }))).toBeNull();
    let m = createMemory(0);
    for (let i = 0; i < 3; i += 1) m = memoryReducer(m, { type: 'visit', channel: 2, atMs: i }, false);
    expect(decideEvent(baseInput({ events: [e], memory: m }))?.id).toBe('E');
  });

  it('breaks priority ties deterministically with the seeded random', () => {
    const a = ev({ id: 'A', priority: 5 });
    const b = ev({ id: 'B', priority: 5 });
    const pick0 = decideEvent(baseInput({ events: [a, b], random: () => 0 }));
    const pick09 = decideEvent(baseInput({ events: [a, b], random: () => 0.9 }));
    expect(pick0?.id).toBe('A');
    expect(pick09?.id).toBe('B');
    // Higher priority always beats the tie-break.
    const hi = ev({ id: 'HI', priority: 9 });
    expect(decideEvent(baseInput({ events: [a, b, hi], random: () => 0.9 }))?.id).toBe('HI');
  });
});

describe('decideEvent: no event at mid-item on YouTube (requirement 9.3)', () => {
  it('rejects a mid-item event when the current source is youtube', () => {
    const e = ev({ seams: ['mid-item'] });
    const input = baseInput({ events: [e], seam: 'mid-item', currentSource: 'youtube' });
    expect(decideEvent(input)).toBeNull();
    // Same event fires on a scene source.
    expect(decideEvent({ ...input, currentSource: 'scene' })?.id).toBe('E');
  });

  it('property: NEVER selects a mid-item event while YouTube is playing', () => {
    const arbEvent = fc.record({
      id: fc.string({ minLength: 1, maxLength: 4 }),
      priority: fc.integer({ min: 0, max: 9 }),
      chain: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 6 }), fc.double({ min: 0, max: 1, noNaN: true }), (specs, r) => {
        const events = specs.map((s) =>
          ev({ id: s.id, priority: s.priority, chain: s.chain, seams: ['mid-item'] }),
        );
        const picked = decideEvent(
          baseInput({ events, seam: 'mid-item', currentSource: 'youtube', random: () => r }),
        );
        expect(picked).toBeNull();
      }),
    );
  });
});

describe('decideEvent: global 90s gap (requirement 9.7)', () => {
  it('blocks a non-chain event within the gap and allows it after', () => {
    const e = ev();
    const justFired = baseInput({ events: [e], lastEventAt: 1_000_000 - 1000, nowMs: 1_000_000 });
    expect(decideEvent(justFired)).toBeNull();
    const after = baseInput({ events: [e], lastEventAt: 1_000_000 - GLOBAL_GAP_MS, nowMs: 1_000_000 });
    expect(decideEvent(after)?.id).toBe('E');
  });

  it('a chain event bypasses the gap', () => {
    const chain = ev({ id: 'C', chain: true });
    const input = baseInput({ events: [chain], lastEventAt: 1_000_000 - 1, nowMs: 1_000_000 });
    expect(decideEvent(input)?.id).toBe('C');
  });

  it('property: a non-chain event never fires inside the gap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: GLOBAL_GAP_MS - 1 }), (sinceLast) => {
        const now = 2_000_000;
        const picked = decideEvent(
          baseInput({ events: [ev()], lastEventAt: now - sinceLast, nowMs: now }),
        );
        expect(picked).toBeNull();
      }),
    );
  });

  it('demo shortens the gap by six', () => {
    const now = 2_000_000;
    // 20s since last: blocked normally, allowed in demo (gap/6 = 15s).
    const input = baseInput({ events: [ev()], lastEventAt: now - 20_000, nowMs: now });
    expect(decideEvent(input)).toBeNull();
    expect(decideEvent({ ...input, demo: true })?.id).toBe('E');
  });
});

// Keep the Item/Seam imports meaningful to the type-checker.
const _types: { s: Seam; src: Item['source'] } = { s: 'tune-in', src: 'scene' };
void _types;

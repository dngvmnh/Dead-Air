import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveBroadcast } from './clock.ts';
import type { Channel, ChannelId, Item } from './types.ts';

// --- Fixtures --------------------------------------------------------------

const sceneItem = (id: string, durationMs: number): Item => ({
  id,
  title: id,
  kind: 'programme',
  durationMs,
  rights: { basis: 'original' },
  source: 'scene',
  sceneId: `${id}-scene`,
  look: 'broadcast',
});

const channel = (rundown: Item[], epochMs = 0, id: ChannelId = 2): Channel => ({
  id,
  name: 'test',
  epochMs,
  stationCard: 'cards/x.png',
  rundown,
});

const alwaysPlayable = (): boolean => true;

// --- Example-based --------------------------------------------------------

describe('resolveBroadcast examples', () => {
  const c = channel([sceneItem('a', 1000), sceneItem('b', 2000), sceneItem('c', 3000)]); // total 6000

  it('returns null when nothing is playable', () => {
    expect(resolveBroadcast(channel([]), 0, alwaysPlayable)).toBeNull();
    expect(resolveBroadcast(c, 0, () => false)).toBeNull();
  });

  it('resolves the first item at the epoch', () => {
    const r = resolveBroadcast(c, 0, alwaysPlayable);
    expect(r).toEqual({ item: c.rundown[0], index: 0, offsetMs: 0, remainingMs: 1000 });
  });

  it('resolves mid-first-item', () => {
    const r = resolveBroadcast(c, 400, alwaysPlayable);
    expect(r?.item.id).toBe('a');
    expect(r?.offsetMs).toBe(400);
    expect(r?.remainingMs).toBe(600);
  });

  it('crosses into the second item exactly at the boundary', () => {
    const r = resolveBroadcast(c, 1000, alwaysPlayable);
    expect(r?.item.id).toBe('b');
    expect(r?.index).toBe(1);
    expect(r?.offsetMs).toBe(0);
    expect(r?.remainingMs).toBe(2000);
  });

  it('resolves the last item near the end of the period', () => {
    const r = resolveBroadcast(c, 5999, alwaysPlayable);
    expect(r?.item.id).toBe('c');
    expect(r?.offsetMs).toBe(2999);
    expect(r?.remainingMs).toBe(1);
  });

  it('wraps at the period: nowMs=total is the start again', () => {
    expect(resolveBroadcast(c, 6000, alwaysPlayable)).toEqual(
      resolveBroadcast(c, 0, alwaysPlayable),
    );
  });

  it('handles times before the epoch with a floored modulo', () => {
    // epoch 10_000; one tick before it is the last moment of the loop.
    const cc = channel([sceneItem('a', 1000), sceneItem('b', 2000)], 10_000); // total 3000
    const r = resolveBroadcast(cc, 9999, alwaysPlayable);
    expect(r?.item.id).toBe('b');
    expect(r?.offsetMs).toBe(1999);
  });

  it('respects a shifting epoch (channels do not change in step)', () => {
    const a = channel([sceneItem('a', 1000), sceneItem('b', 1000)], 0);
    const b = channel([sceneItem('a', 1000), sceneItem('b', 1000)], 500);
    // At t=0 a is at offset 0 of item a; b (epoch 500) is 500ms "behind".
    expect(resolveBroadcast(a, 0, alwaysPlayable)?.offsetMs).toBe(0);
    expect(resolveBroadcast(b, 0, alwaysPlayable)?.item.id).toBe('b');
  });

  it('drops dead items and resolves over the remainder', () => {
    const isPlayable = (item: Item): boolean => item.id !== 'b';
    // playable = [a(1000), c(3000)], total 4000. At t=1500 we are 500ms into c.
    const r = resolveBroadcast(c, 1500, isPlayable);
    expect(r?.item.id).toBe('c');
    expect(r?.index).toBe(1); // index into the FILTERED rundown
    expect(r?.offsetMs).toBe(500);
  });
});

// --- Property-based (design §5) -------------------------------------------

const arbItem = (): fc.Arbitrary<Item> =>
  fc
    .tuple(fc.string({ minLength: 1, maxLength: 6 }), fc.integer({ min: 1, max: 600_000 }))
    .map(([id, durationMs]): Item => sceneItem(id, durationMs));

const arbChannel = (): fc.Arbitrary<Channel> =>
  fc
    .tuple(fc.array(arbItem(), { minLength: 1, maxLength: 8 }), fc.integer({ min: -1_000_000, max: 1_000_000 }))
    .map(([rundown, epochMs]) => channel(rundown, epochMs));

// Give each item a unique id so dead-item tests behave; ids collide harmlessly
// here because resolve does not key on id, but keep durations positive (enforced
// by the generator).

const arbNow = (): fc.Arbitrary<number> => fc.integer({ min: -5_000_000, max: 5_000_000 });

describe('resolveBroadcast properties (design §5)', () => {
  it('always returns an offset within the item: 0 <= offsetMs < durationMs', () => {
    fc.assert(
      fc.property(arbChannel(), arbNow(), (c, now) => {
        const r = resolveBroadcast(c, now, alwaysPlayable);
        expect(r).not.toBeNull();
        if (!r) return;
        expect(r.offsetMs).toBeGreaterThanOrEqual(0);
        expect(r.offsetMs).toBeLessThan(r.item.durationMs);
        expect(r.remainingMs).toBe(r.item.durationMs - r.offsetMs);
        expect(r.remainingMs).toBeGreaterThan(0);
        expect(r.remainingMs).toBeLessThanOrEqual(r.item.durationMs);
      }),
    );
  });

  it('offsets advance one-for-one with nowMs within an item', () => {
    fc.assert(
      fc.property(arbChannel(), arbNow(), fc.integer({ min: 1, max: 1000 }), (c, now, dt) => {
        const r0 = resolveBroadcast(c, now, alwaysPlayable);
        const r1 = resolveBroadcast(c, now + dt, alwaysPlayable);
        if (!r0 || !r1) return;
        // Same item and the step stays inside it => offset advanced by exactly dt.
        if (r0.index === r1.index && r0.offsetMs + dt < r0.item.durationMs) {
          expect(r1.offsetMs).toBe(r0.offsetMs + dt);
        }
      }),
    );
  });

  it('item boundaries are continuous: the instant one ends, the next starts at 0', () => {
    fc.assert(
      fc.property(arbChannel(), arbNow(), (c, now) => {
        const r = resolveBroadcast(c, now, alwaysPlayable);
        if (!r) return;
        // At the exact end of the current item, the next resolve starts at 0.
        const atEnd = resolveBroadcast(c, now + r.remainingMs, alwaysPlayable);
        expect(atEnd?.offsetMs).toBe(0);
      }),
    );
  });

  it('is periodic: resolve(now) equals resolve(now + total)', () => {
    fc.assert(
      fc.property(arbChannel(), arbNow(), (c, now) => {
        const total = c.rundown.reduce((s, i) => s + i.durationMs, 0);
        expect(resolveBroadcast(c, now, alwaysPlayable)).toEqual(
          resolveBroadcast(c, now + total, alwaysPlayable),
        );
      }),
    );
  });

  it('is deterministic: two resolves of the same inputs agree (requirement 3.4)', () => {
    fc.assert(
      fc.property(arbChannel(), arbNow(), (c, now) => {
        expect(resolveBroadcast(c, now, alwaysPlayable)).toEqual(
          resolveBroadcast(c, now, alwaysPlayable),
        );
      }),
    );
  });

  it('returns null exactly when no item is playable', () => {
    fc.assert(
      fc.property(arbChannel(), arbNow(), fc.boolean(), (c, now, playable) => {
        const r = resolveBroadcast(c, now, () => playable);
        if (playable) expect(r).not.toBeNull();
        else expect(r).toBeNull();
      }),
    );
  });
});

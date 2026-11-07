import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryStore, MEMORY_KEY, PERSIST_THROTTLE_MS, resetRequested, type StorageLike } from './memoryStore.ts';
import { createMemory } from '../core/memory.ts';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  throwOnSet = false;
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.throwOnSet) throw new Error('quota');
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('MemoryStore', () => {
  let storage: FakeStorage;
  let nowMs: number;
  const now = () => nowMs;

  beforeEach(() => {
    storage = new FakeStorage();
    nowMs = 1_000_000;
  });

  it('loads a fresh memory when nothing is stored', () => {
    const store = new MemoryStore({ storage, now });
    const m = store.load();
    expect(m.schemaVersion).toBe(2);
    expect(m.totalWatchMs).toBe(0);
  });

  it('round-trips a saved memory', () => {
    const store = new MemoryStore({ storage, now });
    const m = { ...createMemory(now()), totalWatchMs: 4242 };
    expect(store.save(m)).toBe(true);
    const loaded = new MemoryStore({ storage, now }).load();
    expect(loaded.totalWatchMs).toBe(4242);
  });

  it('starts fresh on corrupt JSON (requirement 7.4)', () => {
    storage.map.set(MEMORY_KEY, '{not json');
    const m = new MemoryStore({ storage, now }).load();
    expect(m.totalWatchMs).toBe(0);
  });

  it('starts fresh on a schema mismatch / wrong version', () => {
    storage.map.set(MEMORY_KEY, JSON.stringify({ schemaVersion: 2, foo: 1 }));
    const m = new MemoryStore({ storage, now }).load();
    expect(m.schemaVersion).toBe(2);
    expect(m.totalWatchMs).toBe(0);
  });

  it('migrates version 1 to version 2 without losing a field (requirement 4.3)', () => {
    const current = { ...createMemory(now()), totalWatchMs: 77, act: 2 as const, firedEvents: { E01: { count: 2, lastAt: 9 } }, lastChannel: 7 as const };
    const { room, ...rest } = current;
    expect(room.strokes).toEqual([]);
    storage.map.set(MEMORY_KEY, JSON.stringify({ ...rest, schemaVersion: 1 }));
    const loaded = new MemoryStore({ storage, now }).load();
    expect(loaded).toEqual({ ...rest, schemaVersion: 2, room: { strokes: [], figureStep: 0, objectVariant: 0, ripBackDone: false } });
  });

  it('round-trips strokes', () => {
    const store = new MemoryStore({ storage, now });
    const stroke = { seed: 3, session: 1, points: [[0.1, 0.2], [0.3, 0.4]] as Array<[number, number]> };
    const m = createMemory(now());
    store.save({ ...m, room: { ...m.room, strokes: [stroke] } });
    expect(new MemoryStore({ storage, now }).load().room.strokes).toEqual([stroke]);
  });

  it('starts fresh when a stored stroke is out of range', () => {
    const m = createMemory(now());
    storage.map.set(MEMORY_KEY, JSON.stringify({ ...m, totalWatchMs: 9, room: { ...m.room, strokes: [{ seed: 1, session: 1, points: [[5, 0], [0, 0]] }] } }));
    expect(new MemoryStore({ storage, now }).load().totalWatchMs).toBe(0);
  });

  it('throttles writes to once per 5s and flush bypasses it', () => {
    const store = new MemoryStore({ storage, now });
    const a = { ...createMemory(now()), totalWatchMs: 1 };
    expect(store.save(a)).toBe(true); // first write
    const b = { ...a, totalWatchMs: 2 };
    expect(store.save(b)).toBe(false); // throttled
    // The throttled value is pending; a flush writes the latest immediately.
    expect(store.flush()).toBe(true);
    expect(new MemoryStore({ storage, now }).load().totalWatchMs).toBe(2);
    // After the throttle window a normal save writes again.
    nowMs += PERSIST_THROTTLE_MS;
    const c = { ...a, totalWatchMs: 3 };
    expect(store.save(c)).toBe(true);
    expect(new MemoryStore({ storage, now }).load().totalWatchMs).toBe(3);
  });

  it('erase removes the stored key (requirement 7.6)', () => {
    const store = new MemoryStore({ storage, now });
    store.save({ ...createMemory(now()), totalWatchMs: 5 });
    store.erase();
    expect(storage.getItem(MEMORY_KEY)).toBeNull();
    expect(store.load().totalWatchMs).toBe(0);
  });

  it('never throws when storage is unavailable', () => {
    const store = new MemoryStore({ storage: null, now });
    expect(() => store.save(createMemory(now()))).not.toThrow();
    expect(store.load().schemaVersion).toBe(2);
    expect(() => store.erase()).not.toThrow();
  });

  it('survives a storage that throws on write (quota)', () => {
    storage.throwOnSet = true;
    const store = new MemoryStore({ storage, now });
    expect(store.save(createMemory(now()))).toBe(false);
  });
});

describe('resetRequested (requirement 7.6)', () => {
  it('is true only for ?reset=1', () => {
    expect(resetRequested('?reset=1')).toBe(true);
    expect(resetRequested('?reset=0')).toBe(false);
    expect(resetRequested('')).toBe(false);
    expect(resetRequested('?demo=1')).toBe(false);
  });
});

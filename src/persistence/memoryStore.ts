/**
 * Versioned localStorage for viewer memory (requirement 7.3–7.6, design §8).
 *
 * Everything is wrapped in try/catch and falls back to in-memory state so a
 * blocked or full storage never crashes the TV (requirement 7.4). Reads go
 * through the Zod schema; a corrupt or wrong-version value is discarded and a
 * fresh memory is started. Writes are throttled to at most once every 5s, with
 * an immediate flush when the document is hidden (requirement 7.3). Memory is
 * never transmitted anywhere (requirement 7.7) — this is the only persistence.
 */

import { viewerMemorySchema } from '../content/schema.ts';
import { createMemory, type ViewerMemory } from '../core/memory.ts';

export const MEMORY_KEY = 'deadair.memory.v1';
export const PERSIST_THROTTLE_MS = 5000;

/** Minimal storage surface so the store is testable without a real DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MemoryStoreDeps {
  storage?: StorageLike | null;
  now?: () => number;
}

function resolveStorage(explicit: StorageLike | null | undefined): StorageLike | null {
  if (explicit !== undefined) return explicit;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export class MemoryStore {
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private lastWriteAt = -Infinity;
  private pending: ViewerMemory | null = null;

  constructor(deps: MemoryStoreDeps = {}) {
    this.storage = resolveStorage(deps.storage);
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Load the persisted memory, or a fresh one. A missing, corrupt, or
   * wrong-version value yields a fresh memory (requirement 7.4). Never throws.
   */
  load(): ViewerMemory {
    const fallback = (): ViewerMemory => createMemory(this.now());
    if (!this.storage) return fallback();
    let raw: string | null;
    try {
      raw = this.storage.getItem(MEMORY_KEY);
    } catch {
      return fallback();
    }
    if (raw === null) return fallback();
    try {
      const parsed = viewerMemorySchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return fallback();
      // The schema is structurally the core ViewerMemory; the literal/union
      // fields line up, so this is a safe widening.
      return parsed.data as ViewerMemory;
    } catch {
      return fallback();
    }
  }

  /**
   * Persist `memory`, throttled to once per {@link PERSIST_THROTTLE_MS}. A
   * throttled write is remembered as `pending` so a later `flush()` (e.g. on
   * visibilitychange) writes the latest. Returns whether it wrote now.
   */
  save(memory: ViewerMemory): boolean {
    const t = this.now();
    if (t - this.lastWriteAt < PERSIST_THROTTLE_MS) {
      this.pending = memory;
      return false;
    }
    return this.write(memory);
  }

  /** Force-write the latest memory immediately, bypassing the throttle. */
  flush(memory?: ViewerMemory): boolean {
    const toWrite = memory ?? this.pending;
    if (!toWrite) return false;
    return this.write(toWrite);
  }

  /** Erase all persisted memory (requirement 7.6: `?reset=1` and Forget me). */
  erase(): void {
    this.pending = null;
    this.lastWriteAt = -Infinity;
    if (!this.storage) return;
    try {
      this.storage.removeItem(MEMORY_KEY);
    } catch {
      // Storage unavailable; nothing persisted to clear.
    }
  }

  private write(memory: ViewerMemory): boolean {
    this.pending = null;
    this.lastWriteAt = this.now();
    if (!this.storage) return false;
    try {
      this.storage.setItem(MEMORY_KEY, JSON.stringify(memory));
      return true;
    } catch {
      // Quota or blocked storage: keep running from in-memory state.
      return false;
    }
  }
}

/** True when the URL asks for a memory wipe (`?reset=1`, requirement 7.6). */
export function resetRequested(search: string): boolean {
  try {
    return new URLSearchParams(search).get('reset') === '1';
  } catch {
    return false;
  }
}

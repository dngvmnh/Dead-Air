/**
 * The broadcast clock (design §5, requirement 3). A pure function mapping a
 * channel and wall-clock time to the item on screen and the offset into it, so
 * channels appear to run continuously with no backend and no stored "current
 * position" (tech.md architecture rules). Two tabs resolving the same channel
 * at the same `nowMs` get the same answer (requirement 3.4).
 *
 * No `Date.now`, no `Math.random`: time is an argument (tech.md).
 */

import type { Channel, Item, Resolved } from './types.ts';

/**
 * Floored modulo, so times before the channel epoch still land inside the
 * rundown (design §5). `a % n` in JS keeps the sign of `a`; we want the
 * non-negative representative in `[0, n)`.
 */
function floorMod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Resolve what is playing on `channel` at `nowMs`.
 *
 * Filters the rundown with `isPlayable` (dropping YouTube items marked dead for
 * the session, etc. — requirement 3.4); returns `null` if nothing is playable.
 * `position = floorMod(nowMs - epochMs, total)` indexes into the concatenated,
 * looping rundown; a linear scan over cumulative durations finds the item.
 *
 * Guarantees (covered by the property tests, design §5):
 * - `0 <= offsetMs < item.durationMs`
 * - offsets advance one-for-one with `nowMs` inside an item
 * - item boundaries are continuous (one ends at the instant the next starts)
 * - `resolve(now)` and `resolve(now + total)` agree (loops with no seam)
 */
export function resolveBroadcast(
  channel: Channel,
  nowMs: number,
  isPlayable: (item: Item) => boolean,
): Resolved | null {
  const playable = channel.rundown.filter(isPlayable);
  if (playable.length === 0) return null;

  const total = playable.reduce((sum, item) => sum + item.durationMs, 0);
  // Durations are validated positive (requirement 14.1), so total > 0.
  const position = floorMod(nowMs - channel.epochMs, total);

  let acc = 0;
  for (let index = 0; index < playable.length; index += 1) {
    const item = playable[index];
    if (item === undefined) break; // unreachable; satisfies noUncheckedIndexedAccess
    const next = acc + item.durationMs;
    if (position < next) {
      const offsetMs = position - acc;
      return { item, index, offsetMs, remainingMs: item.durationMs - offsetMs };
    }
    acc = next;
  }

  // `position < total` always, so the loop returns; this is defensive only.
  const last = playable[playable.length - 1];
  if (last === undefined) return null;
  return { item: last, index: playable.length - 1, offsetMs: 0, remainingMs: last.durationMs };
}

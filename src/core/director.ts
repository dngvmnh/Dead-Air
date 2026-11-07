/**
 * The horror director (design §9, requirement 9). A pure function of memory,
 * context, event definitions, time and a seeded random: at a seam it selects at
 * most one eligible event. No DOM, no Date.now, no Math.random — randomness is
 * the injected `random()` and time is `nowMs`.
 *
 * Selection order (design §9): filter by channel, seam, act, condition, limit,
 * cooldown, and the global gap; reject `mid-item` when the current source is
 * YouTube (requirement 9.3); choose the highest priority; break ties with
 * `random`. Sign-off is high priority and, like any `chain` event, bypasses the
 * global gap.
 */

import type { HorrorEventInput } from '../content/schema.ts';
import { evaluateCondition } from './conditions.ts';
import { isRoomOnly } from './startle.ts';
import { DEMO_DIVISOR, effectiveAct, type ViewerMemory } from './memory.ts';
import type { ChannelId, Item, Seam } from './types.ts';

/** The global minimum gap between events (requirement 9.7), `chain` exempt. */
export const GLOBAL_GAP_MS = 20_000;

export interface DecideInput {
  memory: ViewerMemory;
  channel: ChannelId;
  seam: Seam;
  /** The source currently on screen, or null (nothing playing). */
  currentSource: Item['source'] | null;
  nowMs: number;
  localHour: number;
  /** When the last event fired (any event), or null if none this session. */
  lastEventAt: number | null;
  /** How many times each event fired THIS session (for `limit.perSession`). */
  sessionFired: Record<string, number>;
  events: HorrorEventInput[];
  /** Injected randomness in [0,1); the director is deterministic for a seed. */
  random: () => number;
  /** `?demo=1` shortens cooldowns and the global gap (requirement 8.2). */
  demo?: boolean;
}

function channelMatches(ev: HorrorEventInput, channel: ChannelId): boolean {
  return ev.channels === 'any' || ev.channels.includes(channel);
}

function actInRange(ev: HorrorEventInput, act: number): boolean {
  if (act < ev.minAct) return false;
  if (ev.maxAct !== undefined && act > ev.maxAct) return false;
  return true;
}

function withinLimits(
  ev: HorrorEventInput,
  mem: ViewerMemory,
  sessionFired: Record<string, number>,
): boolean {
  if (ev.limit.perViewer !== undefined) {
    if ((mem.firedEvents[ev.id]?.count ?? 0) >= ev.limit.perViewer) return false;
  }
  if (ev.limit.perSession !== undefined) {
    if ((sessionFired[ev.id] ?? 0) >= ev.limit.perSession) return false;
  }
  return true;
}

function cooldownOk(ev: HorrorEventInput, mem: ViewerMemory, nowMs: number, divisor: number): boolean {
  if (ev.cooldownMs === undefined) return true;
  const lastAt = mem.firedEvents[ev.id]?.lastAt;
  if (lastAt === undefined) return true;
  return nowMs - lastAt >= ev.cooldownMs / divisor;
}

/**
 * Select the event to fire at this seam, or null. Pure and deterministic for a
 * given `random`.
 */
export function decideEvent(input: DecideInput): HorrorEventInput | null {
  const { memory, channel, seam, currentSource, nowMs, lastEventAt, sessionFired, events } = input;
  // Single demo divisor from core/memory (dead-air-room req 9.3): cooldowns and
  // the global gap shrink by the same factor as the act time thresholds.
  const divisor = input.demo ? DEMO_DIVISOR : 1;
  const act = effectiveAct(memory, input.demo ?? false);

  const gapElapsed = lastEventAt === null || nowMs - lastEventAt >= GLOBAL_GAP_MS / divisor;

  const eligible = events.filter((ev) => {
    if (!channelMatches(ev, channel)) return false;
    if (!ev.seams.includes(seam)) return false;
    if (!actInRange(ev, act)) return false;
    // Never fire at mid-item on a YouTube item (requirement 9.3 / design §2).
    if ((seam === 'mid-item' || seam === 'startle') && currentSource === 'youtube') return false;
    // A tear may answer over YouTube only by staying in the room.
    if (seam === 'tear' && currentSource === 'youtube' && !isRoomOnly(ev)) return false;
    if (!withinLimits(ev, memory, sessionFired)) return false;
    if (!cooldownOk(ev, memory, nowMs, divisor)) return false;
    // The global gap applies unless the event is a chain link.
    if (!ev.chain && !gapElapsed) return false;
    if (!evaluateCondition(ev.when, memory, { channel, localHour: input.localHour })) return false;
    return true;
  });

  if (eligible.length === 0) return null;

  // Highest priority wins; ties are broken by the seeded random so a seed is
  // reproducible (requirement 9.1).
  const maxPriority = Math.max(...eligible.map((e) => e.priority));
  const top = eligible.filter((e) => e.priority === maxPriority);
  if (top.length === 1) return top[0] ?? null;
  const idx = Math.floor(input.random() * top.length) % top.length;
  return top[idx] ?? null;
}

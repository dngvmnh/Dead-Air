/**
 * Evaluates an event's `Condition` tree against viewer memory and the current
 * context (design §9, requirement 9.1/9.2). Pure data in, boolean out — no DOM,
 * no Date.now, no Math.random. The director uses this to decide eligibility.
 */

import type { ConditionInput } from '../content/schema.ts';
import { previousDifferentChannel, type ViewerMemory } from './memory.ts';
import type { ChannelId } from './types.ts';

export interface ConditionContext {
  /** The channel being evaluated (resolves `visitsGte` with `channel: 'current'`). */
  channel: ChannelId;
  /** Local hour 0..23, for `localHourBetween`. */
  localHour: number;
}

function distinctChannels(mem: ViewerMemory): number {
  return (Object.keys(mem.channels) as unknown as ChannelId[]).filter(
    (id) => mem.channels[id as ChannelId]?.visits > 0,
  ).length;
}

/** True when `hour` falls in the wrapping window `[from, to)` (e.g. 22–4). */
function hourInRange(hour: number, from: number, to: number): boolean {
  if (from === to) return true; // full-day window
  if (from < to) return hour >= from && hour < to;
  // Wraps midnight: e.g. [22, 4) is 22,23,0,1,2,3.
  return hour >= from || hour < to;
}

export function evaluateCondition(
  cond: ConditionInput,
  mem: ViewerMemory,
  ctx: ConditionContext,
): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, mem, ctx));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, mem, ctx));
  if ('not' in cond) return !evaluateCondition(cond.not, mem, ctx);
  if ('visitsGte' in cond) {
    const channel = cond.visitsGte.channel === 'current' ? ctx.channel : cond.visitsGte.channel;
    return (mem.channels[channel]?.visits ?? 0) >= cond.visitsGte.n;
  }
  if ('distinctChannelsGte' in cond) return distinctChannels(mem) >= cond.distinctChannelsGte;
  if ('watchMsGte' in cond) return mem.totalWatchMs >= cond.watchMsGte;
  // "last channel" means the previous DIFFERENT channel the viewer came from
  // (requirement 7.1/9/10): visits are recorded on tune-complete, so on channel
  // 04 after 13 the current entry is 04 and the one before it is 13. Using
  // mem.lastChannel (the current channel) would never let E09 fire.
  if ('lastChannelIs' in cond) return previousDifferentChannel(mem) === cond.lastChannelIs;
  if ('eventFired' in cond) return (mem.firedEvents[cond.eventFired]?.count ?? 0) > 0;
  if ('sessionCountGte' in cond) return mem.sessionCount >= cond.sessionCountGte;
  if ('localHourBetween' in cond) {
    const [from, to] = cond.localHourBetween;
    return hourInRange(ctx.localHour, from, to);
  }
  return false;
}

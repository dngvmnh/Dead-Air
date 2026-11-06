/**
 * Fills event template variables from REAL viewer memory only (design §9,
 * requirement 9.5). A variable with no real value leaves the text to its
 * fallback — the engine never invents a value. Pure: memory + context in,
 * string out.
 *
 * Supported variables (design §9):
 *   {lastChannel} {lastChannelName} {visitedList} {mostWatchedChannel}
 *   {totalMinutes} {visitCountCurrent} {localTime}
 */

import { CHANNEL_INFO } from './channels.ts';
import type { ViewerMemory } from './memory.ts';
import { CHANNEL_CYCLE, type ChannelId } from './types.ts';

export interface TemplateContext {
  channel: ChannelId;
  /** Local hour 0..23 and minute 0..59, for {localTime}. */
  localHour: number;
  localMinute: number;
}

/** The variable names a template may reference. */
const VAR = /\{(\w+)\}/g;

function label(id: ChannelId): string {
  return CHANNEL_INFO[id].label;
}

function mostWatched(mem: ViewerMemory): ChannelId | null {
  let best: ChannelId | null = null;
  let bestMs = 0;
  for (const id of CHANNEL_CYCLE) {
    const ms = mem.channels[id]?.watchMs ?? 0;
    if (ms > bestMs) {
      bestMs = ms;
      best = id;
    }
  }
  return best;
}

/**
 * Resolve a single variable to a real value, or `null` when memory has none
 * (the caller then uses the fallback text). `null` is deliberately distinct
 * from an empty string so "no value" is unambiguous.
 */
function resolveVar(name: string, mem: ViewerMemory, ctx: TemplateContext): string | null {
  switch (name) {
    case 'lastChannel':
      return mem.lastChannel === null ? null : label(mem.lastChannel);
    case 'lastChannelName':
      return mem.lastChannel === null ? null : CHANNEL_INFO[mem.lastChannel].name;
    case 'visitedList': {
      const visited = CHANNEL_CYCLE.filter((id) => (mem.channels[id]?.visits ?? 0) > 0);
      return visited.length === 0 ? null : visited.map(label).join(', ');
    }
    case 'mostWatchedChannel': {
      const id = mostWatched(mem);
      return id === null ? null : label(id);
    }
    case 'totalMinutes': {
      const minutes = Math.floor(mem.totalWatchMs / 60000);
      return minutes <= 0 ? null : String(minutes);
    }
    case 'visitCountCurrent': {
      const n = mem.channels[ctx.channel]?.visits ?? 0;
      return n <= 0 ? null : String(n);
    }
    case 'localTime': {
      const hh = String(ctx.localHour).padStart(2, '0');
      const mm = String(ctx.localMinute).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    default:
      return null;
  }
}

/**
 * Fill `text`. Returns `{ text, missing }`: `missing` lists any variable that
 * had no real value, so the caller can choose the fallback line (requirement
 * 9.5). When nothing is missing, the filled text is complete.
 */
export function fillTemplate(
  text: string,
  mem: ViewerMemory,
  ctx: TemplateContext,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const filled = text.replace(VAR, (whole, name: string) => {
    const value = resolveVar(name, mem, ctx);
    if (value === null) {
      missing.push(name);
      return whole; // leave the placeholder; the caller swaps to the fallback
    }
    return value;
  });
  return { text: filled, missing };
}

/**
 * Choose the line to show: the filled `text` when every variable resolved, or
 * the `fallback` (itself filled) when any were missing (requirement 9.5). When
 * there is no fallback, the primary is returned with placeholders left in — the
 * caller should prefer providing a fallback.
 */
export function renderLine(
  primary: string,
  fallback: string | undefined,
  mem: ViewerMemory,
  ctx: TemplateContext,
): string {
  const filled = fillTemplate(primary, mem, ctx);
  if (filled.missing.length === 0) return filled.text;
  if (fallback !== undefined) return fillTemplate(fallback, mem, ctx).text;
  return filled.text;
}

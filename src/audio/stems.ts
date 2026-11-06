/**
 * Voice stem stitching (requirement 12.4, design §9/§11). A spoken channel
 * number or minute count is assembled from prerecorded stems ("channel",
 * "two", … ) rather than one clip per phrase. Pure planning only: given the
 * stems a line needs and the set of stems actually available, it returns the
 * ordered urls to play, or signals that a stem is missing so the caller shows
 * captions alone (requirement 12.4). No audio, no DOM here.
 */

/** The stems the media bible records: numbers, "channel", and minute counts. */
export type StemId = string;

export interface StemPlan {
  /** Ordered stem urls to play back to back. */
  urls: string[];
  /** True when every requested stem resolved; false ⇒ show captions alone. */
  complete: boolean;
  /** Stems that had no url (for diagnostics / the caller's fallback choice). */
  missing: StemId[];
}

/**
 * Resolve `stems` against the `available` map (stem id → url). Missing stems
 * make the plan incomplete; the caller then presents captions alone
 * (requirement 12.4) rather than a half-spoken line.
 */
export function planStems(stems: readonly StemId[], available: Readonly<Record<StemId, string>>): StemPlan {
  const urls: string[] = [];
  const missing: StemId[] = [];
  for (const id of stems) {
    const url = available[id];
    if (url === undefined) missing.push(id);
    else urls.push(url);
  }
  return { urls, complete: missing.length === 0, missing };
}

/** The spoken channel-number stems for a channel, e.g. 2 → ["channel","two"]. */
export function channelNumberStems(channel: 2 | 4 | 7 | 13): StemId[] {
  const word: Record<2 | 4 | 7 | 13, string> = { 2: 'two', 4: 'four', 7: 'seven', 13: 'thirteen' };
  return ['channel', word[channel]];
}

/** The spoken minute-count stems for 1..30 (media bible §7). */
export function minuteStems(minutes: number): StemId[] {
  const n = Math.max(1, Math.min(30, Math.floor(minutes)));
  return [`min-${n}`];
}

/**
 * Core domain types. Pure data only — no React, no DOM (see tech.md).
 * These mirror the data model in design.md §4.
 */

export type ChannelId = 2 | 4 | 7 | 13;
export type Look = 'broadcast' | 'vhs' | 'deadair';

export const CHANNEL_CYCLE: readonly ChannelId[] = [2, 4, 7, 13] as const;

export interface Rights {
  basis: 'original' | 'ai-generated' | 'public-domain' | 'cc' | 'permission' | 'youtube-embed';
  /** URL or tool name. */
  source?: string;
  licence?: string;
  attribution?: string;
  /** Evidence for public-domain claims. */
  note?: string;
}

interface ItemBase {
  id: string;
  title: string;
  kind: 'programme' | 'interstitial';
  /** Authoritative for the broadcast clock. */
  durationMs: number;
  rights: Rights;
  /** Rejected by `validate:catalog --release`. */
  placeholder?: boolean;
}

export interface SceneItem extends ItemBase {
  source: 'scene';
  sceneId: string;
  look: Look;
}

export interface FileItem extends ItemBase {
  source: 'file';
  url: string;
  look: Look;
  captionsUrl?: string;
}

export interface YouTubeItem extends ItemBase {
  source: 'youtube';
  videoId: string;
  startSeconds?: number;
  endSeconds?: number;
}

export type Item = SceneItem | FileItem | YouTubeItem;

export interface Channel {
  id: ChannelId;
  name: string;
  /** Fixed per channel so channels don't change in step. */
  epochMs: number;
  /** Image used by ch13 flash and fallback. */
  stationCard: string;
  rundown: Item[];
}

export type Seam = 'tune-in' | 'item-boundary' | 'mid-item';

/** The broadcast clock's answer: what is on, where in it, and how long is left. */
export interface Resolved {
  item: Item;
  /** Index into the *filtered* (playable) rundown. */
  index: number;
  /** Offset into the current item, `0 <= offsetMs < item.durationMs`. */
  offsetMs: number;
  /** Time until the current item ends, `0 < remainingMs <= item.durationMs`. */
  remainingMs: number;
}

/**
 * Static channel identity used by the chassis and announcements.
 * Pure data; the full Channel (with rundown) lives in the catalogue.
 */

import { type ChannelId } from './types.ts';

export interface ChannelInfo {
  id: ChannelId;
  /** Two-digit label shown on the LED, e.g. "02". */
  label: string;
  name: string;
}

export const CHANNEL_INFO: Readonly<Record<ChannelId, ChannelInfo>> = {
  2: { id: 2, label: '02', name: 'KDA Nightly News' },
  4: { id: 4, label: '04', name: 'Pumpkin Hour' },
  7: { id: 7, label: '07', name: 'Midnight Shopping Network' },
  13: { id: 13, label: '13', name: 'Dead Air' },
};

export function channelInfo(id: ChannelId): ChannelInfo {
  const info = CHANNEL_INFO[id];
  if (info === undefined) {
    throw new Error(`Unknown channel id: ${String(id)}`);
  }
  return info;
}

/** Two-digit LED label for a channel, or a blank display when off. */
export function channelLabel(id: ChannelId | null): string {
  if (id === null) return '--';
  const info = CHANNEL_INFO[id];
  return info === undefined ? '--' : info.label;
}

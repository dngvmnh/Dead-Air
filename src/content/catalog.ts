/**
 * Loads the authored catalogue (channels and scene programmes) and exposes
 * typed lookups for the orchestrator. JSON is imported at build time and
 * validated through the Zod schemas, so malformed content fails loudly at
 * startup rather than mid-broadcast (requirement 14, design §4). The channel is
 * converted to the core `Channel` shape via the schema bridge.
 *
 * Only channel 02 is authored in Milestone 2; channels 04/07/13 arrive in
 * Milestone 3. A channel with no catalogue entry simply has no playable items,
 * which the TV shows as a stand-by slate.
 */

import {
  channelSchema,
  horrorEventSchema,
  sceneProgramSchema,
  toChannel,
  type HorrorEventInput,
  type SceneProgramInput,
} from './schema.ts';
import type { Channel, ChannelId } from '../core/types.ts';

// Eagerly import every catalogue and scene JSON file. Vite resolves these at
// build time; the shapes are validated below.
const channelModules = import.meta.glob('./catalog/*.json', { eager: true, import: 'default' });
const sceneModules = import.meta.glob('./scenes/*.json', { eager: true, import: 'default' });
const eventModules = import.meta.glob('./events/*.json', { eager: true, import: 'default' });

function buildChannels(): Map<ChannelId, Channel> {
  const map = new Map<ChannelId, Channel>();
  for (const [path, raw] of Object.entries(channelModules)) {
    const parsed = channelSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid channel catalogue ${path}: ${parsed.error.message}`);
    }
    map.set(parsed.data.id, toChannel(parsed.data));
  }
  return map;
}

function buildScenes(): Map<string, SceneProgramInput> {
  const map = new Map<string, SceneProgramInput>();
  for (const [path, raw] of Object.entries(sceneModules)) {
    const parsed = sceneProgramSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid scene programme ${path}: ${parsed.error.message}`);
    }
    map.set(parsed.data.id, parsed.data);
  }
  return map;
}

function buildEvents(): HorrorEventInput[] {
  const out: HorrorEventInput[] = [];
  for (const [path, raw] of Object.entries(eventModules)) {
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && 'events' in raw
        ? (raw as { events: unknown[] }).events
        : [raw];
    for (const item of list) {
      const parsed = horrorEventSchema.safeParse(item);
      if (!parsed.success) throw new Error(`Invalid event in ${path}: ${parsed.error.message}`);
      out.push(parsed.data);
    }
  }
  return out;
}

const CHANNELS = buildChannels();
const SCENES = buildScenes();
const EVENTS = buildEvents();

export function getChannel(id: ChannelId): Channel | undefined {
  return CHANNELS.get(id);
}

export function getScene(sceneId: string): SceneProgramInput | undefined {
  return SCENES.get(sceneId);
}

/** All authored channel ids, for diagnostics and tests. */
export function authoredChannelIds(): ChannelId[] {
  return [...CHANNELS.keys()];
}

/** The authored horror events (design §9). */
export function getEvents(): HorrorEventInput[] {
  return EVENTS;
}

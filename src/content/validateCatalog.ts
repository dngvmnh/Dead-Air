/**
 * Pure catalogue validator (requirement 14, plus requirement 4 under
 * `--release`). This is the logic behind `scripts/validate-catalog.ts`; the
 * script only reads the JSON files off disk and hands them here, so every rule
 * is testable with in-memory fixtures and no filesystem (design §13: "each
 * failing rule").
 *
 * The validator takes already-parsed JSON (the raw authored objects) rather
 * than core types, because catching *malformed* content is rule 14.1's job: we
 * run the Zod schemas here and turn their issues into errors, then apply the
 * cross-cutting rules (unique ids, references resolve, rights, the YouTube
 * mid-item rule, channel 13's media basis) on the validated data.
 */

import {
  channelSchema,
  horrorEventSchema,
  sceneProgramSchema,
  type ChannelInput,
  type HorrorEventInput,
  type ItemInput,
  type SceneProgramInput,
} from './schema.ts';

/** Requirement 4 depth thresholds, checked only under `--release`. */
export const MIN_CHANNEL_MS = 30 * 60 * 1000; // 30 minutes (req 4.1)
export const MIN_INTERSTITIALS = 4; // req 4.2
export const INTERSTITIAL_CHANNELS: readonly number[] = [2, 4, 7]; // req 4.2

export interface CatalogIssue {
  /** The requirement sub-rule this violates, e.g. "14.1". */
  rule: string;
  /** Where the problem is (channel id, item id, event id, scene id). */
  where: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: CatalogIssue[];
}

/**
 * The authored content, already parsed from JSON. The validator does not read
 * the filesystem; the CLI gathers these and the set of local asset paths that
 * actually exist under `public/`.
 */
export interface CatalogInput {
  /** `src/content/catalog/ch*.json`. */
  channels: unknown[];
  /** `src/content/events/events.json` (flattened to the event array). */
  events: unknown[];
  /** `src/content/scenes/*` scene programmes. */
  scenes: unknown[];
  /**
   * Local asset references that exist, as they are written in the catalogue
   * (e.g. `cards/ch02.png`, `news/room.png`). A `file`/`scene`/layer reference
   * to an asset not in this set fails rule 14.1. Omit to skip asset-reference
   * checking (used by tests that only exercise other rules).
   */
  localAssets?: Set<string>;
}

export interface ValidateOptions {
  release?: boolean;
}

function zodErrors(
  issues: { path: PropertyKey[]; message: string }[],
  rule: string,
  where: string,
): CatalogIssue[] {
  return issues.map((i) => ({
    rule,
    where: i.path.length ? `${where} @ ${i.path.join('.')}` : where,
    message: i.message,
  }));
}

/** True for any reference that points outside the local asset set. */
function isLocalRef(ref: string): boolean {
  // Remote (object storage / absolute) and data URLs are not "local assets".
  return !/^(https?:)?\/\//i.test(ref) && !ref.startsWith('data:');
}

export function validateCatalog(
  input: CatalogInput,
  options: ValidateOptions = {},
): ValidationResult {
  const errors: CatalogIssue[] = [];
  const release = options.release ?? false;

  // --- Parse channels (rule 14.1: schema validity) ------------------------
  const channels: ChannelInput[] = [];
  input.channels.forEach((raw, idx) => {
    const parsed = channelSchema.safeParse(raw);
    const where =
      raw && typeof raw === 'object' && 'id' in raw ? `channel ${(raw as { id: unknown }).id}` : `channel[${idx}]`;
    if (parsed.success) channels.push(parsed.data);
    else errors.push(...zodErrors(parsed.error.issues, '14.1', where));
  });

  // --- Parse scenes (rule 14.1) -------------------------------------------
  const scenes: SceneProgramInput[] = [];
  input.scenes.forEach((raw, idx) => {
    const parsed = sceneProgramSchema.safeParse(raw);
    const where =
      raw && typeof raw === 'object' && 'id' in raw ? `scene ${(raw as { id: unknown }).id}` : `scene[${idx}]`;
    if (parsed.success) scenes.push(parsed.data);
    else errors.push(...zodErrors(parsed.error.issues, '14.1', where));
  });

  // --- Parse events (rule 14.1) -------------------------------------------
  const events: HorrorEventInput[] = [];
  input.events.forEach((raw, idx) => {
    const parsed = horrorEventSchema.safeParse(raw);
    const where =
      raw && typeof raw === 'object' && 'id' in raw ? `event ${(raw as { id: unknown }).id}` : `event[${idx}]`;
    if (parsed.success) events.push(parsed.data);
    else errors.push(...zodErrors(parsed.error.issues, '14.1', where));
  });

  const sceneIds = new Set(scenes.map((s) => s.id));
  const eventIds = new Set(events.map((e) => e.id));
  const allItems: { channelId: number; item: ItemInput }[] = channels.flatMap((c) =>
    c.rundown.map((item) => ({ channelId: c.id, item })),
  );

  // --- Rule 14.1: unique item ids (across all channels) -------------------
  const seenItemIds = new Map<string, number>();
  for (const { item } of allItems) {
    const count = (seenItemIds.get(item.id) ?? 0) + 1;
    seenItemIds.set(item.id, count);
    if (count === 2) {
      errors.push({ rule: '14.1', where: `item ${item.id}`, message: 'duplicate item id' });
    }
  }
  // --- Rule 14.1: unique scene ids and unique event ids -------------------
  {
    const seen = new Set<string>();
    for (const s of scenes) {
      if (seen.has(s.id)) errors.push({ rule: '14.1', where: `scene ${s.id}`, message: 'duplicate scene id' });
      seen.add(s.id);
    }
  }
  {
    const seen = new Set<string>();
    for (const e of events) {
      if (seen.has(e.id)) errors.push({ rule: '14.1', where: `event ${e.id}`, message: 'duplicate event id' });
      seen.add(e.id);
    }
  }

  // --- Rule 14.1: durations > 0 -------------------------------------------
  // (The schema already enforces positive integers; this is a defensive
  // double-check so the rule is asserted here even if the schema changes.)
  for (const { item } of allItems) {
    if (!(item.durationMs > 0)) {
      errors.push({ rule: '14.1', where: `item ${item.id}`, message: 'durationMs must be greater than zero' });
    }
  }

  // --- Rule 14.1: references to scenes, events, and local assets resolve ---
  for (const { channelId, item } of allItems) {
    if (item.source === 'scene' && !sceneIds.has(item.sceneId)) {
      errors.push({
        rule: '14.1',
        where: `item ${item.id}`,
        message: `references unknown scene "${item.sceneId}"`,
      });
    }
    if (item.source === 'file' && input.localAssets && isLocalRef(item.url) && !input.localAssets.has(item.url)) {
      errors.push({ rule: '14.1', where: `item ${item.id}`, message: `references missing local asset "${item.url}"` });
    }
    if (item.source === 'file' && item.captionsUrl && input.localAssets && isLocalRef(item.captionsUrl) && !input.localAssets.has(item.captionsUrl)) {
      errors.push({
        rule: '14.1',
        where: `item ${item.id}`,
        message: `references missing captions asset "${item.captionsUrl}"`,
      });
    }
    void channelId;
  }
  // Channel station cards are local assets too.
  for (const c of channels) {
    if (input.localAssets && isLocalRef(c.stationCard) && !input.localAssets.has(c.stationCard)) {
      errors.push({ rule: '14.1', where: `channel ${c.id}`, message: `stationCard asset "${c.stationCard}" is missing` });
    }
  }
  // Scene layers reference image assets; scene steps in events reference scenes.
  for (const s of scenes) {
    for (const layer of s.layers) {
      if (layer.type === 'image' && input.localAssets && isLocalRef(layer.src) && !input.localAssets.has(layer.src)) {
        errors.push({ rule: '14.1', where: `scene ${s.id}`, message: `layer "${layer.id}" references missing asset "${layer.src}"` });
      }
    }
    for (const cue of s.audio ?? []) {
      if (input.localAssets && isLocalRef(cue.url) && !input.localAssets.has(cue.url)) {
        errors.push({ rule: '14.1', where: `scene ${s.id}`, message: `audio cue references missing asset "${cue.url}"` });
      }
    }
  }
  for (const e of events) {
    for (const step of e.steps) {
      if (step.do === 'scene' && !sceneIds.has(step.sceneId)) {
        errors.push({ rule: '14.1', where: `event ${e.id}`, message: `step references unknown scene "${step.sceneId}"` });
      }
      if (step.do === 'voice' && step.url && input.localAssets && isLocalRef(step.url) && !input.localAssets.has(step.url)) {
        errors.push({ rule: '14.1', where: `event ${e.id}`, message: `voice step references missing asset "${step.url}"` });
      }
    }
  }
  void eventIds;

  // --- Rule 14.2: every item has a rights record --------------------------
  // (The schema requires it; this restates the rule explicitly so a schema
  // relaxation would still be caught by the validator's own test.)
  for (const { item } of allItems) {
    if (!item.rights || typeof item.rights.basis !== 'string') {
      errors.push({ rule: '14.2', where: `item ${item.id}`, message: 'missing rights record' });
    }
  }

  // --- Rule 14.3: no mid-item event on a YouTube item ---------------------
  // An event that can fire at `mid-item` must not be eligible on a channel
  // whose rundown contains a YouTube item, because mid-item on YouTube is the
  // forbidden overlay path (design §2 / requirement 6). "any" channels count.
  const youTubeChannelIds = new Set(
    allItems.filter(({ item }) => item.source === 'youtube').map(({ channelId }) => channelId),
  );
  const anyChannelHasYouTube = youTubeChannelIds.size > 0;
  for (const e of events) {
    if (!e.seams.includes('mid-item')) continue;
    const firesOnYouTubeChannel =
      e.channels === 'any' ? anyChannelHasYouTube : e.channels.some((id) => youTubeChannelIds.has(id));
    if (firesOnYouTubeChannel) {
      errors.push({
        rule: '14.3',
        where: `event ${e.id}`,
        message: 'can fire at mid-item on a channel carrying a YouTube item',
      });
    }
  }

  // --- Rule 14.4: channel 13 is original or ai-generated only -------------
  const ch13 = channels.find((c) => c.id === 13);
  if (ch13) {
    for (const item of ch13.rundown) {
      if (item.rights.basis !== 'original' && item.rights.basis !== 'ai-generated') {
        errors.push({
          rule: '14.4',
          where: `item ${item.id}`,
          message: `channel 13 allows only original or ai-generated media (got "${item.rights.basis}")`,
        });
      }
      if (item.source === 'youtube') {
        errors.push({ rule: '14.4', where: `item ${item.id}`, message: 'channel 13 must not carry YouTube items' });
      }
    }
  }

  // --- Rule 14.5 (--release only): no placeholders, plus depth (req 4) ----
  if (release) {
    for (const { item } of allItems) {
      if (item.placeholder) {
        errors.push({ rule: '14.5', where: `item ${item.id}`, message: 'placeholder item is not allowed in a release build' });
      }
    }
    for (const c of channels) {
      const totalMs = c.rundown.reduce((sum, item) => sum + item.durationMs, 0);
      if (totalMs < MIN_CHANNEL_MS) {
        errors.push({
          rule: '4.1',
          where: `channel ${c.id}`,
          message: `rundown totals ${Math.round(totalMs / 1000)}s; release requires at least ${MIN_CHANNEL_MS / 1000}s`,
        });
      }
      if (INTERSTITIAL_CHANNELS.includes(c.id)) {
        const interstitials = c.rundown.filter((item) => item.kind === 'interstitial').length;
        if (interstitials < MIN_INTERSTITIALS) {
          errors.push({
            rule: '4.2',
            where: `channel ${c.id}`,
            message: `has ${interstitials} interstitials; release requires at least ${MIN_INTERSTITIALS}`,
          });
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

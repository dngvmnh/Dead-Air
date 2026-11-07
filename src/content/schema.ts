/**
 * Zod schemas for the catalogue and scene content (design.md §4 and §6,
 * requirement 14). These validate authored JSON at build time via
 * `scripts/validate-catalog.ts` and at load time, so malformed content can
 * never reach the broadcast clock.
 *
 * The inferred types are kept structurally compatible with the hand-written
 * domain types in `src/core/types.ts` (a compile-time assertion in the tests
 * guards against drift). Zod lives here in `content`, not in `core`, so core
 * stays dependency-free and pure.
 */

import { z } from 'zod';
import type { Channel, Item, Rights } from '../core/types.ts';

// --- Primitives ------------------------------------------------------------

export const channelIdSchema = z.union([
  z.literal(2),
  z.literal(4),
  z.literal(7),
  z.literal(13),
]);

export const lookSchema = z.enum(['broadcast', 'vhs', 'deadair']);

export const rightsBasisSchema = z.enum([
  'original',
  'ai-generated',
  'public-domain',
  'cc',
  'permission',
  'youtube-embed',
]);

/**
 * Every catalogue item must carry a rights record (requirement 14.2). Optional
 * evidence fields back public-domain/cc claims (safety-and-rights.md).
 */
export const rightsSchema = z
  .object({
    basis: rightsBasisSchema,
    source: z.string().optional(),
    licence: z.string().optional(),
    attribution: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();

// --- Items -----------------------------------------------------------------

const itemBase = {
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(['programme', 'interstitial']),
  // Authoritative for the broadcast clock: must be a positive duration
  // (requirement 14.1).
  durationMs: z.number().int().positive(),
  rights: rightsSchema,
  placeholder: z.boolean().optional(),
};

export const sceneItemSchema = z
  .object({
    ...itemBase,
    source: z.literal('scene'),
    sceneId: z.string().min(1),
    look: lookSchema,
  })
  .strict();

export const fileItemSchema = z
  .object({
    ...itemBase,
    source: z.literal('file'),
    url: z.string().min(1),
    look: lookSchema,
    captionsUrl: z.string().optional(),
  })
  .strict();

export const youTubeItemSchema = z
  .object({
    ...itemBase,
    source: z.literal('youtube'),
    videoId: z.string().min(1),
    startSeconds: z.number().nonnegative().optional(),
    endSeconds: z.number().nonnegative().optional(),
  })
  .strict();

export const itemSchema = z.discriminatedUnion('source', [
  sceneItemSchema,
  fileItemSchema,
  youTubeItemSchema,
]);

// --- Channel ---------------------------------------------------------------

export const channelSchema = z
  .object({
    id: channelIdSchema,
    name: z.string().min(1),
    // Fixed per channel so channels don't change in step.
    epochMs: z.number().int(),
    stationCard: z.string().min(1),
    rundown: z.array(itemSchema).min(1),
  })
  .strict();

// --- Scenes (design §6) ----------------------------------------------------

/** Any layer may declare when it is visible (visit/act variants). */
export const layerWhenSchema = z
  .object({
    minVisits: z.number().int().nonnegative().optional(),
    maxVisits: z.number().int().nonnegative().optional(),
    minAct: z.number().int().min(0).max(4).optional(),
    maxAct: z.number().int().min(0).max(4).optional(),
  })
  .strict();

/** A single keyframe for a layer property at a time offset. */
export const keyframeSchema = z
  .object({
    atMs: z.number().int().nonnegative(),
    // Free-form per-layer values (position, opacity, text, etc.). Kept loose
    // here; each layer renderer reads the fields it understands.
    x: z.number().optional(),
    y: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    scale: z.number().positive().optional(),
    text: z.string().optional(),
  })
  .strict();

const layerBase = {
  id: z.string().min(1),
  when: layerWhenSchema.optional(),
  keyframes: z.array(keyframeSchema).optional(),
};

export const imageLayerSchema = z
  .object({ ...layerBase, type: z.literal('image'), src: z.string().min(1) })
  .strict();

export const textLayerSchema = z
  .object({
    ...layerBase,
    type: z.literal('text'),
    text: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    size: z.number().positive().optional(),
    colour: z.string().optional(),
  })
  .strict();

export const tickerLayerSchema = z
  .object({ ...layerBase, type: z.literal('ticker'), text: z.string(), speed: z.number().optional() })
  .strict();

export const rectLayerSchema = z
  .object({
    ...layerBase,
    type: z.literal('rect'),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
    colour: z.string(),
  })
  .strict();

export const noiseLayerSchema = z
  .object({ ...layerBase, type: z.literal('noise'), intensity: z.number().min(0).max(1) })
  .strict();

export const layerSchema = z.discriminatedUnion('type', [
  imageLayerSchema,
  textLayerSchema,
  tickerLayerSchema,
  rectLayerSchema,
  noiseLayerSchema,
]);

export const captionSchema = z
  .object({
    atMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    text: z.string().min(1),
  })
  .strict();

export const sceneAudioCueSchema = z
  .object({
    url: z.string().min(1),
    atMs: z.number().int().nonnegative(),
    gain: z.number().nonnegative().optional(),
  })
  .strict();

export const sceneProgramSchema = z
  .object({
    id: z.string().min(1),
    durationMs: z.number().int().positive(),
    layers: z.array(layerSchema),
    audio: z.array(sceneAudioCueSchema).optional(),
    captions: z.array(captionSchema).optional(),
  })
  .strict();

// --- Horror events (design §9) ---------------------------------------------

export const seamSchema = z.enum(['tune-in', 'item-boundary', 'mid-item', 'startle', 'tear']);

/** What can fill the window in a jump (see `render/jumpScare.ts`). */
export const jumpKindSchema = z.enum([
  'anchor',
  'gourd',
  'operator',
  'deadair',
  'hands',
  'eye',
  'maw',
  'doll',
  'crowd',
  'snow',
  'pumpkin',
  'spider',
  'skull',
  'claws',
]);
export type JumpKind = z.infer<typeof jumpKindSchema>;

/** Procedural sounds an event can play (see `AudioEngine.playCue`). */
export const sfxCueSchema = z.enum([
  'stinger',
  'jumpHit',
  'jumpHands',
  'jumpEye',
  'jumpMaw',
  'jumpDoll',
  'jumpCrowd',
  'jumpSnow',
  'jumpPumpkin',
  'jumpSpider',
  'jumpSkull',
  'jumpClaws',
  'tapeStop',
  'heartbeat',
  'knock',
  'breath',
  'whisper',
  'toyPiano',
  'phoneRing',
  'scrape',
  'drone',
  'rumble',
]);

/**
 * Event conditions are a recursive data tree (design §9). Zod needs an explicit
 * type annotation and a getter for the self-referential `all`/`any`/`not` arms.
 */
export type ConditionInput =
  | { all: ConditionInput[] }
  | { any: ConditionInput[] }
  | { not: ConditionInput }
  | { visitsGte: { channel: 2 | 4 | 7 | 13 | 'current'; n: number } }
  | { distinctChannelsGte: number }
  | { watchMsGte: number }
  | { lastChannelIs: 2 | 4 | 7 | 13 }
  | { eventFired: string }
  | { sessionCountGte: number }
  | { localHourBetween: [number, number] };

export const conditionSchema: z.ZodType<ConditionInput> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema) }).strict(),
    z.object({ any: z.array(conditionSchema) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z
      .object({
        visitsGte: z
          .object({
            channel: z.union([channelIdSchema, z.literal('current')]),
            n: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    z.object({ distinctChannelsGte: z.number().int().nonnegative() }).strict(),
    z.object({ watchMsGte: z.number().nonnegative() }).strict(),
    z.object({ lastChannelIs: channelIdSchema }).strict(),
    z.object({ eventFired: z.string().min(1) }).strict(),
    z.object({ sessionCountGte: z.number().int().nonnegative() }).strict(),
    z
      .object({
        localHourBetween: z.tuple([
          z.number().int().min(0).max(23),
          z.number().int().min(0).max(23),
        ]),
      })
      .strict(),
  ]),
);

export const eventStepSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('static'), ms: z.number().int().positive(), look: lookSchema.optional() }).strict(),
  z
    .object({
      do: z.literal('slate'),
      text: z.string().min(1),
      fallbackText: z.string().optional(),
      ms: z.number().int().positive(),
    })
    .strict(),
  z.object({ do: z.literal('scene'), sceneId: z.string().min(1) }).strict(),
  z
    .object({
      do: z.literal('voice'),
      url: z.string().optional(),
      stems: z.array(z.string().min(1)).optional(),
      caption: z.string().min(1),
      fallbackCaption: z.string().optional(),
    })
    .strict(),
  z.object({ do: z.literal('flashPrevious'), ms: z.number().int().positive() }).strict(),
  z
    .object({
      do: z.literal('shaderPulse'),
      effect: z.enum(['roll', 'tear', 'collapse']),
      ms: z.number().int().positive(),
    })
    .strict(),
  z.object({ do: z.literal('silence'), ms: z.number().int().positive() }).strict(),
  z.object({ do: z.literal('signOff') }).strict(),
  // A sound. Without `ms` the next step starts at once, so a sound can sit on
  // top of a picture step without adding to the event's length.
  z
    .object({
      do: z.literal('sfx'),
      cue: sfxCueSchema,
      gain: z.number().min(0).max(1).optional(),
      ms: z.number().int().positive().optional(),
    })
    .strict(),
  // Something is suddenly filling the whole window, for `ms`.
  z
    .object({
      do: z.literal('jump'),
      kind: jumpKindSchema,
      ms: z.number().int().positive().max(1200),
    })
    .strict(),
  // The room's lights sink to `level` over `ms`.
  z.object({ do: z.literal('roomLights'), level: z.number().min(0).max(1), ms: z.number().int().positive() }).strict(),
  // Something pale behind the viewer's own tears. Unseen with no tears.
  z.object({ do: z.literal('roomGlimpse'), ms: z.number().int().positive() }).strict(),
  // Something pushes the wall from behind, along a path in content/room/paths.json.
  z.object({ do: z.literal('wallPush'), path: z.string().min(1), ms: z.number().int().positive() }).strict(),
  // The wall rips from the other side, along a path.
  z.object({ do: z.literal('wallRip'), path: z.string().min(1), ms: z.number().int().positive() }).strict(),
]);

/** Named paths across the wall, normalised 0..1 (design §7). */
export const roomPathsSchema = z.record(
  z.string(),
  z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(2).max(32),
);

export const horrorEventSchema = z
  .object({
    id: z.string().min(1),
    minAct: z.number().int().min(0).max(4),
    maxAct: z.number().int().min(0).max(4).optional(),
    channels: z.union([z.array(channelIdSchema), z.literal('any')]),
    seams: z.array(seamSchema).min(1),
    when: conditionSchema,
    limit: z
      .object({
        perViewer: z.number().int().nonnegative().optional(),
        perSession: z.number().int().nonnegative().optional(),
      })
      .strict(),
    cooldownMs: z.number().int().nonnegative().optional(),
    priority: z.number().int(),
    chain: z.boolean().optional(),
    steps: z.array(eventStepSchema).min(1),
  })
  .strict();

// --- Inferred types --------------------------------------------------------

export type SeamInput = z.infer<typeof seamSchema>;
export type EventStepInput = z.infer<typeof eventStepSchema>;
export type SfxCue = z.infer<typeof sfxCueSchema>;
export type HorrorEventInput = z.infer<typeof horrorEventSchema>;
// --- Persisted viewer memory (design §8, requirement 7) --------------------

const channelMemorySchema = z
  .object({
    visits: z.number().int().nonnegative(),
    watchMs: z.number().nonnegative(),
    lastVisitedAt: z.number().nullable(),
  })
  .strict();

/** What every memory version has. */
const memoryFields = {
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  sessionCount: z.number().int().positive(),
  totalWatchMs: z.number().nonnegative(),
  channels: z.object({
    2: channelMemorySchema,
    4: channelMemorySchema,
    7: channelMemorySchema,
    13: channelMemorySchema,
  }).strict(),
  visitOrder: z.array(channelIdSchema),
  lastChannel: channelIdSchema.nullable(),
  firedEvents: z.record(
    z.string(),
    z.object({ count: z.number().int().nonnegative(), lastAt: z.number() }).strict(),
  ),
  act: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  noticeSeen: z.boolean(),
  settings: z
    .object({
      volume: z.number().min(0).max(1),
      muted: z.boolean(),
      captions: z.boolean(),
      reducedEffects: z.boolean(),
    })
    .strict(),
};

/** What came before the room was remembered. Read only to migrate it. */
export const viewerMemoryV1Schema = z.object({ schemaVersion: z.literal(1), ...memoryFields }).strict();

const unit = z.number().min(0).max(1);

/**
 * Schema for `deadair.memory.v1` (the key outlives its version, and `schemaVersion`
 * says what is inside). Reads go through this; on any failure the store starts
 * fresh (requirement 7.4), so the shape is validated strictly.
 */
export const viewerMemorySchema = z
  .object({
    schemaVersion: z.literal(2),
    ...memoryFields,
    room: z
      .object({
        strokes: z
          .array(
            z
              .object({
                seed: z.number().int(),
                session: z.number().int().positive(),
                points: z.array(z.tuple([unit, unit])).min(2).max(32),
              })
              .strict(),
          )
          .max(24),
        figureStep: z.number().int().nonnegative(),
        objectVariant: z.number().int().nonnegative(),
        ripBackDone: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type ViewerMemoryInput = z.infer<typeof viewerMemorySchema>;

export type KeyframeInput = z.infer<typeof keyframeSchema>;
export type CaptionInput = z.infer<typeof captionSchema>;
export type RightsInput = z.infer<typeof rightsSchema>;
export type SceneItemInput = z.infer<typeof sceneItemSchema>;
export type FileItemInput = z.infer<typeof fileItemSchema>;
export type YouTubeItemInput = z.infer<typeof youTubeItemSchema>;
export type ItemInput = z.infer<typeof itemSchema>;
export type ChannelInput = z.infer<typeof channelSchema>;
export type LayerWhenInput = z.infer<typeof layerWhenSchema>;
export type LayerInput = z.infer<typeof layerSchema>;
export type SceneProgramInput = z.infer<typeof sceneProgramSchema>;

/**
 * Convert a validated channel into the core `Channel` shape used by the
 * broadcast clock. Validation has already guaranteed the structure; this is the
 * single typed bridge from parsed JSON to the domain types in src/core/types.ts
 * (design §4), so any drift between the schema and the core types fails to
 * compile here rather than at a random call site. Optional fields that Zod
 * infers as `T | undefined` are normalised to "present or absent" to satisfy
 * the core types' exact-optional properties.
 */
export function toChannel(input: ChannelInput): Channel {
  return {
    id: input.id,
    name: input.name,
    epochMs: input.epochMs,
    stationCard: input.stationCard,
    rundown: input.rundown.map(toItem),
  };
}

export function toItem(input: ItemInput): Item {
  const base = {
    id: input.id,
    title: input.title,
    kind: input.kind,
    durationMs: input.durationMs,
    rights: toRights(input.rights),
    ...(input.placeholder === undefined ? {} : { placeholder: input.placeholder }),
  };
  switch (input.source) {
    case 'scene':
      return { ...base, source: 'scene', sceneId: input.sceneId, look: input.look };
    case 'file':
      return {
        ...base,
        source: 'file',
        url: input.url,
        look: input.look,
        ...(input.captionsUrl === undefined ? {} : { captionsUrl: input.captionsUrl }),
      };
    case 'youtube':
      return {
        ...base,
        source: 'youtube',
        videoId: input.videoId,
        ...(input.startSeconds === undefined ? {} : { startSeconds: input.startSeconds }),
        ...(input.endSeconds === undefined ? {} : { endSeconds: input.endSeconds }),
      };
  }
}

function toRights(input: RightsInput): Rights {
  return {
    basis: input.basis,
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.licence === undefined ? {} : { licence: input.licence }),
    ...(input.attribution === undefined ? {} : { attribution: input.attribution }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

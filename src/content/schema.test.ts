import { describe, expect, it } from 'vitest';
import {
  channelSchema,
  itemSchema,
  rightsSchema,
  sceneProgramSchema,
  toChannel,
  toItem,
} from './schema.ts';
import type { Channel, Item } from '../core/types.ts';

const validRights = { basis: 'original' as const };

const validScene = {
  id: 'ch02-bulletin-a',
  title: 'Bulletin A',
  kind: 'programme' as const,
  durationMs: 40_000,
  rights: validRights,
  source: 'scene' as const,
  sceneId: 'bulletinA',
  look: 'broadcast' as const,
};

const validYouTube = {
  id: 'ch02-yt-1',
  title: 'Filler',
  kind: 'interstitial' as const,
  durationMs: 120_000,
  rights: { basis: 'youtube-embed' as const },
  source: 'youtube' as const,
  videoId: 'abcdEFGHijk',
};

describe('rightsSchema (requirement 14.2)', () => {
  it('accepts a minimal rights record', () => {
    expect(rightsSchema.safeParse(validRights).success).toBe(true);
  });

  it('rejects an unknown basis', () => {
    expect(rightsSchema.safeParse({ basis: 'stolen' }).success).toBe(false);
  });

  it('rejects unknown extra keys (strict)', () => {
    expect(rightsSchema.safeParse({ basis: 'cc', bogus: 1 }).success).toBe(false);
  });
});

describe('itemSchema', () => {
  it('parses a valid scene item', () => {
    expect(itemSchema.safeParse(validScene).success).toBe(true);
  });

  it('parses a valid youtube item', () => {
    expect(itemSchema.safeParse(validYouTube).success).toBe(true);
  });

  it('requires a rights record (requirement 14.2)', () => {
    const { rights: _omit, ...noRights } = validScene;
    void _omit;
    expect(itemSchema.safeParse(noRights).success).toBe(false);
  });

  it('rejects a non-positive duration (requirement 14.1)', () => {
    expect(itemSchema.safeParse({ ...validScene, durationMs: 0 }).success).toBe(false);
    expect(itemSchema.safeParse({ ...validScene, durationMs: -5 }).success).toBe(false);
  });

  it('rejects a non-integer duration', () => {
    expect(itemSchema.safeParse({ ...validScene, durationMs: 1.5 }).success).toBe(false);
  });

  it('discriminates on source: a scene item may not carry a videoId', () => {
    const mixed = { ...validScene, videoId: 'xyz' };
    // strict() on the scene variant rejects the foreign key.
    expect(itemSchema.safeParse(mixed).success).toBe(false);
  });

  it('rejects an empty id', () => {
    expect(itemSchema.safeParse({ ...validScene, id: '' }).success).toBe(false);
  });

  it('carries the placeholder flag when present', () => {
    const parsed = itemSchema.parse({ ...validScene, placeholder: true });
    expect(parsed.placeholder).toBe(true);
  });
});

describe('channelSchema', () => {
  const validChannel = {
    id: 2 as const,
    name: 'KDA Nightly News',
    epochMs: 0,
    stationCard: 'cards/ch02.png',
    rundown: [validScene],
  };

  it('parses a valid channel', () => {
    expect(channelSchema.safeParse(validChannel).success).toBe(true);
  });

  it('rejects an unknown channel id', () => {
    expect(channelSchema.safeParse({ ...validChannel, id: 3 }).success).toBe(false);
  });

  it('requires at least one rundown item', () => {
    expect(channelSchema.safeParse({ ...validChannel, rundown: [] }).success).toBe(false);
  });
});

describe('sceneProgramSchema (design §6)', () => {
  it('parses a scene with image, text and ticker layers plus captions', () => {
    const program = {
      id: 'bulletinA',
      durationMs: 40_000,
      layers: [
        { id: 'bg', type: 'image', src: 'news/room.png' },
        { id: 'anchor', type: 'image', src: 'news/anchor.png', when: { minVisits: 2 } },
        { id: 'lower', type: 'text', text: 'HOLLOW CREEK' },
        { id: 'ticker', type: 'ticker', text: 'ALDER RD' },
      ],
      captions: [{ atMs: 5000, endMs: 15000, text: 'This is KDA Nightly News.' }],
    };
    expect(sceneProgramSchema.safeParse(program).success).toBe(true);
  });

  it('rejects an unknown layer type', () => {
    const bad = {
      id: 's',
      durationMs: 1000,
      layers: [{ id: 'x', type: 'hologram' }],
    };
    expect(sceneProgramSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a caption with no text', () => {
    const bad = {
      id: 's',
      durationMs: 1000,
      layers: [],
      captions: [{ atMs: 0, endMs: 10, text: '' }],
    };
    expect(sceneProgramSchema.safeParse(bad).success).toBe(false);
  });
});

describe('toChannel / toItem bridge to core types', () => {
  it('converts a parsed scene item to the core Item shape, omitting absent optionals', () => {
    const item: Item = toItem(itemSchema.parse(validScene));
    expect(item.source).toBe('scene');
    // placeholder was absent, so the key must be omitted (exact-optional).
    expect('placeholder' in item).toBe(false);
    // rights with no evidence omits the optional keys.
    expect('source' in item.rights).toBe(false);
  });

  it('keeps optional fields that are present', () => {
    const yt: Item = toItem(
      itemSchema.parse({ ...validYouTube, startSeconds: 30, placeholder: true }),
    );
    expect(yt.source).toBe('youtube');
    if (yt.source === 'youtube') expect(yt.startSeconds).toBe(30);
    expect(yt.placeholder).toBe(true);
  });

  it('converts a parsed channel to the core Channel shape', () => {
    const channel: Channel = toChannel(
      channelSchema.parse({
        id: 2,
        name: 'KDA Nightly News',
        epochMs: 0,
        stationCard: 'cards/ch02.png',
        rundown: [validScene],
      }),
    );
    expect(channel.id).toBe(2);
    expect(channel.rundown).toHaveLength(1);
  });
});

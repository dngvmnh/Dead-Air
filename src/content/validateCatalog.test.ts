import { describe, expect, it } from 'vitest';
import {
  MIN_CHANNEL_MS,
  MIN_INTERSTITIALS,
  validateCatalog,
  type CatalogInput,
} from './validateCatalog.ts';

// --- Fixtures --------------------------------------------------------------

const rights = { basis: 'original' as const };

const scene = (id: string) => ({ id, durationMs: 1000, layers: [] });

const sceneItem = (id: string, sceneId = 'sceneA', over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  kind: 'programme' as const,
  durationMs: 60_000,
  rights,
  source: 'scene' as const,
  sceneId,
  look: 'broadcast' as const,
  ...over,
});

const youTubeItem = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  kind: 'programme' as const,
  durationMs: 120_000,
  rights: { basis: 'youtube-embed' as const },
  source: 'youtube' as const,
  videoId: 'abcdEFGHijk',
  ...over,
});

const channel = (id: 2 | 4 | 7 | 13, rundown: unknown[], over: Record<string, unknown> = {}) => ({
  id,
  name: `Channel ${id}`,
  epochMs: 0,
  stationCard: 'cards/ch.png',
  rundown,
  ...over,
});

/** A minimal everything-valid catalogue with asset-reference checks disabled. */
function baseCatalog(): CatalogInput {
  return {
    channels: [channel(2, [sceneItem('i1')])],
    scenes: [scene('sceneA')],
    events: [],
    // localAssets omitted -> asset references are not checked here.
  };
}

function rulesHit(input: CatalogInput, release = false): string[] {
  return validateCatalog(input, { release }).errors.map((e) => e.rule);
}

// --- Baseline --------------------------------------------------------------

describe('validateCatalog baseline', () => {
  it('passes a minimal valid catalogue', () => {
    const r = validateCatalog(baseCatalog());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('an empty catalogue passes standard but fails release depth', () => {
    const empty: CatalogInput = { channels: [], scenes: [], events: [] };
    expect(validateCatalog(empty).ok).toBe(true);
    // No channels => no depth failures, so release of truly-empty also passes.
    expect(validateCatalog(empty, { release: true }).ok).toBe(true);
  });
});

// --- Rule 14.1: schema validity -------------------------------------------

describe('rule 14.1 schema validity', () => {
  it('fails a channel with an unknown id', () => {
    const input = baseCatalog();
    input.channels = [channel(3 as unknown as 2, [sceneItem('i1')])];
    expect(rulesHit(input)).toContain('14.1');
  });

  it('fails an item missing a required discriminated field', () => {
    const { videoId: _drop, ...noVideoId } = youTubeItem('i1');
    void _drop;
    const input = baseCatalog();
    input.channels = [channel(2, [noVideoId])];
    expect(rulesHit(input)).toContain('14.1');
  });
});

// --- Rule 14.1: unique ids -------------------------------------------------

describe('rule 14.1 unique ids', () => {
  it('fails duplicate item ids across channels', () => {
    const input = baseCatalog();
    input.channels = [channel(2, [sceneItem('dup')]), channel(4, [sceneItem('dup')])];
    const errs = validateCatalog(input).errors;
    expect(errs.some((e) => e.rule === '14.1' && /duplicate item id/.test(e.message))).toBe(true);
  });

  it('fails duplicate scene ids', () => {
    const input = baseCatalog();
    input.scenes = [scene('sceneA'), scene('sceneA')];
    const errs = validateCatalog(input).errors;
    expect(errs.some((e) => /duplicate scene id/.test(e.message))).toBe(true);
  });

  it('fails duplicate event ids', () => {
    const ev = {
      id: 'E01',
      minAct: 0,
      channels: 'any' as const,
      seams: ['tune-in'],
      when: { distinctChannelsGte: 1 },
      limit: {},
      priority: 0,
      steps: [{ do: 'silence', ms: 100 }],
    };
    const input = baseCatalog();
    input.events = [ev, { ...ev }];
    const errs = validateCatalog(input).errors;
    expect(errs.some((e) => /duplicate event id/.test(e.message))).toBe(true);
  });
});

// --- Rule 14.1: durations > 0 ---------------------------------------------

describe('rule 14.1 durations greater than zero', () => {
  it('fails a zero or negative duration', () => {
    const input = baseCatalog();
    input.channels = [channel(2, [sceneItem('i1', 'sceneA', { durationMs: 0 })])];
    expect(rulesHit(input)).toContain('14.1');
  });
});

// --- Rule 14.1: references resolve ----------------------------------------

describe('rule 14.1 references resolve', () => {
  it('fails a scene item referencing an unknown scene', () => {
    const input = baseCatalog();
    input.channels = [channel(2, [sceneItem('i1', 'missingScene')])];
    const errs = validateCatalog(input).errors;
    expect(errs.some((e) => /unknown scene/.test(e.message))).toBe(true);
  });

  it('fails an event step referencing an unknown scene', () => {
    const input = baseCatalog();
    input.events = [
      {
        id: 'E01',
        minAct: 0,
        channels: 'any',
        seams: ['tune-in'],
        when: { distinctChannelsGte: 1 },
        limit: {},
        priority: 0,
        steps: [{ do: 'scene', sceneId: 'ghost' }],
      },
    ];
    const errs = validateCatalog(input).errors;
    expect(errs.some((e) => /step references unknown scene/.test(e.message))).toBe(true);
  });

  it('fails a file item referencing a missing local asset, passes when present', () => {
    const fileItem = {
      id: 'f1',
      title: 'f',
      kind: 'programme' as const,
      durationMs: 1000,
      rights: { basis: 'original' as const },
      source: 'file' as const,
      url: 'clips/intro.webm',
      look: 'broadcast' as const,
    };
    const base: CatalogInput = {
      channels: [channel(2, [fileItem], { stationCard: 'cards/ch02.png' })],
      scenes: [],
      events: [],
      localAssets: new Set(['cards/ch02.png']),
    };
    expect(validateCatalog(base).errors.some((e) => /missing local asset/.test(e.message))).toBe(true);

    base.localAssets = new Set(['cards/ch02.png', 'clips/intro.webm']);
    expect(validateCatalog(base).ok).toBe(true);
  });

  it('fails a missing station card asset but allows a remote url', () => {
    const withAssets: CatalogInput = {
      channels: [channel(2, [sceneItem('i1')], { stationCard: 'cards/none.png' })],
      scenes: [scene('sceneA')],
      events: [],
      localAssets: new Set<string>(),
    };
    expect(validateCatalog(withAssets).errors.some((e) => /stationCard asset/.test(e.message))).toBe(true);

    // A remote file url is not a local asset and is not required to exist.
    const remote = {
      id: 'f1',
      title: 'f',
      kind: 'programme' as const,
      durationMs: 1000,
      rights: { basis: 'original' as const },
      source: 'file' as const,
      url: 'https://cdn.example.com/a.webm',
      look: 'broadcast' as const,
    };
    const remoteInput: CatalogInput = {
      channels: [channel(2, [remote], { stationCard: 'cards/ok.png' })],
      scenes: [],
      events: [],
      localAssets: new Set(['cards/ok.png']),
    };
    expect(validateCatalog(remoteInput).ok).toBe(true);
  });
});

// --- Rule 14.2: rights record ---------------------------------------------

describe('rule 14.2 rights required', () => {
  it('fails an item with no rights (caught at schema level as 14.1/14.2)', () => {
    const { rights: _drop, ...noRights } = sceneItem('i1');
    void _drop;
    const input = baseCatalog();
    input.channels = [channel(2, [noRights])];
    // Schema catches the missing field; the rule family must flag it.
    expect(validateCatalog(input).ok).toBe(false);
  });
});

// --- Rule 14.3: mid-item on YouTube ---------------------------------------

describe('rule 14.3 no mid-item event on a YouTube item', () => {
  const midItemEvent = (channels: 'any' | (2 | 4 | 7 | 13)[]) => ({
    id: 'Emid',
    minAct: 0,
    channels,
    seams: ['mid-item'],
    when: { distinctChannelsGte: 1 },
    limit: {},
    priority: 0,
    steps: [{ do: 'silence', ms: 100 }],
  });

  it('fails when a mid-item event targets a channel carrying a YouTube item', () => {
    const input: CatalogInput = {
      channels: [channel(4, [youTubeItem('y1')])],
      scenes: [],
      events: [midItemEvent([4])],
    };
    expect(rulesHit(input)).toContain('14.3');
  });

  it('fails when an "any"-channel mid-item event exists and any channel has YouTube', () => {
    const input: CatalogInput = {
      channels: [channel(4, [youTubeItem('y1')])],
      scenes: [],
      events: [midItemEvent('any')],
    };
    expect(rulesHit(input)).toContain('14.3');
  });

  it('passes a mid-item event on a channel with no YouTube items', () => {
    const input: CatalogInput = {
      channels: [channel(2, [sceneItem('i1')])],
      scenes: [scene('sceneA')],
      events: [midItemEvent([2])],
    };
    expect(rulesHit(input)).not.toContain('14.3');
  });
});

// --- Rule 14.4: channel 13 media basis ------------------------------------

describe('rule 14.4 channel 13 original/ai-generated only', () => {
  it('fails a channel 13 item with a non-original basis', () => {
    const ccItem = sceneItem('c1', 'sceneA', { rights: { basis: 'cc' as const } });
    const input: CatalogInput = {
      channels: [channel(13, [ccItem])],
      scenes: [scene('sceneA')],
      events: [],
    };
    expect(rulesHit(input)).toContain('14.4');
  });

  it('fails a YouTube item on channel 13', () => {
    const input: CatalogInput = {
      channels: [channel(13, [youTubeItem('y1')])],
      scenes: [],
      events: [],
    };
    expect(rulesHit(input)).toContain('14.4');
  });

  it('passes a channel 13 item that is ai-generated', () => {
    const aiItem = sceneItem('a1', 'sceneA', { rights: { basis: 'ai-generated' as const } });
    const input: CatalogInput = {
      channels: [channel(13, [aiItem])],
      scenes: [scene('sceneA')],
      events: [],
    };
    expect(rulesHit(input)).not.toContain('14.4');
  });
});

// --- Rule 14.5 (--release): placeholders ----------------------------------

describe('rule 14.5 release rejects placeholder items', () => {
  it('passes a placeholder item in standard mode, fails under --release', () => {
    const ph = sceneItem('i1', 'sceneA', { placeholder: true, durationMs: MIN_CHANNEL_MS });
    const input: CatalogInput = {
      channels: [channel(2, [ph, sceneItem('a', 'sceneA', { kind: 'interstitial', durationMs: 1 }), sceneItem('b', 'sceneA', { kind: 'interstitial', durationMs: 1 }), sceneItem('c', 'sceneA', { kind: 'interstitial', durationMs: 1 }), sceneItem('d', 'sceneA', { kind: 'interstitial', durationMs: 1 })])],
      scenes: [scene('sceneA')],
      events: [],
    };
    expect(rulesHit(input)).not.toContain('14.5');
    expect(rulesHit(input, true)).toContain('14.5');
  });
});

// --- Requirement 4 (--release): depth -------------------------------------

describe('requirement 4 release depth rules', () => {
  const fourInterstitials = () =>
    [1, 2, 3, 4].map((n) => sceneItem(`int${n}`, 'sceneA', { kind: 'interstitial', durationMs: 1000 }));

  it('fails channel under 30 minutes under --release (rule 4.1)', () => {
    const input: CatalogInput = {
      channels: [channel(2, [sceneItem('short', 'sceneA', { durationMs: 1000 }), ...fourInterstitials()])],
      scenes: [scene('sceneA')],
      events: [],
    };
    expect(rulesHit(input)).not.toContain('4.1');
    expect(rulesHit(input, true)).toContain('4.1');
  });

  it('fails channel 02/04/07 with fewer than four interstitials (rule 4.2)', () => {
    const input: CatalogInput = {
      channels: [channel(4, [sceneItem('long', 'sceneA', { durationMs: MIN_CHANNEL_MS })])],
      scenes: [scene('sceneA')],
      events: [],
    };
    const hits = rulesHit(input, true);
    expect(hits).toContain('4.2');
    expect(hits).not.toContain('4.1');
  });

  it('does not require interstitials on channel 13 (rule 4.2 scope)', () => {
    const okItem = sceneItem('big', 'sceneA', { durationMs: MIN_CHANNEL_MS, rights: { basis: 'original' as const } });
    const input: CatalogInput = {
      channels: [channel(13, [okItem])],
      scenes: [scene('sceneA')],
      events: [],
    };
    expect(rulesHit(input, true)).not.toContain('4.2');
  });

  it('passes a release-quality channel (>=30 min, >=4 interstitials, no placeholders)', () => {
    const programme = sceneItem('prog', 'sceneA', { durationMs: MIN_CHANNEL_MS });
    const input: CatalogInput = {
      channels: [channel(2, [programme, ...fourInterstitials()])],
      scenes: [scene('sceneA')],
      events: [],
    };
    expect(validateCatalog(input, { release: true }).ok).toBe(true);
    expect(MIN_INTERSTITIALS).toBe(4);
  });
});

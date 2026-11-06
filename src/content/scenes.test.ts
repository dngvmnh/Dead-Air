import { describe, expect, it } from 'vitest';
import { captionBandTop, captionLines } from '../render/sceneRenderer.ts';
import { INTERNAL_HEIGHT } from '../render/looks.ts';
import { sceneProgramSchema } from './schema.ts';

const modules = import.meta.glob('./scenes/*.json', { eager: true, import: 'default' });

describe('scene layout', () => {
  // A caption over a title makes both unreadable, and only shows up at the moment
  // that cue plays, so it is checked here for every scene and every cue.
  for (const [path, raw] of Object.entries(modules)) {
    it(`${path}: on-screen text stays above its captions`, () => {
      const scene = sceneProgramSchema.parse(raw);
      const captions = scene.captions ?? [];
      if (captions.length === 0) return;
      const longest = Math.max(...captions.map((c) => captionLines([c.text]).length));
      const top = captionBandTop(longest, INTERNAL_HEIGHT);
      for (const layer of scene.layers) {
        if (layer.type !== 'text') continue;
        const bottom = (layer.y ?? 40) + (layer.size ?? 32);
        expect(bottom, `${layer.id} ends at ${bottom}, captions start at ${top}`).toBeLessThanOrEqual(top);
      }
    });
  }

  it('wraps a long cue rather than losing both ends of it', () => {
    const lines = captionLines(['Neighbours on Alder Road report their sets switching on overnight, again.']);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(44);
  });
});

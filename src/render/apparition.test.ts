import { describe, expect, it } from 'vitest';
import { drawApparition, twitchAt, type ApparitionKind } from './apparition.ts';
import { jumpShotAt } from './jumpScare.ts';
import type { Ctx2D } from './overlayRenderer.ts';

function fakeCtx(): { ctx: Ctx2D; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, name) => (...args: unknown[]) => {
        calls.push([String(name), args]);
        return { addColorStop: () => undefined };
      },
      set: () => true,
    },
  ) as unknown as Ctx2D;
  return { ctx, calls };
}

const SIZE = { width: 960, height: 720, reduced: false };
const KINDS: ApparitionKind[] = ['anchor', 'gourd', 'operator', 'deadair'];

describe('drawApparition', () => {
  for (const kind of KINDS) {
    it(`${kind}: repaints the whole field first, so no earlier text stays under it`, () => {
      const { ctx, calls } = fakeCtx();
      drawApparition(ctx, kind, undefined, 100, 2000, SIZE);
      expect(calls.find(([op]) => op === 'fillRect')?.[1]).toEqual([0, 0, 960, 720]);
    });
  }

  it('draws its one line low in the frame', () => {
    const { ctx, calls } = fakeCtx();
    drawApparition(ctx, 'gourd', 'JUST ONE.', 100, 2000, SIZE);
    const text = calls.filter(([op]) => op === 'fillText');
    expect(text).toHaveLength(1);
    expect(text[0]?.[1][0]).toBe('JUST ONE.');
    expect(text[0]?.[1][2]).toBeGreaterThan(590);
  });

  it('holds the figure still under reduced effects', () => {
    expect(twitchAt(100, true)).toBe(0);
    expect(twitchAt(900, true)).toBe(0);
    expect(twitchAt(100, false)).not.toBe(twitchAt(900, false));
  });
});

describe('jumpShotAt', () => {
  it('fills the window from its very first frame, with no approach', () => {
    expect(jumpShotAt(0).scale).toBeGreaterThanOrEqual(1);
  });

  it('cuts closer and opens the mouth, and never backs away', () => {
    expect(jumpShotAt(0).screaming).toBe(false);
    expect(jumpShotAt(300).screaming).toBe(true);
    expect(jumpShotAt(300).scale).toBeGreaterThan(jumpShotAt(0).scale);
    expect(jumpShotAt(700).scale).toBeGreaterThan(jumpShotAt(300).scale);
  });
});

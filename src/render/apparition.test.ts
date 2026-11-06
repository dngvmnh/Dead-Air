import { describe, expect, it } from 'vitest';
import { drawApparition, twitchAt, type ApparitionKind } from './apparition.ts';
import { lungeProgress } from './jumpScare.ts';
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

describe('lungeProgress', () => {
  it('starts at the origin, arrives fast, and keeps creeping', () => {
    expect(lungeProgress(0)).toBe(0);
    expect(lungeProgress(85)).toBeLessThan(0.2);
    expect(lungeProgress(170)).toBe(1);
    expect(lungeProgress(600)).toBeGreaterThan(1);
    expect(lungeProgress(600)).toBeLessThan(1.2);
  });
});

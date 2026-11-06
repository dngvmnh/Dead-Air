import { describe, expect, it } from 'vitest';
import { drawApparition, type ApparitionKind } from './apparition.ts';
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
    const at = (tMs: number) => {
      const { ctx, calls } = fakeCtx();
      drawApparition(ctx, 'anchor', undefined, tMs, 1_000_000_000, { ...SIZE, reduced: true });
      return JSON.stringify(calls.filter(([op]) => op === 'ellipse').map(([, a]) => Math.round(Number(a[0]))));
    };
    expect(at(100)).toEqual(at(900));
  });
});

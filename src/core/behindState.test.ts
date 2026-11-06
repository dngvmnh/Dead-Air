import { describe, expect, it } from 'vitest';
import { deriveBehind } from './behindState.ts';
import { createMemory, type ViewerMemory } from './memory.ts';
import type { TemplateContext } from './template.ts';

const ctx: TemplateContext = { channel: 2, localHour: 22, localMinute: 5, firstSeenHour: 21, firstSeenMinute: 7 };

function memory(over: Partial<ViewerMemory>): ViewerMemory {
  return { ...createMemory(1000), ...over };
}

function withVisits(m: ViewerMemory, visits: Partial<Record<2 | 4 | 7 | 13, number>>): ViewerMemory {
  const channels = { ...m.channels };
  for (const [id, n] of Object.entries(visits)) {
    const key = Number(id) as 2 | 4 | 7 | 13;
    channels[key] = { ...channels[key], visits: n ?? 0 };
  }
  return { ...m, channels };
}

describe('deriveBehind', () => {
  it('Act 0 is an ordinary wall, with no marks and no words', () => {
    const v = deriveBehind(memory({ act: 0 }), ctx);
    expect(v.tally).toBe(0);
    expect(v.lines).toEqual([]);
  });

  it('Act 1 tallies the real number of channel visits', () => {
    const v = deriveBehind(withVisits(memory({ act: 1 }), { 2: 3, 4: 2 }), ctx);
    expect(v.tally).toBe(5);
    expect(v.lines).toEqual([]);
  });

  it('Act 2 scratches the real history and first viewing time', () => {
    const v = deriveBehind(withVisits(memory({ act: 2 }), { 2: 1, 7: 1 }), ctx);
    expect(v.lines).toEqual(['CHANNELS 02, 07', 'FIRST WATCHED 21:07']);
  });

  it('leaves out a line it has no real value for, and never invents one', () => {
    const noHistory = deriveBehind(memory({ act: 2 }), ctx);
    expect(noHistory.lines).toEqual(['FIRST WATCHED 21:07']);
    const noTime = deriveBehind(memory({ act: 2 }), { channel: 2, localHour: 22, localMinute: 5 });
    expect(noTime.lines).toEqual([]);
    for (const line of [...noHistory.lines, ...noTime.lines]) expect(line).not.toContain('{');
  });

  it('later acts carry no personal words, only their own imagery', () => {
    for (const act of [3, 4] as const) {
      const v = deriveBehind(withVisits(memory({ act }), { 2: 2 }), ctx);
      expect(v.tally).toBe(0);
      expect(v.lines).toEqual([]);
    }
  });

  it('its key changes only when the picture would', () => {
    const a = deriveBehind(withVisits(memory({ act: 1 }), { 2: 3 }), ctx);
    const same = deriveBehind(withVisits(memory({ act: 1, totalWatchMs: 99 }), { 2: 3 }), { ...ctx, localMinute: 6 });
    const more = deriveBehind(withVisits(memory({ act: 1 }), { 2: 4 }), ctx);
    expect(same.key).toBe(a.key);
    expect(more.key).not.toBe(a.key);
  });
});

import { describe, expect, it } from 'vitest';
import { fillTemplate, renderLine, type TemplateContext } from './template.ts';
import { createMemory, memoryReducer, type ViewerMemory } from './memory.ts';
import type { ChannelId } from './types.ts';

const ctx: TemplateContext = { channel: 2, localHour: 23, localMinute: 7 };

function visit(m: ViewerMemory, ch: ChannelId, n = 1, atMs = 1): ViewerMemory {
  let out = m;
  for (let i = 0; i < n; i += 1) out = memoryReducer(out, { type: 'visit', channel: ch, atMs }, false);
  return out;
}

describe('fillTemplate (requirement 9.5)', () => {
  it('fills real values and reports nothing missing', () => {
    let m = visit(createMemory(0), 4, 1);
    m = visit(m, 2, 2);
    m = { ...m, totalWatchMs: 3 * 60_000 };
    const r = fillTemplate(
      '{lastChannelName} / {visitedList} / {totalMinutes}m / {visitCountCurrent} / {localTime}',
      m,
      ctx,
    );
    expect(r.missing).toEqual([]);
    // {lastChannel*} is the channel the viewer CAME FROM (the previous different
    // channel), not the current one: here they came from 04 onto 02.
    expect(r.text).toContain('Pumpkin Hour');
    expect(r.text).toContain('02, 04'); // visited list (cycle order)
    expect(r.text).toContain('3m');
    expect(r.text).toContain('23:07');
  });

  it('{lastChannel} is the previous different channel, not the current one', () => {
    // Came from 07 onto 13: naming "channel you came from" is 07.
    let m = visit(createMemory(0), 7, 1);
    m = visit(m, 13, 1);
    const r = fillTemplate('LAST TUNED: CHANNEL {lastChannel}', m, ctx);
    expect(r.missing).toEqual([]);
    expect(r.text).toBe('LAST TUNED: CHANNEL 07');
  });

  it('reports missing variables and leaves the placeholder', () => {
    const m = createMemory(0); // nothing watched or visited
    const r = fillTemplate('watched {totalMinutes} on {lastChannel}', m, ctx);
    expect(r.missing).toContain('totalMinutes');
    expect(r.missing).toContain('lastChannel');
    expect(r.text).toContain('{totalMinutes}');
  });

  it('mostWatchedChannel picks the channel with the most watch time', () => {
    let m = visit(createMemory(0), 2);
    m = memoryReducer(m, { type: 'watch', channel: 2, deltaMs: 1000 }, false);
    m = visit(m, 7);
    m = memoryReducer(m, { type: 'watch', channel: 7, deltaMs: 5000 }, false);
    expect(fillTemplate('{mostWatchedChannel}', m, ctx).text).toBe('07');
  });
});

describe('renderLine', () => {
  it('uses the primary when all variables resolve', () => {
    let m = visit(createMemory(0), 2, 1);
    m = { ...m, totalWatchMs: 2 * 60_000 };
    expect(renderLine('watched {totalMinutes} min', 'watched a while', m, ctx)).toBe('watched 2 min');
  });

  it('falls back when any variable is missing (requirement 9.5)', () => {
    const m = createMemory(0);
    expect(renderLine('watched {totalMinutes} min', 'watched a while', m, ctx)).toBe('watched a while');
  });

  it('never invents a value: with no fallback the placeholder remains', () => {
    const m = createMemory(0);
    expect(renderLine('on {lastChannel}', undefined, m, ctx)).toBe('on {lastChannel}');
  });
});

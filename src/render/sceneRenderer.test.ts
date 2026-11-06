import { describe, expect, it } from 'vitest';
import { renderScene, type Ctx2D } from './sceneRenderer.ts';
import type { SceneProgramInput } from '../content/schema.ts';

/**
 * jsdom has no real 2D context, so we record the drawing calls against a fake
 * context and assert on the sequence. This proves the renderer draws the right
 * primitives for each layer type and honours visibility, without a GPU.
 */
interface Call {
  op: string;
  args: unknown[];
}

function fakeCtx(): { ctx: Ctx2D; calls: Call[] } {
  const calls: Call[] = [];
  const rec =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  const ctx = {
    save: rec('save'),
    restore: rec('restore'),
    fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'),
    fillText: rec('fillText'),
    drawImage: rec('drawImage'),
    set fillStyle(v: string) {
      calls.push({ op: 'fillStyle', args: [v] });
    },
    set strokeStyle(v: string) {
      calls.push({ op: 'strokeStyle', args: [v] });
    },
    set globalAlpha(v: number) {
      calls.push({ op: 'globalAlpha', args: [v] });
    },
    set font(v: string) {
      calls.push({ op: 'font', args: [v] });
    },
    set textBaseline(v: string) {
      calls.push({ op: 'textBaseline', args: [v] });
    },
    set textAlign(v: string) {
      calls.push({ op: 'textAlign', args: [v] });
    },
    set lineWidth(v: number) {
      calls.push({ op: 'lineWidth', args: [v] });
    },
  } as unknown as Ctx2D;
  return { ctx, calls };
}

const vars = { visits: 1, act: 0 };

describe('renderScene', () => {
  it('fills an opaque black base before drawing layers', () => {
    const { ctx, calls } = fakeCtx();
    const program: SceneProgramInput = { id: 's', durationMs: 1000, layers: [] };
    renderScene(ctx, program, 0, vars, { width: 100, height: 100, drawCaptions: false });
    const firstFill = calls.find((c) => c.op === 'fillRect');
    expect(firstFill?.args).toEqual([0, 0, 100, 100]);
    // The style just before the base fill is black.
    const idx = calls.indexOf(firstFill as Call);
    expect(calls[idx - 1]).toEqual({ op: 'fillStyle', args: ['#000000'] });
  });

  it('draws a loaded image bitmap, not a placeholder', () => {
    const { ctx, calls } = fakeCtx();
    const bitmap = {} as CanvasImageSource;
    const program: SceneProgramInput = {
      id: 's',
      durationMs: 1000,
      layers: [{ id: 'bg', type: 'image', src: 'room.png' }],
    };
    renderScene(ctx, program, 0, vars, {
      images: new Map([['room.png', bitmap]]),
      drawCaptions: false,
    });
    expect(calls.some((c) => c.op === 'drawImage' && c.args[0] === bitmap)).toBe(true);
    // No placeholder label drawn.
    expect(calls.some((c) => c.op === 'fillText' && String(c.args[0]).includes('[room.png]'))).toBe(false);
  });

  it('draws a labelled placeholder for a missing image', () => {
    const { ctx, calls } = fakeCtx();
    const program: SceneProgramInput = {
      id: 's',
      durationMs: 1000,
      layers: [{ id: 'bg', type: 'image', src: 'ghost.png' }],
    };
    renderScene(ctx, program, 0, vars, { drawCaptions: false });
    expect(calls.some((c) => c.op === 'drawImage')).toBe(false);
    expect(calls.some((c) => c.op === 'fillText' && c.args[0] === '[ghost.png]')).toBe(true);
  });

  it('skips a layer hidden by its when clause', () => {
    const { ctx, calls } = fakeCtx();
    const program: SceneProgramInput = {
      id: 's',
      durationMs: 1000,
      layers: [{ id: 'anchor', type: 'text', text: 'ACT2', when: { minAct: 2 } }],
    };
    renderScene(ctx, program, 0, { visits: 1, act: 0 }, { drawCaptions: false });
    expect(calls.some((c) => c.op === 'fillText' && c.args[0] === 'ACT2')).toBe(false);
    // Visible once act is high enough.
    const { ctx: ctx2, calls: calls2 } = fakeCtx();
    renderScene(ctx2, program, 0, { visits: 1, act: 3 }, { drawCaptions: false });
    expect(calls2.some((c) => c.op === 'fillText' && c.args[0] === 'ACT2')).toBe(true);
  });

  it('draws a rect layer with its colour and box', () => {
    const { ctx, calls } = fakeCtx();
    const program: SceneProgramInput = {
      id: 's',
      durationMs: 1000,
      layers: [{ id: 'r', type: 'rect', x: 10, y: 20, w: 30, h: 40, colour: '#ff0000' }],
    };
    renderScene(ctx, program, 0, vars, { drawCaptions: false });
    expect(calls.some((c) => c.op === 'fillStyle' && c.args[0] === '#ff0000')).toBe(true);
    expect(calls.some((c) => c.op === 'fillRect' && JSON.stringify(c.args) === JSON.stringify([10, 20, 30, 40]))).toBe(true);
  });

  it('draws active captions and omits them when disabled', () => {
    const program: SceneProgramInput = {
      id: 's',
      durationMs: 5000,
      layers: [],
      captions: [{ atMs: 0, endMs: 2000, text: 'hello' }],
    };
    const on = fakeCtx();
    renderScene(on.ctx, program, 1000, vars);
    expect(on.calls.some((c) => c.op === 'fillText' && c.args[0] === 'hello')).toBe(true);

    const off = fakeCtx();
    renderScene(off.ctx, program, 1000, vars, { drawCaptions: false });
    expect(off.calls.some((c) => c.op === 'fillText' && c.args[0] === 'hello')).toBe(false);
  });

  it('respects a keyframed opacity of 0 by skipping the layer', () => {
    const { ctx, calls } = fakeCtx();
    const program: SceneProgramInput = {
      id: 's',
      durationMs: 1000,
      layers: [{ id: 't', type: 'text', text: 'FADE', keyframes: [{ atMs: 0, opacity: 0 }] }],
    };
    renderScene(ctx, program, 0, vars, { drawCaptions: false });
    expect(calls.some((c) => c.op === 'fillText' && c.args[0] === 'FADE')).toBe(false);
  });

  it('changes a channel-07 set object on revisit (requirement 8.4)', async () => {
    // The real ch07 scene: a shelf clock slot appears at minVisits:2.
    const scene = (await import('../content/scenes/ch07-shopping-a.json', { with: { type: 'json' } }))
      .default as unknown as SceneProgramInput;

    const visit1 = fakeCtx();
    renderScene(visit1.ctx, scene, 0, { visits: 1, act: 0 }, { drawCaptions: false });
    const visit2 = fakeCtx();
    renderScene(visit2.ctx, scene, 0, { visits: 2, act: 0 }, { drawCaptions: false });

    const drewClock = (calls: Call[]): boolean =>
      calls.some((c) => c.op === 'fillText' && c.args[0] === '12:00');
    // The clock slot is hidden on visit 1 and shown on visit 2 — a set object
    // changed relative to the previous visit.
    expect(drewClock(visit1.calls)).toBe(false);
    expect(drewClock(visit2.calls)).toBe(true);
  });

  it('is time-addressable: same inputs produce the same call sequence', () => {
    const program: SceneProgramInput = {
      id: 's',
      durationMs: 5000,
      layers: [
        { id: 'r', type: 'rect', x: 0, y: 0, w: 10, h: 10, colour: '#111' },
        { id: 'n', type: 'noise', intensity: 0.5 },
      ],
    };
    const a = fakeCtx();
    const b = fakeCtx();
    renderScene(a.ctx, program, 1234, vars, { drawCaptions: false });
    renderScene(b.ctx, program, 1234, vars, { drawCaptions: false });
    expect(a.calls).toEqual(b.calls);
  });
});

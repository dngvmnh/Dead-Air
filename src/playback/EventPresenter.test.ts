import { describe, expect, it, vi } from 'vitest';
import { EventPresenter } from './EventPresenter.ts';
import type { Ctx2D } from '../render/overlayRenderer.ts';
import type { SceneProgramInput } from '../content/schema.ts';

/**
 * The presenter must PUBLISH a picture for every event output — the regression
 * was that events drew nothing. We give it a fake canvas/context and assert it
 * calls `publish` with the canvas and records the drawn text for the test seam.
 */
interface Call {
  op: string;
  args: unknown[];
}

function fakeCanvas(): { ctx: Ctx2D; source: unknown; calls: Call[] } {
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
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textBaseline(_v: string) {},
    set textAlign(_v: string) {},
    set lineWidth(_v: number) {},
  } as unknown as Ctx2D;
  const source = { width: 960, height: 720, __fake: true };
  return { ctx, source, calls };
}

function makePresenter() {
  const made = fakeCanvas();
  const published: unknown[] = [];
  const statics: number[] = [];
  const presenter = new EventPresenter({
    createCanvas: () => ({ ctx: made.ctx, source: made.source }),
    publish: (s) => published.push(s),
    setStatic: (n) => statics.push(n),
    now: () => 0,
  });
  return { presenter, made, published, statics };
}

describe('EventPresenter', () => {
  it('repaints under each caption, so captions never stack on earlier ones', () => {
    const { presenter, made } = makePresenter();
    presenter.showSlate('YOU ARE STILL UP.');
    presenter.showCaption('A viewer in this broadcast area has not gone to bed.');
    made.calls.length = 0;
    presenter.showCaption('...Excuse me.');
    const ops = made.calls.map((c) => c.op);
    const firstText = ops.indexOf('fillText');
    expect(made.calls[0]).toEqual({ op: 'fillRect', args: [0, 0, 960, 720] });
    const texts = made.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    // The slate survives under the new caption, and the old caption is gone.
    expect(firstText).toBeGreaterThan(0);
    expect(texts).toContain('YOU ARE STILL UP.');
    expect(texts).toContain('...Excuse me.');
    expect(texts.join(' ')).not.toContain('not gone to bed');
  });

  it('publishes the canvas and records the drawn text for a slate', () => {
    const { presenter, made, published } = makePresenter();
    presenter.showSlate('UNAUTHORISED VIEWER DETECTED');
    expect(published.at(-1)).toBe(made.source);
    expect(made.calls.some((c) => c.op === 'fillText' && c.args[0] === 'UNAUTHORISED VIEWER DETECTED')).toBe(true);
    expect(presenter.lastText()).toContain('UNAUTHORISED VIEWER DETECTED');
  });

  it('publishes the canvas and records the caption for a voice/caption line', () => {
    const { presenter, made, published } = makePresenter();
    presenter.showCaption('there you are.');
    expect(published.at(-1)).toBe(made.source);
    expect(made.calls.some((c) => c.op === 'fillText' && c.args[0] === 'there you are.')).toBe(true);
    expect(presenter.lastText()).toContain('there you are.');
  });

  it('publishes the exact sign-off text and records it', () => {
    const { presenter, made, published } = makePresenter();
    presenter.showSignOff();
    expect(published.at(-1)).toBe(made.source);
    const drawn = made.calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(drawn).toEqual(['NO SIGNAL', 'THANK YOU FOR WATCHING.', 'BROADCAST TERMINATED · 00:00:13']);
    expect(presenter.lastText()).toContain('NO SIGNAL');
    expect(presenter.lastText()).toContain('BROADCAST TERMINATED · 00:00:13');
  });

  it('plays a scene for its duration, drawing frames and holding until time passes', async () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      const made = fakeCanvas();
      const published: unknown[] = [];
      const presenter = new EventPresenter({
        createCanvas: () => ({ ctx: made.ctx, source: made.source }),
        publish: (s) => published.push(s),
        setStatic: () => {},
        now: () => t,
      });
      const scene: SceneProgramInput = {
        id: 'ev',
        durationMs: 1000,
        layers: [{ id: 't', type: 'text', text: 'EVENT SCENE', x: 10, y: 10 }],
      };
      const done = presenter.playScene(scene, { visits: 1, act: 0 }, 400, true);
      // Advance fake time and clock so the scene plays for its 400ms duration.
      for (let i = 0; i < 10; i += 1) {
        t += 50;
        await vi.advanceTimersByTimeAsync(50);
      }
      await done;
      expect(published.length).toBeGreaterThan(0);
      expect(made.calls.some((c) => c.op === 'fillText' && c.args[0] === 'EVENT SCENE')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

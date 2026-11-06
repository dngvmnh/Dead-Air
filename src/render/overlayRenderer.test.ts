import { describe, expect, it } from 'vitest';
import {
  SIGN_OFF_LINES,
  drawSlate,
  drawCaptionsOverStatic,
  drawSignOff,
  drawStationCard,
  type Ctx2D,
} from './overlayRenderer.ts';

/**
 * jsdom has no real 2D context, so we record drawing calls against a fake
 * context and assert the sequence. These prove the event overlays actually
 * paint their text onto the picture (the regression: events only set the ARIA
 * region and static, never drew anything the shader could sample).
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
    fillText: rec('fillText'),
    set fillStyle(v: string) {
      calls.push({ op: 'fillStyle', args: [v] });
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
  } as unknown as Ctx2D;
  return { ctx, calls };
}

const texts = (calls: Call[]): string[] =>
  calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));

describe('overlayRenderer', () => {
  it('draws every line of a slate as text (splitting on newlines)', () => {
    const { ctx, calls } = fakeCtx();
    drawSlate(ctx, 'UNAUTHORISED VIEWER DETECTED\nLAST TUNED: CHANNEL 04', {
      width: 960,
      height: 720,
    });
    const drawn = texts(calls);
    expect(drawn).toContain('UNAUTHORISED VIEWER DETECTED');
    expect(drawn).toContain('LAST TUNED: CHANNEL 04');
  });

  it('fills an opaque base before drawing slate text', () => {
    const { ctx, calls } = fakeCtx();
    drawSlate(ctx, 'HELLO', { width: 100, height: 80 });
    const firstFill = calls.find((c) => c.op === 'fillRect');
    expect(firstFill?.args).toEqual([0, 0, 100, 80]);
  });

  it('draws a caption line over a static field', () => {
    const { ctx, calls } = fakeCtx();
    drawCaptionsOverStatic(ctx, 'there you are.', { width: 960, height: 720 });
    expect(texts(calls)).toContain('there you are.');
    // There is a base fill so the caption sits on a field, not transparent.
    expect(calls.some((c) => c.op === 'fillRect')).toBe(true);
  });

  it('draws the exact fixed sign-off wording from media-bible section 9', () => {
    const { ctx, calls } = fakeCtx();
    drawSignOff(ctx, { width: 960, height: 720 });
    const drawn = texts(calls);
    // Exactly the three non-blank lines, in order, with no extra label.
    expect(drawn).toEqual(['NO SIGNAL', 'THANK YOU FOR WATCHING.', 'BROADCAST TERMINATED · 00:00:13']);
    expect(SIGN_OFF_LINES).toEqual([
      'NO SIGNAL',
      '',
      'THANK YOU FOR WATCHING.',
      '',
      'BROADCAST TERMINATED · 00:00:13',
    ]);
  });

  it('sign-off text sits on a clean (opaque) picture', () => {
    const { ctx, calls } = fakeCtx();
    drawSignOff(ctx, { width: 960, height: 720 });
    const firstFill = calls.find((c) => c.op === 'fillRect');
    expect(firstFill?.args).toEqual([0, 0, 960, 720]);
  });

  it('draws a station card from the channel name on a filled field', () => {
    const { ctx, calls } = fakeCtx();
    drawStationCard(ctx, 'Dead Air', { width: 960, height: 720 });
    expect(calls.some((c) => c.op === 'fillRect' && JSON.stringify(c.args) === JSON.stringify([0, 0, 960, 720]))).toBe(true);
    expect(texts(calls)).toContain('Dead Air');
  });
});

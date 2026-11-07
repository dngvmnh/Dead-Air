import { describe, expect, it } from 'vitest';
import { eventLengthMs, isRoomOnly, keepsProgramme, nextStartleDelay } from './startle.ts';

describe('nextStartleDelay', () => {
  it('brings the first startle on quickly, then keeps them coming unevenly', () => {
    expect(nextStartleDelay(() => 0, false, true)).toBe(6_000);
    expect(nextStartleDelay(() => 1, false, true)).toBe(12_000);
    expect(nextStartleDelay(() => 0, false, false)).toBe(10_000);
    expect(nextStartleDelay(() => 1, false, false)).toBe(22_000);
  });

  it('runs faster still under demo mode', () => {
    expect(nextStartleDelay(() => 0, true, true)).toBe(4_000);
    expect(nextStartleDelay(() => 1, true, false)).toBe(14_000);
  });
});

describe('keepsProgramme', () => {
  it('lets a jump play over the programme, but not a picture step', () => {
    expect(keepsProgramme({ steps: [{ do: 'jump', kind: 'anchor', ms: 600 }] })).toBe(true);
    expect(keepsProgramme({ steps: [{ do: 'apparition', kind: 'anchor', ms: 600 }] })).toBe(false);
    expect(isRoomOnly({ steps: [{ do: 'jump', kind: 'anchor', ms: 600 }] })).toBe(false);
  });
});

describe('isRoomOnly', () => {
  it('is true only when no step touches the picture', () => {
    expect(isRoomOnly({ steps: [{ do: 'sfx', cue: 'knock' }, { do: 'roomLights', level: 0.5, ms: 300 }] })).toBe(true);
    expect(isRoomOnly({ steps: [{ do: 'sfx', cue: 'knock' }, { do: 'static', ms: 300 }] })).toBe(false);
  });
});

describe('eventLengthMs', () => {
  it('adds what blocks and ignores a sound with no wait', () => {
    expect(
      eventLengthMs({
        steps: [
          { do: 'sfx', cue: 'stinger' },
          { do: 'sfx', cue: 'toyPiano', ms: 1000 },
          { do: 'apparition', kind: 'gourd', ms: 2000 },
          { do: 'voice', caption: 'hello' },
        ],
      }),
    ).toBe(4800);
  });

  it('treats a scene as unbounded', () => {
    expect(eventLengthMs({ steps: [{ do: 'scene', sceneId: 'x' }] })).toBe(Number.POSITIVE_INFINITY);
  });
});

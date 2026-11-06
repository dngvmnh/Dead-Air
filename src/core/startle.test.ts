import { describe, expect, it } from 'vitest';
import { eventLengthMs, isRoomOnly, nextStartleDelay } from './startle.ts';

describe('nextStartleDelay', () => {
  it('holds the first startle back, then spaces the rest widely', () => {
    expect(nextStartleDelay(() => 0, false, true)).toBe(45_000);
    expect(nextStartleDelay(() => 1, false, true)).toBe(90_000);
    expect(nextStartleDelay(() => 0, false, false)).toBe(60_000);
    expect(nextStartleDelay(() => 1, false, false)).toBe(180_000);
  });

  it('has its own range under demo mode, first or not', () => {
    for (const first of [true, false]) {
      expect(nextStartleDelay(() => 0, true, first)).toBe(15_000);
      expect(nextStartleDelay(() => 1, true, first)).toBe(35_000);
    }
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

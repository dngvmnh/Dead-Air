import { describe, expect, it } from 'vitest';
import { deriveRoom, type RoomInput } from './roomState.ts';
import { createMemory, type ViewerMemory } from './memory.ts';
import type { TvPhase } from './tvMachine.ts';

/**
 * `deriveRoom` is pure (design §5): memory + context in, a RoomState out. No
 * DOM, no Date.now, no Math.random. These lock the act-driven ambient fall, the
 * picture-light wiring, and the YouTube/off cases.
 */

function input(over: Partial<RoomInput> = {}): RoomInput {
  return {
    memory: createMemory(0),
    phase: 'ON_AIR' as TvPhase,
    picture: { r: 120, g: 100, b: 90 },
    localHour: 23,
    localMinute: 7,
    reduced: false,
    ...over,
  };
}

function atAct(act: number): ViewerMemory {
  return { ...createMemory(0), act: act as ViewerMemory['act'] };
}

describe('deriveRoom', () => {
  it('ambient light decreases as the act rises (requirement 5.4)', () => {
    const a0 = deriveRoom(input({ memory: atAct(0) })).ambient;
    const a1 = deriveRoom(input({ memory: atAct(1) })).ambient;
    const a2 = deriveRoom(input({ memory: atAct(2) })).ambient;
    const a3 = deriveRoom(input({ memory: atAct(3) })).ambient;
    const a4 = deriveRoom(input({ memory: atAct(4) })).ambient;
    expect(a0).toBeGreaterThan(a1);
    expect(a1).toBeGreaterThan(a2);
    expect(a2).toBeGreaterThan(a3);
    expect(a3).toBeGreaterThanOrEqual(a4);
    // Ambient stays in [0,1] and never pitch black (some light remains).
    for (const a of [a0, a1, a2, a3, a4]) {
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('lights the room from the picture colour while an owned source plays (5.2)', () => {
    const lit = deriveRoom(input({ picture: { r: 200, g: 40, b: 40 } }));
    expect(lit.tvLight.amount).toBeGreaterThan(0);
    // The tint carries the picture's dominant red.
    expect(lit.tvLight.r).toBeGreaterThan(lit.tvLight.b);
  });

  it('uses a soft neutral light for YouTube/off (picture null), never the player (5.3)', () => {
    const yt = deriveRoom(input({ picture: null }));
    // No picture sampled: the light is neutral (r≈g≈b) and low.
    expect(Math.abs(yt.tvLight.r - yt.tvLight.g)).toBeLessThan(20);
    expect(Math.abs(yt.tvLight.g - yt.tvLight.b)).toBeLessThan(20);
  });

  it('no TV light when the set is off', () => {
    const off = deriveRoom(input({ phase: 'OFF' as TvPhase, picture: null }));
    expect(off.tvLight.amount).toBe(0);
  });

  it('exposes figureStep, objectVariant and repairVisible from memory', () => {
    const mem = { ...createMemory(0), act: 2 as ViewerMemory['act'], sessionCount: 2 };
    const s = deriveRoom(input({ memory: mem }));
    expect(typeof s.figureStep).toBe('number');
    expect(typeof s.objectVariant).toBe('number');
    expect(typeof s.repairVisible).toBe('boolean');
    // A returning viewer (session ≥ 2) in Act 2+ sees repaired tears (req 4.2).
    expect(s.repairVisible).toBe(true);
  });

  it('is pure: same input gives the same state', () => {
    const i = input({ memory: atAct(2) });
    expect(deriveRoom(i)).toEqual(deriveRoom(i));
  });
});

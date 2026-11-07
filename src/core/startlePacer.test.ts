import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ACTION_STREAK_LIMIT,
  CAP,
  initialPacer,
  MIN_GAP_MS,
  pacerAct,
  pacerFired,
  pacerTick,
  type PacerAction,
  type PacerState,
} from './startlePacer.ts';

const ctx = (now: number, r = 0.5, demo = false) => ({
  now,
  random: () => r,
  demo,
});

/** Tick until the startle is due and waiting for the viewer. */
function armAt(now: number): { state: PacerState; now: number } {
  let s = pacerTick(initialPacer(), ctx(now)).state;
  now = s.dueAt!;
  s = pacerTick(s, ctx(now)).state;
  return { state: s, now };
}

describe('startle pacer', () => {
  it('waits for the viewer once due, and lands on their click', () => {
    const { state, now } = armAt(0);
    expect(state.armedUntil).not.toBeNull();
    expect(pacerTick(state, ctx(now + 500)).fireInMs).toBeNull();
    const d = pacerAct(state, 'press', ctx(now + 800));
    expect(d.fireInMs).toBeLessThan(100);
  });

  it('comes anyway if the viewer keeps still', () => {
    const { state } = armAt(0);
    expect(pacerTick(state, ctx(state.armedUntil!)).fireInMs).toBe(0);
  });

  it('waits for the new picture on a tune, and a breath after a tear', () => {
    const { state, now } = armAt(0);
    expect(pacerAct(state, 'tune', ctx(now + 100)).fireInMs).toBe(700);
    expect(pacerAct(state, 'tear', ctx(now + 100, 0.99)).fireInMs).toBe(250);
  });

  it('after two set off by the viewer, the next does not wait for them', () => {
    let { state, now } = armAt(0);
    for (let i = 0; i < ACTION_STREAK_LIMIT; i += 1) {
      state = pacerFired(state, ctx(now), true);
      now = state.dueAt!;
      state = pacerTick(state, ctx(now)).state;
      if (i < ACTION_STREAK_LIMIT - 1) expect(state.armedUntil).not.toBeNull();
    }
    state = pacerFired(state, ctx(now), true);
    now = state.dueAt!;
    expect(pacerTick(state, ctx(now)).fireInMs).toBe(0);
  });

  it('the first tear answers, later ones only sometimes', () => {
    const s = { ...initialPacer(), dueAt: 1e9 };
    expect(pacerAct(s, 'tear', ctx(60_000, 0.99)).fireInMs).not.toBeNull();
    const second = { ...s, tears: 1 };
    expect(pacerAct(second, 'tear', ctx(60_000, 0.99)).fireInMs).toBeNull();
    expect(pacerAct(second, 'tear', ctx(60_000, 0.1)).fireInMs).not.toBeNull();
  });

  it('two channel landings bring one on; one does not', () => {
    const s = { ...initialPacer(), dueAt: 1e9 };
    const one = pacerAct(s, 'tune', ctx(60_000));
    expect(one.fireInMs).toBeNull();
    expect(pacerAct(one.state, 'tune', ctx(61_000)).fireInMs).toBe(700);
  });

  it('a press between due times is rare, and never right after one', () => {
    const fresh = pacerFired({ ...initialPacer(), dueAt: 1e9 }, ctx(100_000), false);
    const quiet = { ...fresh, dueAt: 1e9 };
    expect(pacerAct(quiet, 'press', ctx(100_000 + MIN_GAP_MS + 100, 0)).fireInMs).not.toBeNull();
    expect(pacerAct(quiet, 'press', ctx(100_000 + 3000, 0)).fireInMs).toBeNull();
    expect(pacerAct(quiet, 'press', ctx(100_000 + MIN_GAP_MS + 60_000, 0.5)).fireInMs).toBeNull();
  });

  it('whatever the viewer does: never two within the gap, never more than the cap a minute, and stillness still gets them', () => {
    const actions: PacerAction[] = ['press', 'tune', 'tear'];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dt: fc.integer({ min: 50, max: 4000 }),
            act: fc.integer({ min: -3, max: 2 }),
            r: fc.double({ min: 0, max: 0.999, noNaN: true }),
          }),
          {
            minLength: 50,
            maxLength: 400,
          },
        ),
        (steps) => {
          let s = initialPacer();
          let now = 0;
          const fired: number[] = [];
          const fire = (byViewer: boolean, r: number) => {
            s = pacerFired(s, ctx(now, r), byViewer);
            fired.push(now);
          };
          for (const step of steps) {
            now += step.dt;
            const t = pacerTick(s, ctx(now, step.r));
            s = t.state;
            if (t.fireInMs === 0) fire(false, step.r);
            if (step.act >= 0) {
              const d = pacerAct(s, actions[step.act]!, ctx(now, step.r));
              s = d.state;
              if (d.fireInMs !== null) fire(true, step.r);
            }
          }
          for (let i = 1; i < fired.length; i += 1) expect(fired[i]! - fired[i - 1]!).toBeGreaterThanOrEqual(MIN_GAP_MS);
          for (const t of fired) expect(fired.filter((u) => u >= t && u - t < 60_000).length).toBeLessThanOrEqual(CAP);
        },
      ),
    );
  });

  it('a viewer who never touches anything still gets one every half minute or so', () => {
    let s = initialPacer();
    let fired = 0;
    for (let now = 0; now < 300_000; now += 500) {
      const t = pacerTick(s, ctx(now, 0.5));
      s = t.state;
      if (t.fireInMs === 0) {
        s = pacerFired(s, ctx(now, 0.5), false);
        fired += 1;
      }
    }
    expect(fired).toBeGreaterThanOrEqual(10);
    expect(fired).toBeLessThanOrEqual(20);
  });
});

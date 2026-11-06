import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHANNEL,
  initialTvState,
  tvReducer,
  type Effect,
  type TvAction,
  type TvPhase,
  type TvState,
} from './tvMachine.ts';
import { type ChannelId } from './types.ts';

/** Drive the reducer through a sequence of actions, returning the final result. */
function run(start: TvState, actions: TvAction[]): { state: TvState; effects: Effect[] } {
  let state = start;
  let effects: Effect[] = [];
  for (const action of actions) {
    const result = tvReducer(state, action);
    state = result.state;
    effects = result.effects;
  }
  return { state, effects };
}

function effectTypes(effects: Effect[]): string[] {
  return effects.map((e) => e.type);
}

/** A powered-on, booted state tuned to a channel and on air. */
function onAir(channel: ChannelId = 2): TvState {
  let state = initialTvState({ noticeSeen: true });
  state = tvReducer(state, { type: 'POWER' }).state;
  state = tvReducer(state, { type: 'BOOT_DONE' }).state;
  state = tvReducer(state, { type: 'SET_CHANNEL', channel }).state;
  state = tvReducer(state, {
    type: 'TUNE_RESOLVED',
    token: state.tuneToken,
    playable: true,
  }).state;
  return state;
}

/** A state showing the sign-off text on channel 13. */
function signingOff(): TvState {
  let s = onAir(13);
  s = tvReducer(s, { type: 'EVENT_START', token: s.tuneToken, seam: 'item-boundary' }).state;
  return tvReducer(s, { type: 'SIGN_OFF_START', token: s.tuneToken, eventId: 'E10' }).state;
}

describe('initial state', () => {
  it('starts OFF with no channel and notice unseen', () => {
    const s = initialTvState();
    expect(s.phase).toBe('OFF');
    expect(s.channel).toBeNull();
    expect(s.noticeSeen).toBe(false);
    expect(s.afterHours).toBe(false);
  });

  it('can be seeded with a last channel and notice seen', () => {
    const s = initialTvState({ noticeSeen: true, lastChannel: 7 });
    expect(s.channel).toBe(7);
    expect(s.noticeSeen).toBe(true);
  });
});

describe('power on', () => {
  it('does nothing when the notice has not been seen', () => {
    const s = initialTvState({ noticeSeen: false });
    const r = tvReducer(s, { type: 'POWER' });
    expect(r.state.phase).toBe('OFF');
    expect(r.effects).toHaveLength(0);
  });

  it('boots once the notice is acknowledged', () => {
    let s = initialTvState();
    s = tvReducer(s, { type: 'ACK_NOTICE' }).state;
    const r = tvReducer(s, { type: 'POWER' });
    expect(r.state.phase).toBe('BOOTING');
    expect(effectTypes(r.effects)).toEqual(['unlockAudio', 'startBoot']);
  });

  it('tunes to the last channel after boot, or 02 if none', () => {
    const fresh = run(initialTvState({ noticeSeen: true }), [
      { type: 'POWER' },
      { type: 'BOOT_DONE' },
    ]);
    expect(fresh.state.phase).toBe('TUNING');
    expect(fresh.state.channel).toBe(DEFAULT_CHANNEL);

    const returning = run(initialTvState({ noticeSeen: true, lastChannel: 13 }), [
      { type: 'POWER' },
      { type: 'BOOT_DONE' },
    ]);
    expect(returning.state.channel).toBe(13);
  });

  it('starts tuning with a fresh token, static, and a channel announcement', () => {
    const r = run(initialTvState({ noticeSeen: true }), [
      { type: 'POWER' },
      { type: 'BOOT_DONE' },
    ]);
    expect(effectTypes(r.effects)).toEqual(['stopAll', 'startTuning', 'announceChannel']);
    expect(r.state.tuneToken).toBeGreaterThan(0);
  });
});

describe('channel surfing', () => {
  it('CH+ cycles 02 -> 04 -> 07 -> 13 -> 02', () => {
    let s = onAir(2);
    const seen: (ChannelId | null)[] = [s.channel];
    for (let i = 0; i < 4; i++) {
      s = tvReducer(s, { type: 'CHANNEL_UP' }).state;
      seen.push(s.channel);
      s = tvReducer(s, { type: 'TUNE_RESOLVED', token: s.tuneToken, playable: true }).state;
    }
    expect(seen).toEqual([2, 4, 7, 13, 2]);
  });

  it('CH- cycles 02 -> 13 -> 07 -> 04 -> 02', () => {
    let s = onAir(2);
    const seen: (ChannelId | null)[] = [s.channel];
    for (let i = 0; i < 4; i++) {
      s = tvReducer(s, { type: 'CHANNEL_DOWN' }).state;
      seen.push(s.channel);
      s = tvReducer(s, { type: 'TUNE_RESOLVED', token: s.tuneToken, playable: true }).state;
    }
    expect(seen).toEqual([2, 13, 7, 4, 2]);
  });

  it('surfing is ignored while OFF, BOOTING, and SIGN_OFF', () => {
    const off = tvReducer(initialTvState({ noticeSeen: true }), { type: 'CHANNEL_UP' });
    expect(off.state.phase).toBe('OFF');
    expect(off.effects).toHaveLength(0);

    const booting = run(initialTvState({ noticeSeen: true }), [{ type: 'POWER' }]);
    const b = tvReducer(booting.state, { type: 'CHANNEL_UP' });
    expect(b.state.phase).toBe('BOOTING');
    expect(b.effects).toHaveLength(0);

    const signOff = tvReducer(signingOff(), { type: 'CHANNEL_UP' });
    expect(signOff.state.phase).toBe('SIGN_OFF');
    expect(signOff.effects).toHaveLength(0);
  });

  it('surfing from EVENT is honoured so the viewer can always leave', () => {
    let s = onAir(2);
    s = tvReducer(s, {
      type: 'EVENT_START',
      token: s.tuneToken,
      seam: 'item-boundary',
    }).state;
    expect(s.phase).toBe('EVENT');
    const r = tvReducer(s, { type: 'CHANNEL_UP' });
    expect(r.state.phase).toBe('TUNING');
    expect(r.state.channel).toBe(4);
  });

  it('surfing from STAND_BY tunes away', () => {
    let s = onAir(2);
    s = tvReducer(s, { type: 'CHANNEL_UP' }).state;
    s = tvReducer(s, { type: 'TUNE_RESOLVED', token: s.tuneToken, playable: false }).state;
    expect(s.phase).toBe('STAND_BY');
    const r = tvReducer(s, { type: 'CHANNEL_UP' });
    expect(r.state.phase).toBe('TUNING');
  });
});

describe('rapid surfing keeps only the final channel', () => {
  it('bumps the token each press and discards stale resolutions', () => {
    let s = onAir(2);
    // Three quick presses: 04, 07, 13. Only the last should load.
    s = tvReducer(s, { type: 'CHANNEL_UP' }).state; // -> 04
    const staleToken = s.tuneToken;
    s = tvReducer(s, { type: 'CHANNEL_UP' }).state; // -> 07
    s = tvReducer(s, { type: 'CHANNEL_UP' }).state; // -> 13
    const liveToken = s.tuneToken;

    expect(s.channel).toBe(13);
    expect(s.phase).toBe('TUNING');
    expect(liveToken).toBeGreaterThan(staleToken);

    // A late resolution from the stale 04 tune must be ignored.
    const stale = tvReducer(s, { type: 'TUNE_RESOLVED', token: staleToken, playable: true });
    expect(stale.state.phase).toBe('TUNING');
    expect(stale.effects).toHaveLength(0);

    // The live resolution loads channel 13.
    const live = tvReducer(s, { type: 'TUNE_RESOLVED', token: liveToken, playable: true });
    expect(live.state.phase).toBe('ON_AIR');
    expect(effectTypes(live.effects)).toContain('startSource');
  });
});

describe('item lifecycle and events', () => {
  it('re-resolves when an item ends', () => {
    const s = onAir(2);
    const r = tvReducer(s, { type: 'ITEM_ENDED', token: s.tuneToken });
    expect(r.state.phase).toBe('ON_AIR');
    expect(effectTypes(r.effects)).toEqual(['reResolve']);
  });

  it('ignores ITEM_ENDED with a stale token', () => {
    const s = onAir(2);
    const r = tvReducer(s, { type: 'ITEM_ENDED', token: s.tuneToken - 1 });
    expect(r.effects).toHaveLength(0);
  });

  it('runs a normal event then resumes via re-resolve', () => {
    let s = onAir(2);
    const start = tvReducer(s, {
      type: 'EVENT_START',
      token: s.tuneToken,
      seam: 'item-boundary',
    });
    expect(start.state.phase).toBe('EVENT');
    expect(effectTypes(start.effects)).toEqual(['runEvent']);
    s = start.state;
    const done = tvReducer(s, { type: 'EVENT_DONE', token: s.tuneToken });
    expect(done.state.phase).toBe('ON_AIR');
    expect(effectTypes(done.effects)).toEqual(['reResolve']);
  });

  it('fires a tune-in event straight from TUNING', () => {
    let s = onAir(2);
    s = tvReducer(s, { type: 'CHANNEL_UP' }).state; // TUNING
    const r = tvReducer(s, {
      type: 'EVENT_START',
      token: s.tuneToken,
      seam: 'tune-in',
    });
    expect(r.state.phase).toBe('EVENT');
  });

  it('moves to STAND_BY when a re-resolve on air finds nothing playable', () => {
    const s = onAir(2);
    const r = tvReducer(s, { type: 'NOTHING_PLAYABLE', token: s.tuneToken });
    expect(r.state.phase).toBe('STAND_BY');
    expect(effectTypes(r.effects)).toEqual(['stopAll', 'standBy']);
  });

  it('ignores NOTHING_PLAYABLE with a stale token', () => {
    const s = onAir(2);
    const r = tvReducer(s, { type: 'NOTHING_PLAYABLE', token: s.tuneToken - 1 });
    expect(r.state.phase).toBe('ON_AIR');
    expect(r.effects).toHaveLength(0);
  });
});

describe('sign-off and after hours', () => {
  it('shows the fixed text when the event reaches its sign-off step', () => {
    let s = onAir(13);
    s = tvReducer(s, { type: 'EVENT_START', token: s.tuneToken, seam: 'item-boundary' }).state;
    expect(s.phase).toBe('EVENT');
    const r = tvReducer(s, { type: 'SIGN_OFF_START', token: s.tuneToken, eventId: 'E10' });
    expect(r.state.phase).toBe('SIGN_OFF');
    expect(effectTypes(r.effects)).toEqual(['signOffText']);
    // The sign-off effect carries the event id so the orchestrator records E10
    // as fired only now, on reaching SIGN_OFF (design §7).
    const signOff = r.effects.find((e) => e.type === 'signOffText');
    expect(signOff && 'eventId' in signOff ? signOff.eventId : null).toBe('E10');
  });

  it('ignores SIGN_OFF_START outside an event', () => {
    const s = onAir(13);
    const r = tvReducer(s, { type: 'SIGN_OFF_START', token: s.tuneToken, eventId: 'E10' });
    expect(r.state.phase).toBe('ON_AIR');
    expect(r.effects).toHaveLength(0);
  });

  it('completing sign-off powers off and sets after hours', () => {
    const r = tvReducer(signingOff(), { type: 'SIGN_OFF_COMPLETE' });
    expect(r.state.phase).toBe('OFF');
    expect(r.state.afterHours).toBe(true);
    expect(effectTypes(r.effects)).toEqual(['powerOff', 'setAfterHours']);
  });

  it('POWER during the sign-off text still sets after hours', () => {
    const r = tvReducer(signingOff(), { type: 'POWER' });
    expect(r.state.phase).toBe('OFF');
    expect(r.state.afterHours).toBe(true);
    expect(effectTypes(r.effects)).toEqual(['stopAll', 'powerOff', 'setAfterHours']);
  });
});

describe('POWER from every state', () => {
  const states: { name: TvPhase; build: () => TvState }[] = [
    { name: 'OFF', build: () => initialTvState({ noticeSeen: true }) },
    { name: 'BOOTING', build: () => run(initialTvState({ noticeSeen: true }), [{ type: 'POWER' }]).state },
    {
      name: 'TUNING',
      build: () => {
        let s = onAir(2);
        s = tvReducer(s, { type: 'CHANNEL_UP' }).state;
        return s;
      },
    },
    { name: 'ON_AIR', build: () => onAir(2) },
    {
      name: 'EVENT',
      build: () => {
        const s = onAir(2);
        return tvReducer(s, {
          type: 'EVENT_START',
          token: s.tuneToken,
          seam: 'item-boundary',
        }).state;
      },
    },
    {
      name: 'STAND_BY',
      build: () => {
        let s = onAir(2);
        s = tvReducer(s, { type: 'CHANNEL_UP' }).state;
        return tvReducer(s, { type: 'TUNE_RESOLVED', token: s.tuneToken, playable: false }).state;
      },
    },
  ];

  it('powers off from SIGN_OFF', () => {
    expect(tvReducer(signingOff(), { type: 'POWER' }).state.phase).toBe('OFF');
  });

  for (const { name, build } of states) {
    it(`powers off from ${name}`, () => {
      const s = build();
      if (name === 'OFF') {
        // From OFF, POWER boots instead of powering off.
        const r = tvReducer(s, { type: 'POWER' });
        expect(r.state.phase).toBe('BOOTING');
        return;
      }
      const r = tvReducer(s, { type: 'POWER' });
      expect(r.state.phase).toBe('OFF');
      expect(effectTypes(r.effects)).toEqual(['stopAll', 'powerOff']);
    });
  }
});

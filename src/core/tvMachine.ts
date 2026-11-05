/**
 * TV state machine (design.md §7).
 *
 * A pure reducer: given a state and an action, it returns the next state plus
 * a list of effect descriptions. It never performs effects itself — no timers,
 * no DOM, no playback. `useTelevision` interprets the effects.
 *
 * Each tune carries a token. Results from an older token are discarded by the
 * orchestrator, so rapid surfing cannot start a stale source.
 */

import { CHANNEL_CYCLE, type ChannelId, type Seam } from './types.ts';

export type TvPhase =
  | 'OFF'
  | 'BOOTING'
  | 'TUNING'
  | 'ON_AIR'
  | 'EVENT'
  | 'STAND_BY'
  | 'SIGN_OFF';

export interface TvState {
  phase: TvPhase;
  /** Channel currently selected. Null only before the first power-on. */
  channel: ChannelId | null;
  /** Monotonic token identifying the latest tune request. */
  tuneToken: number;
  /** Whether the first-run content notice has been acknowledged. */
  noticeSeen: boolean;
  /** Act 4 unlocks after-hours programming. */
  afterHours: boolean;
}

export type TvAction =
  | { type: 'ACK_NOTICE' }
  | { type: 'POWER' }
  | { type: 'BOOT_DONE' }
  | { type: 'CHANNEL_UP' }
  | { type: 'CHANNEL_DOWN' }
  | { type: 'SET_CHANNEL'; channel: ChannelId }
  /** Tuning static has elapsed; the orchestrator resolved the clock. */
  | { type: 'TUNE_RESOLVED'; token: number; playable: boolean }
  /** A director seam picked an event. */
  | { type: 'EVENT_START'; token: number; seam: Seam }
  | { type: 'EVENT_DONE'; token: number }
  /** The current item finished; re-resolve for the next one. */
  | { type: 'ITEM_ENDED'; token: number }
  /** A re-resolve while on air found no playable item. */
  | { type: 'NOTHING_PLAYABLE'; token: number }
  /** The running event reached its signOff step: cut to the fixed text. */
  | { type: 'SIGN_OFF_START'; token: number }
  /** The sign-off fixed text has been shown long enough. */
  | { type: 'SIGN_OFF_COMPLETE' };

export type Effect =
  | { type: 'unlockAudio' }
  | { type: 'startBoot' }
  | { type: 'startTuning'; channel: ChannelId; token: number }
  | { type: 'startSource'; channel: ChannelId; token: number }
  | { type: 'standBy'; channel: ChannelId }
  | { type: 'runEvent'; token: number }
  | { type: 'reResolve'; channel: ChannelId; token: number }
  | { type: 'stopAll' }
  | { type: 'powerOff' }
  | { type: 'signOffText' }
  | { type: 'setAfterHours' }
  | { type: 'announceChannel'; channel: ChannelId };

export interface TvResult {
  state: TvState;
  effects: Effect[];
}

export const DEFAULT_CHANNEL: ChannelId = 2;

export function initialTvState(input?: {
  noticeSeen?: boolean;
  lastChannel?: ChannelId | null;
  afterHours?: boolean;
}): TvState {
  return {
    phase: 'OFF',
    channel: input?.lastChannel ?? null,
    tuneToken: 0,
    noticeSeen: input?.noticeSeen ?? false,
    afterHours: input?.afterHours ?? false,
  };
}

function nextChannel(current: ChannelId | null, direction: 1 | -1): ChannelId {
  const cycle = CHANNEL_CYCLE;
  const start = current ?? DEFAULT_CHANNEL;
  const idx = cycle.indexOf(start);
  const safeIdx = idx === -1 ? 0 : idx;
  const len = cycle.length;
  const nextIdx = (safeIdx + direction + len) % len;
  // CHANNEL_CYCLE is a fixed non-empty tuple; this index is always valid.
  return cycle[nextIdx] as ChannelId;
}

/** Begin tuning to a channel: bump the token, play static, announce. */
function beginTune(state: TvState, channel: ChannelId): TvResult {
  const token = state.tuneToken + 1;
  return {
    state: { ...state, phase: 'TUNING', channel, tuneToken: token },
    effects: [
      { type: 'stopAll' },
      { type: 'startTuning', channel, token },
      { type: 'announceChannel', channel },
    ],
  };
}

function powerOff(state: TvState): TvResult {
  return {
    state: { ...state, phase: 'OFF', tuneToken: state.tuneToken + 1 },
    effects: [{ type: 'stopAll' }, { type: 'powerOff' }],
  };
}

function completeSignOff(state: TvState, before: Effect[] = []): TvResult {
  return {
    state: { ...state, phase: 'OFF', afterHours: true, tuneToken: state.tuneToken + 1 },
    effects: [...before, { type: 'powerOff' }, { type: 'setAfterHours' }],
  };
}

const noChange = (state: TvState): TvResult => ({ state, effects: [] });

export function tvReducer(state: TvState, action: TvAction): TvResult {
  switch (action.type) {
    case 'ACK_NOTICE':
      return { state: { ...state, noticeSeen: true }, effects: [] };

    case 'POWER': {
      if (state.phase === 'OFF') {
        // Can't power on until the content notice is acknowledged.
        if (!state.noticeSeen) return noChange(state);
        return {
          state: { ...state, phase: 'BOOTING' },
          effects: [{ type: 'unlockAudio' }, { type: 'startBoot' }],
        };
      }
      // Pressing POWER on the sign-off text still completes it. Otherwise the
      // viewer would stay in Act 3 forever, because the sign-off fires only once.
      if (state.phase === 'SIGN_OFF') return completeSignOff(state, [{ type: 'stopAll' }]);
      return powerOff(state);
    }

    case 'BOOT_DONE': {
      if (state.phase !== 'BOOTING') return noChange(state);
      const channel = state.channel ?? DEFAULT_CHANNEL;
      return beginTune(state, channel);
    }

    case 'CHANNEL_UP':
    case 'CHANNEL_DOWN': {
      // Ignored while off, booting, or during the terminal sign-off.
      if (state.phase === 'OFF' || state.phase === 'BOOTING' || state.phase === 'SIGN_OFF') {
        return noChange(state);
      }
      const dir = action.type === 'CHANNEL_UP' ? 1 : -1;
      return beginTune(state, nextChannel(state.channel, dir));
    }

    case 'SET_CHANNEL': {
      if (state.phase === 'OFF' || state.phase === 'BOOTING' || state.phase === 'SIGN_OFF') {
        return noChange(state);
      }
      return beginTune(state, action.channel);
    }

    case 'TUNE_RESOLVED': {
      // Stale token: a newer tune superseded this one. Discard.
      if (action.token !== state.tuneToken || state.phase !== 'TUNING') {
        return noChange(state);
      }
      const channel = state.channel ?? DEFAULT_CHANNEL;
      if (!action.playable) {
        return {
          state: { ...state, phase: 'STAND_BY' },
          effects: [{ type: 'standBy', channel }],
        };
      }
      return {
        state: { ...state, phase: 'ON_AIR' },
        effects: [{ type: 'startSource', channel, token: action.token }],
      };
    }

    case 'EVENT_START': {
      if (action.token !== state.tuneToken) return noChange(state);
      // Events fire from TUNING (tune-in) or ON_AIR (item-boundary / mid-item).
      if (state.phase !== 'TUNING' && state.phase !== 'ON_AIR') return noChange(state);
      return {
        state: { ...state, phase: 'EVENT' },
        effects: [{ type: 'runEvent', token: action.token }],
      };
    }

    case 'SIGN_OFF_START': {
      if (action.token !== state.tuneToken || state.phase !== 'EVENT') return noChange(state);
      return {
        state: { ...state, phase: 'SIGN_OFF' },
        effects: [{ type: 'signOffText' }],
      };
    }

    case 'EVENT_DONE': {
      if (action.token !== state.tuneToken || state.phase !== 'EVENT') return noChange(state);
      const channel = state.channel ?? DEFAULT_CHANNEL;
      // Finished: re-resolve the clock and resume the current programme.
      return {
        state: { ...state, phase: 'ON_AIR' },
        effects: [{ type: 'reResolve', channel, token: action.token }],
      };
    }

    case 'ITEM_ENDED': {
      if (action.token !== state.tuneToken || state.phase !== 'ON_AIR') return noChange(state);
      const channel = state.channel ?? DEFAULT_CHANNEL;
      return {
        state,
        effects: [{ type: 'reResolve', channel, token: action.token }],
      };
    }

    case 'NOTHING_PLAYABLE': {
      if (action.token !== state.tuneToken || state.phase !== 'ON_AIR') return noChange(state);
      const channel = state.channel ?? DEFAULT_CHANNEL;
      return {
        state: { ...state, phase: 'STAND_BY' },
        effects: [{ type: 'stopAll' }, { type: 'standBy', channel }],
      };
    }

    case 'SIGN_OFF_COMPLETE': {
      if (state.phase !== 'SIGN_OFF') return noChange(state);
      return completeSignOff(state);
    }

    default:
      return noChange(state);
  }
}

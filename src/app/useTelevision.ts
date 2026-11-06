import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  initialTvState,
  tvReducer,
  type Effect,
  type TvAction,
  type TvState,
} from '../core/tvMachine.ts';
import { type ChannelId } from '../core/types.ts';
import { channelInfo } from '../core/channels.ts';
import { BOOT_MS, TUNE_MS } from './timing.ts';
import { AudioEngine } from '../audio/AudioEngine.ts';

/**
 * Milestone 1 orchestrator.
 *
 * Runs the pure TV state machine and interprets the subset of effects that the
 * chassis needs now: boot and tuning timers, and audio unlock. The broadcast
 * clock, horror director and playback adapters arrive in later milestones; until
 * then a tune resolves to "on air" against procedural static so every control is
 * demonstrable end to end.
 */

export interface UiSettings {
  /** 0..1 */
  volume: number;
  muted: boolean;
  captions: boolean;
  reducedEffects: boolean;
}

export interface TelevisionApi {
  state: TvState;
  settings: UiSettings;
  /** Human-readable announcement for the ARIA live region. */
  announcement: string;
  power: () => void;
  channelUp: () => void;
  channelDown: () => void;
  setChannel: (channel: ChannelId) => void;
  acknowledgeNotice: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleCaptions: () => void;
  toggleReducedEffects: () => void;
  forgetMe: () => void;
}

const DEFAULT_SETTINGS: UiSettings = {
  volume: 0.7,
  muted: false,
  captions: false,
  reducedEffects: false,
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useTelevision(): TelevisionApi {
  const [state, setState] = useState<TvState>(() => initialTvState());
  const [settings, setSettings] = useState<UiSettings>(() => ({
    ...DEFAULT_SETTINGS,
    reducedEffects: prefersReducedMotion(),
  }));
  const [announcement, setAnnouncement] = useState('');

  // Effects must be computed from the latest committed state. This ref tracks
  // it so a sequence of actions across separate renders (e.g. rapid surfing)
  // never computes effects from a stale closure.
  const stateRef = useRef(state);

  // Timers keyed so a newer transition cancels a pending one.
  const bootTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tuneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The procedural audio engine. Created lazily on the POWER gesture (browsers
  // block audio before a user gesture); null until then.
  const audioRef = useRef<AudioEngine | null>(null);
  const getAudio = useCallback((): AudioEngine => {
    if (!audioRef.current) {
      audioRef.current = new AudioEngine();
      // Test seam: expose the engine so a browser test can assert the context
      // unlocked on the POWER gesture. Production never sets this flag.
      if (
        typeof window !== 'undefined' &&
        (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean })
          .__CRT_PRESERVE_DRAWING_BUFFER__ === true
      ) {
        (window as unknown as { __tvAudio?: AudioEngine }).__tvAudio = audioRef.current;
      }
    }
    return audioRef.current;
  }, []);

  // Latest settings, readable from async callbacks (e.g. audio unlock) without
  // recreating them on every settings change. Assigned in an effect (not during
  // render) and used to keep the audio engine's volume/mute in sync.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    const audio = audioRef.current;
    if (audio) {
      audio.setVolume(settings.volume);
      audio.setMuted(settings.muted);
    }
  }, [settings]);

  const clearTimers = useCallback(() => {
    if (bootTimer.current !== null) {
      clearTimeout(bootTimer.current);
      bootTimer.current = null;
    }
    if (tuneTimer.current !== null) {
      clearTimeout(tuneTimer.current);
      tuneTimer.current = null;
    }
  }, []);

  // Lets timer callbacks and effects dispatch follow-up actions without a
  // forward-reference problem. Assigned once below.
  const sendRef = useRef<(action: TvAction) => void>(() => {});

  const runEffects = useCallback(
    (effects: Effect[]) => {
      for (const effect of effects) {
        switch (effect.type) {
          case 'unlockAudio': {
            // POWER gesture: unlock the context, then play the boot cue once it
            // is running. Volume/mute are applied from the current settings.
            // Audio is non-critical: if Web Audio is unavailable (e.g. jsdom or
            // a locked-down browser) the TV keeps working silently.
            const audio = getAudio();
            audio
              .unlock()
              .then(() => {
                audio.setVolume(settingsRef.current.volume);
                audio.setMuted(settingsRef.current.muted);
                audio.playBoot();
              })
              .catch(() => {
                // No audio device; degrade to a silent television.
              });
            break;
          }
          case 'startBoot': {
            if (bootTimer.current !== null) clearTimeout(bootTimer.current);
            bootTimer.current = setTimeout(() => {
              bootTimer.current = null;
              sendRef.current({ type: 'BOOT_DONE' });
            }, BOOT_MS);
            break;
          }
          case 'startTuning': {
            if (tuneTimer.current !== null) clearTimeout(tuneTimer.current);
            // Tuning click + full static snow while acquiring the station.
            audioRef.current?.playTuningClick();
            audioRef.current?.setStatic(1);
            const token = effect.token;
            tuneTimer.current = setTimeout(() => {
              tuneTimer.current = null;
              // Milestone 1: nothing is unplayable yet; always resolve to air.
              sendRef.current({ type: 'TUNE_RESOLVED', token, playable: true });
            }, TUNE_MS);
            break;
          }
          case 'startSource': {
            // On air: drop the snow to a faint bed (real source audio arrives in
            // Milestone 4).
            audioRef.current?.setStatic(0.08);
            break;
          }
          case 'standBy': {
            // Dead-air hiss over the stand-by slate.
            audioRef.current?.setStatic(0.4);
            break;
          }
          case 'announceChannel': {
            const info = channelInfo(effect.channel);
            setAnnouncement(`Channel ${info.label}, ${info.name}`);
            break;
          }
          case 'powerOff': {
            clearTimers();
            // Power-off cue, then suspend the context so nothing plays while off.
            audioRef.current?.playPowerOff();
            void audioRef.current?.suspend();
            setAnnouncement('Television off');
            break;
          }
          case 'stopAll': {
            // Silence the snow bed between sources during a tune.
            audioRef.current?.setStatic(0);
            break;
          }
          case 'runEvent':
          case 'reResolve':
          case 'signOffText':
          case 'setAfterHours':
            // Handled by later-milestone systems (clock, director, adapters).
            break;
        }
      }
    },
    [clearTimers, getAudio],
  );

  /**
   * Dispatch an action and interpret the effects it produced. Both the state
   * transition and the effects come from a single reducer pass over the latest
   * committed state (via stateRef), so they can never diverge.
   */
  const send = useCallback(
    (action: TvAction) => {
      const result = tvReducer(stateRef.current, action);
      stateRef.current = result.state;
      setState(result.state);
      runEffects(result.effects);
    },
    [runEffects],
  );

  // Keep the ref used by timer callbacks in sync, but assign it in an effect
  // rather than during render (react-hooks/refs).
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => clearTimers, [clearTimers]);

  // Release the audio context when the television unmounts.
  useEffect(() => {
    return () => {
      void audioRef.current?.close();
      audioRef.current = null;
    };
  }, []);

  const power = useCallback(() => send({ type: 'POWER' }), [send]);
  const channelUp = useCallback(() => send({ type: 'CHANNEL_UP' }), [send]);
  const channelDown = useCallback(() => send({ type: 'CHANNEL_DOWN' }), [send]);
  const setChannel = useCallback(
    (channel: ChannelId) => send({ type: 'SET_CHANNEL', channel }),
    [send],
  );
  const acknowledgeNotice = useCallback(() => send({ type: 'ACK_NOTICE' }), [send]);

  const setVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setSettings((s) => ({ ...s, volume: clamped, muted: clamped === 0 ? s.muted : false }));
  }, []);
  const toggleMute = useCallback(() => setSettings((s) => ({ ...s, muted: !s.muted })), []);
  const toggleCaptions = useCallback(
    () => setSettings((s) => ({ ...s, captions: !s.captions })),
    [],
  );
  const toggleReducedEffects = useCallback(
    () => setSettings((s) => ({ ...s, reducedEffects: !s.reducedEffects })),
    [],
  );
  const forgetMe = useCallback(() => {
    // Memory persistence arrives in Milestone 3. For now clear any stored key
    // and reset the session settings so "Forget me" is wired and honest.
    try {
      window.localStorage.removeItem('deadair.memory.v1');
    } catch {
      // Storage unavailable; nothing persisted to clear.
    }
    setSettings({ ...DEFAULT_SETTINGS, reducedEffects: prefersReducedMotion() });
    setAnnouncement('Memory erased');
  }, []);

  return useMemo(
    () => ({
      state,
      settings,
      announcement,
      power,
      channelUp,
      channelDown,
      setChannel,
      acknowledgeNotice,
      setVolume,
      toggleMute,
      toggleCaptions,
      toggleReducedEffects,
      forgetMe,
    }),
    [
      state,
      settings,
      announcement,
      power,
      channelUp,
      channelDown,
      setChannel,
      acknowledgeNotice,
      setVolume,
      toggleMute,
      toggleCaptions,
      toggleReducedEffects,
      forgetMe,
    ],
  );
}

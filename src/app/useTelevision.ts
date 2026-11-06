import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  initialTvState,
  tvReducer,
  type Effect,
  type TvAction,
  type TvState,
} from '../core/tvMachine.ts';
import { type ChannelId, type Look, type Resolved } from '../core/types.ts';
import { channelInfo } from '../core/channels.ts';
import { BOOT_MS, TUNE_MS } from './timing.ts';
import { AudioEngine } from '../audio/AudioEngine.ts';
import { resolveBroadcast } from '../core/clock.ts';
import { getChannel, getScene } from '../content/catalog.ts';
import { SceneAdapter } from '../playback/SceneAdapter.ts';
import { type SceneContext } from '../playback/PlaybackAdapter.ts';
import { type Renderer } from '../render/Renderer.ts';
import { type CrtSource } from '../render/CrtRenderer.ts';
import { type SceneVars } from '../core/scene.ts';

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
  /** Screen hands its renderer here so owned sources can publish their picture. */
  registerRenderer: (renderer: Renderer | null) => void;
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

  // --- Broadcast playback (Milestone 2) ----------------------------------
  // The renderer Screen created (owned sources publish their canvas here).
  const rendererRef = useRef<Renderer | null>(null);
  // The current owned-source adapter (scenes now; file/YouTube in Milestone 4).
  const sceneAdapterRef = useRef<SceneAdapter | null>(null);
  // Unsubscribe for the current adapter's event listener.
  const adapterOffRef = useRef<(() => void) | null>(null);
  // Timer that fires ITEM_ENDED when the current item's remaining time elapses.
  const itemEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-channel visit counts, so scene `when` variants work before viewer
  // memory lands (task 12). Keyed by channel id; first tune is visit 1.
  const visitsRef = useRef<Map<ChannelId, number>>(new Map());
  // The act is 0 until escalation lands in Milestone 3.
  const actRef = useRef(0);

  const getSceneAdapter = useCallback((): SceneAdapter => {
    if (!sceneAdapterRef.current) sceneAdapterRef.current = new SceneAdapter();
    return sceneAdapterRef.current;
  }, []);

  const clearItemEndTimer = useCallback(() => {
    if (itemEndTimer.current !== null) {
      clearTimeout(itemEndTimer.current);
      itemEndTimer.current = null;
    }
  }, []);

  // A single SceneContext the adapter uses to look up scenes, read the current
  // visit/act, and publish the picture to the renderer. Built once via a getter
  // so it is never a hook-argument value (the refs it reads are mutated
  // elsewhere); its closures read the latest ref values at call time.
  const sceneCtxRef = useRef<SceneContext | null>(null);
  const getSceneCtx = useCallback((): SceneContext => {
    if (!sceneCtxRef.current) {
      sceneCtxRef.current = {
        getScene: (sceneId) => getScene(sceneId),
        // Preloaded bitmaps arrive with real art (task 21); placeholder scenes
        // draw labelled blocks until then, so no images to hand over yet.
        getImages: () => undefined,
        getVars: (): SceneVars => ({
          visits: visitsRef.current.get((stateRef.current.channel ?? 2) as ChannelId) ?? 1,
          act: actRef.current,
        }),
        setSource: (source) => rendererRef.current?.setSource(source as CrtSource | null),
        setLook: (look: Look) => rendererRef.current?.setLook(look),
        now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      };
    }
    return sceneCtxRef.current;
  }, []);

  const registerRenderer = useCallback((renderer: Renderer | null) => {
    rendererRef.current = renderer;
  }, []);

  /**
   * Resolve the broadcast clock for `channel` now and start playing the
   * resolved scene item from its offset. Returns the clock's `remainingMs` so
   * the caller can schedule the item boundary, or null when nothing playable
   * (the caller moves to stand-by). Dispatch stays with the caller so this
   * callback never captures `send` (which would make the effect-synced
   * `sendRef` a hook value).
   *
   * `onEnded` is wired to the adapter's `ended` event for this play session.
   */
  const startResolvedSource = useCallback(
    (channel: ChannelId, onEnded: () => void): number | null => {
      const ch = getChannel(channel);
      if (!ch) return null;
      const resolved: Resolved | null = resolveBroadcast(ch, Date.now(), () => true);
      if (!resolved) return null;
      // File/YouTube adapters arrive in Milestone 4; only scenes play for now.
      if (resolved.item.source !== 'scene') return null;
      const adapter = getSceneAdapter();
      // Swap the event listener to this play session.
      adapterOffRef.current?.();
      adapterOffRef.current = adapter.on((e) => {
        if (e.type === 'ended') onEnded();
      });
      void adapter.load(resolved.item, resolved.offsetMs, getSceneCtx()).then(() => {
        void adapter.play();
      });
      return resolved.remainingMs;
    },
    [getSceneAdapter, getSceneCtx],
  );

  const stopPlayback = useCallback(() => {
    clearItemEndTimer();
    adapterOffRef.current?.();
    adapterOffRef.current = null;
    sceneAdapterRef.current?.stop();
  }, [clearItemEndTimer]);

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
      // Resolve the clock and start the scene for `channel`, schedule the item
      // boundary from the clock's remaining time (so continuity holds even if a
      // background tab throttles rAF), and fall back to stand-by when nothing
      // is playable. Defined here so dispatch stays local to runEffects, the
      // one place that owns `sendRef`.
      const playFromClock = (channel: ChannelId, token: number): void => {
        const dispatchEnded = (): void => sendRef.current({ type: 'ITEM_ENDED', token });
        const remainingMs = startResolvedSource(channel, dispatchEnded);
        if (remainingMs === null) {
          sendRef.current({ type: 'NOTHING_PLAYABLE', token });
          return;
        }
        clearItemEndTimer();
        itemEndTimer.current = setTimeout(() => {
          itemEndTimer.current = null;
          dispatchEnded();
        }, remainingMs);
      };

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
            // Count this visit so scene `when` variants escalate on revisit
            // (requirement 8.3). Real viewer memory supersedes this in task 12.
            visitsRef.current.set(effect.channel, (visitsRef.current.get(effect.channel) ?? 0) + 1);
            // Tuning click + full static snow while acquiring the station.
            audioRef.current?.playTuningClick();
            audioRef.current?.setStatic(1);
            const token = effect.token;
            const tuneChannel = effect.channel;
            tuneTimer.current = setTimeout(() => {
              tuneTimer.current = null;
              // Playable iff the clock resolves a (scene) item for this channel.
              const ch = getChannel(tuneChannel);
              const resolved = ch ? resolveBroadcast(ch, Date.now(), () => true) : null;
              const playable = resolved !== null && resolved.item.source === 'scene';
              sendRef.current({ type: 'TUNE_RESOLVED', token, playable });
            }, TUNE_MS);
            break;
          }
          case 'startSource': {
            // On air: drop the snow to a faint bed (real source audio arrives in
            // Milestone 4), then resolve the clock and play the current item.
            audioRef.current?.setStatic(0.08);
            playFromClock(effect.channel, effect.token);
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
            stopPlayback();
            // Power-off cue, then suspend the context so nothing plays while off.
            audioRef.current?.playPowerOff();
            void audioRef.current?.suspend();
            setAnnouncement('Television off');
            break;
          }
          case 'stopAll': {
            // Silence the snow bed between sources during a tune, and stop any
            // owned source so the next tune starts clean.
            audioRef.current?.setStatic(0);
            stopPlayback();
            break;
          }
          case 'reResolve': {
            // An item ended (or an event finished): re-resolve the clock and
            // play the next item without user action (requirement 3.3).
            audioRef.current?.setStatic(0.08);
            playFromClock(effect.channel, effect.token);
            break;
          }
          case 'runEvent':
          case 'signOffText':
          case 'setAfterHours':
            // Handled by later-milestone systems (director, sign-off).
            break;
        }
      }
    },
    [clearTimers, getAudio, startResolvedSource, stopPlayback, clearItemEndTimer],
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

  // Release the audio context and stop playback when the television unmounts.
  useEffect(() => {
    return () => {
      stopPlayback();
      void audioRef.current?.close();
      audioRef.current = null;
    };
  }, [stopPlayback]);

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
      registerRenderer,
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
      registerRenderer,
    ],
  );
}

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
import { broadcastPosition, resolveBroadcast } from '../core/clock.ts';
import { getChannel, getScene } from '../content/catalog.ts';
import { SceneAdapter } from '../playback/SceneAdapter.ts';
import { type SceneContext } from '../playback/PlaybackAdapter.ts';
import { type Renderer } from '../render/Renderer.ts';
import { type CrtSource } from '../render/CrtRenderer.ts';
import { type SceneVars } from '../core/scene.ts';
import {
  beginSession,
  createMemory,
  demoActive,
  memoryReducer,
  type MemoryAction,
  type ViewerMemory,
} from '../core/memory.ts';
import { MemoryStore, resetRequested } from '../persistence/memoryStore.ts';

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
  // --- Viewer memory (task 12) -------------------------------------------
  // `?demo=1` divides time thresholds by six (requirement 8.2).
  const demo = typeof window !== 'undefined' ? demoActive(window.location.search) : false;
  const storeRef = useRef<MemoryStore | null>(null);
  const getStore = useCallback((): MemoryStore => {
    if (!storeRef.current) storeRef.current = new MemoryStore();
    return storeRef.current;
  }, []);
  // The live memory. Loaded on mount (honouring ?reset=1), then advanced by the
  // reducer. Held in a ref so async callbacks read the latest without re-running
  // effects; the act is mirrored into state so the UI/escalation can react.
  // Seeded with a placeholder (epoch 0) during render — pure. The load effect
  // replaces it with the real memory (seeded from Date.now) on mount.
  const memoryRef = useRef<ViewerMemory>(createMemory(0));
  // Watch-time accumulator: a 1s ticker counts only while visible, on air, and
  // the adapter is playing (requirement 7.2). `playingRef` tracks that.
  const playingRef = useRef(false);
  const watchTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // True once memory has loaded, so the settings effect does not write the
  // default settings over the persisted ones before the load runs.
  const memoryReadyRef = useRef(false);
  // Set by Forget me so the settings reset it triggers does not immediately
  // re-persist a fresh memory (requirement 7.6: storage stays empty until the
  // viewer does something again).
  const skipSettingsPersistRef = useRef(false);

  // Apply a memory action, persist (throttled), and mirror the act into state.
  const dispatchMemory = useCallback(
    (action: MemoryAction) => {
      const next = memoryReducer(memoryRef.current, action, demo);
      memoryRef.current = next;
      getStore().save(next);
    },
    [demo, getStore],
  );

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
        getVars: (): SceneVars => {
          const ch = (stateRef.current.channel ?? 2) as ChannelId;
          const visits = memoryRef.current.channels[ch]?.visits ?? 0;
          return { visits: Math.max(1, visits), act: memoryRef.current.act };
        },
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

  // Test seam: expose the live channel and the clock-resolved broadcast
  // position so the mocked-clock continuity e2e (task 11) can prove the
  // programme advanced with wall-clock time across a leave-and-return.
  // Published only under the existing test flag; production never sets it.
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean })
        .__CRT_PRESERVE_DRAWING_BUFFER__ !== true
    ) {
      return;
    }
    (
      window as unknown as {
        __tv?: { channel: () => ChannelId | null; broadcastPositionMs: () => number | null };
      }
    ).__tv = {
      channel: () => stateRef.current.channel,
      broadcastPositionMs: () => {
        const ch = stateRef.current.channel;
        const channel = ch === null ? undefined : getChannel(ch);
        return channel ? broadcastPosition(channel, Date.now(), () => true) : null;
      },
    };
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
    playingRef.current = false;
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
    // Persist settings into viewer memory so they survive a reload. Guard the
    // first run (before memory loads), and the one tick right after Forget me
    // (which must leave storage empty — requirement 7.6 — until real activity
    // resumes), with refs.
    if (memoryReadyRef.current && !skipSettingsPersistRef.current) {
      dispatchMemory({ type: 'setSettings', settings });
    }
    skipSettingsPersistRef.current = false;
    // dispatchMemory is stable; settings is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          playingRef.current = false;
          sendRef.current({ type: 'NOTHING_PLAYABLE', token });
          return;
        }
        // An owned source is now playing: watch time may accrue (req 7.2).
        playingRef.current = true;
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
            // Record the visit (visit count, last channel, visit order) so
            // scene `when` variants escalate on revisit and the act advances
            // (requirements 7.1, 8.1, 8.3).
            dispatchMemory({ type: 'visit', channel: effect.channel, atMs: Date.now() });
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
    [clearTimers, getAudio, startResolvedSource, stopPlayback, clearItemEndTimer, dispatchMemory],
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

  // Load viewer memory on mount: honour ?reset=1 (requirement 7.6), start a
  // session (bumping the count after a >30min gap, requirement 7.5), apply the
  // persisted settings and noticeSeen, start the watch-time ticker, and flush
  // on hidden (requirement 7.3). Everything is best-effort; a blocked storage
  // never crashes the TV (requirement 7.4).
  useEffect(() => {
    const store = getStore();
    if (typeof window !== 'undefined' && resetRequested(window.location.search)) {
      store.erase();
    }
    const loaded = beginSession(store.load(), Date.now(), demo);
    memoryRef.current = loaded;
    store.save(loaded);
    // Restore persisted settings, but keep reduced-effects honouring the OS
    // setting if either asks for it.
    setSettings((s) => ({
      ...s,
      ...loaded.settings,
      reducedEffects: loaded.settings.reducedEffects || prefersReducedMotion(),
    }));
    if (loaded.noticeSeen) setState((st) => ({ ...st, noticeSeen: true }));
    stateRef.current = { ...stateRef.current, noticeSeen: loaded.noticeSeen };
    memoryReadyRef.current = true;

    // Watch-time ticker: count only while visible, on air, and playing (7.2).
    const TICK_MS = 1000;
    watchTimer.current = setInterval(() => {
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      const onAir = stateRef.current.phase === 'ON_AIR';
      const channel = stateRef.current.channel;
      if (visible && onAir && playingRef.current && channel !== null) {
        dispatchMemory({ type: 'watch', channel, deltaMs: TICK_MS });
      }
    }, TICK_MS);

    const onVisibility = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        store.flush(memoryRef.current);
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      if (watchTimer.current !== null) clearInterval(watchTimer.current);
      watchTimer.current = null;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      store.flush(memoryRef.current);
    };
  }, [demo, getStore, dispatchMemory]);

  const power = useCallback(() => send({ type: 'POWER' }), [send]);
  const channelUp = useCallback(() => send({ type: 'CHANNEL_UP' }), [send]);
  const channelDown = useCallback(() => send({ type: 'CHANNEL_DOWN' }), [send]);
  const setChannel = useCallback(
    (channel: ChannelId) => send({ type: 'SET_CHANNEL', channel }),
    [send],
  );
  const acknowledgeNotice = useCallback(() => {
    dispatchMemory({ type: 'ackNotice' });
    send({ type: 'ACK_NOTICE' });
  }, [send, dispatchMemory]);

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
    // Erase all persisted memory and reset the live memory (requirement 7.6).
    // Suppress the re-persist that the settings reset below would otherwise
    // trigger, so storage stays empty until the viewer acts again.
    skipSettingsPersistRef.current = true;
    getStore().erase();
    memoryRef.current = createMemory(Date.now());
    setSettings({ ...DEFAULT_SETTINGS, reducedEffects: prefersReducedMotion() });
    setAnnouncement('Memory erased');
  }, [getStore]);

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

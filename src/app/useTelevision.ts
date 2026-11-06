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
import { getChannel, getEvents, getScene } from '../content/catalog.ts';
import { SceneAdapter } from '../playback/SceneAdapter.ts';
import { type SceneContext } from '../playback/PlaybackAdapter.ts';
import { decideEvent } from '../core/director.ts';
import { renderLine, fillTemplate } from '../core/template.ts';
import { runEventSteps, type EventOps, type ResolvedStep } from '../playback/eventRunner.ts';
import type { HorrorEventInput } from '../content/schema.ts';
import type { Seam } from '../core/types.ts';
import { type Renderer } from '../render/Renderer.ts';
import { type CrtSource } from '../render/CrtRenderer.ts';
import { type SceneVars } from '../core/scene.ts';
import { EventPresenter } from '../playback/EventPresenter.ts';
import { channelInfo as channelInfoLookup } from '../core/channels.ts';
import { deriveRoom, type RoomState } from '../core/roomState.ts';
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
  /**
   * The shared procedural audio engine, so the room's paper-rip plays through
   * the same SFX bus and master limiter (design §9). Lazily created on the
   * first POWER or tear gesture.
   */
  getAudio: () => AudioEngine;
  /**
   * Derive the room's lit state (design §5) from the live memory, phase and the
   * sampled owned-picture colour. The room canvas calls this at ≤ 8 Hz and
   * smooths the result; it never samples a YouTube player.
   */
  getRoomState: (reduced: boolean, localHour: number, localMinute: number) => RoomState;
}

const DEFAULT_SETTINGS: UiSettings = {
  volume: 0.7,
  // Captions default ON until real recorded voice exists (task 21): voice event
  // lines have no audio yet, so their caption is their only output and must show
  // (requirement 13.3, Fix 11). The viewer can still turn CC off.
  captions: true,
  muted: false,
  reducedEffects: false,
};

/** The faint resting snow level on air, restored after every event step (Fix 1). */
const RESTING_STATIC = 0.08;

/** The mid-item seam is checked this often while an owned source is on air (design §9). */
const MID_ITEM_CHECK_MS = 10_000;
/** Fixed low probability per mid-item check (design §9 "a fixed low probability per check"). */
const MID_ITEM_PROBABILITY = 0.25;

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
  // The last owned-source canvas published to the renderer, so the room can
  // sample the picture colour to light the wall (design §5). Null when off or
  // on a YouTube item — the player is never sampled (requirement 5.3). A tiny
  // 8×8 scratch canvas does the averaging.
  const lastSourceRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCanvasRef = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(null);
  // The current owned-source adapter (scenes now; file/YouTube in Milestone 4).
  const sceneAdapterRef = useRef<SceneAdapter | null>(null);
  // Unsubscribe for the current adapter's event listener.
  const adapterOffRef = useRef<(() => void) | null>(null);
  // Timer that fires ITEM_ENDED when the current item's remaining time elapses.
  const itemEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // --- Viewer memory (task 12) -------------------------------------------
  // `?demo=1` divides time thresholds and cooldowns by DEMO_DIVISOR (8); see
  // core/memory.ts (requirement 8.2 / dead-air-room 9.3).
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
  // Timestamp when the current eligible watch span began, or null when not
  // accruing. The ticker credits now - watchSince on each fire.
  const watchSinceRef = useRef<number | null>(null);
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

  /**
   * Credit the watch time elapsed since the current span began, if watch is
   * eligible right now (visible, on air, playing). Timestamp-based (design §8),
   * so one call after a long time-jump credits the whole span. Resets the span
   * anchor. Safe to call often; a non-eligible or zero-length span is a no-op.
   */
  const flushWatch = useCallback(() => {
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    const onAir = stateRef.current.phase === 'ON_AIR';
    const channel = stateRef.current.channel;
    const now = Date.now();
    if (visible && onAir && playingRef.current && channel !== null) {
      if (watchSinceRef.current === null) watchSinceRef.current = now;
      const delta = now - watchSinceRef.current;
      if (delta > 0) {
        dispatchMemory({ type: 'watch', channel, deltaMs: delta });
        watchSinceRef.current = now;
      }
    } else {
      watchSinceRef.current = null;
    }
  }, [dispatchMemory]);

  // --- Horror director (task 13 wiring) ----------------------------------
  // Events fired this session (for perSession limits), the last event time, the
  // event the director chose and is running now, and a cancel flag for the runner.
  const sessionFiredRef = useRef<Record<string, number>>({});
  const lastEventAtRef = useRef<number | null>(null);
  const pendingEventRef = useRef<HorrorEventInput | null>(null);
  const eventCancelRef = useRef(false);
  // The offscreen presenter that paints event output (slates, captions, the
  // sign-off text, played scenes) onto a canvas and publishes it to the shader
  // (Fix 1). Created lazily once a renderer is registered.
  const presenterRef = useRef<EventPresenter | null>(null);
  // The sign-off text timer, cleared when it is no longer needed (Fix 4).
  const signOffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mid-item seam ticker: checks for a mid-item event every 10s on owned
  // sources (design §9, Fix 10). Injected random keeps it deterministic in test.
  const midItemTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const midItemRandomRef = useRef<() => number>(Math.random);

  /**
   * Ask the director whether an event fires at `seam` on the current channel.
   * Returns the chosen event (also stashed for the runner) or null. Pure
   * decision; firing is driven by the EVENT_START action the caller dispatches.
   */
  const decideSeamEvent = useCallback(
    (channel: ChannelId, seam: Seam): HorrorEventInput | null => {
      const d = new Date();
      const chosen = decideEvent({
        memory: memoryRef.current,
        channel,
        seam,
        currentSource: playingRef.current ? 'scene' : null,
        nowMs: Date.now(),
        localHour: d.getHours(),
        lastEventAt: lastEventAtRef.current,
        sessionFired: sessionFiredRef.current,
        events: getEvents(),
        random: Math.random,
        demo,
      });
      pendingEventRef.current = chosen;
      return chosen;
    },
    [demo],
  );

  // Lazily build the event presenter once a renderer is available. It owns the
  // offscreen canvas that event output is painted onto and published through.
  const getPresenter = useCallback((): EventPresenter => {
    if (!presenterRef.current) {
      presenterRef.current = new EventPresenter({
        publish: (source) => rendererRef.current?.setSource(source),
        setStatic: (n) => {
          rendererRef.current?.setStatic(n);
          audioRef.current?.setStatic(n);
        },
        now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      });
    }
    return presenterRef.current;
  }, []);

  // Build the injected effect operations an event's steps run against. Every
  // visible step paints onto the presenter's canvas and publishes it to the
  // shader (Fix 1) AND sets the ARIA announcement; static is restored to the
  // resting level after each step. `onSignOff` is called when a signOff step
  // runs so the caller can drive the state machine.
  const makeEventOps = useCallback(
    (onSignOff: () => void, channel: ChannelId): EventOps => {
      const wait = (ms: number): Promise<void> =>
        new Promise((r) => setTimeout(r, Math.max(0, ms)));
      const restingStatic = (): void => {
        rendererRef.current?.setStatic(RESTING_STATIC);
        audioRef.current?.setStatic(RESTING_STATIC);
      };
      const presenter = getPresenter();
      return {
        showStatic: async (ms) => {
          // Pure snow: clear any published picture so the shader shows static.
          presenter.clear();
          rendererRef.current?.setStatic(1);
          audioRef.current?.setStatic(1);
          await wait(ms);
          restingStatic();
        },
        showSlate: async (text, ms) => {
          // The slate text is drawn onto the canvas (Fix 1), not a DOM overlay,
          // and also announced for assistive tech.
          restingStatic();
          presenter.showSlate(text);
          setAnnouncement(text);
          await wait(ms);
        },
        playScene: async (sceneId) => {
          const scene = getScene(sceneId);
          if (!scene) throw new Error(`missing scene ${sceneId}`);
          // Actually play the scene for its full duration (Fix 1), honouring CC.
          restingStatic();
          const vars: SceneVars = {
            visits: Math.max(1, memoryRef.current.channels[channel]?.visits ?? 0),
            act: memoryRef.current.act,
          };
          await presenter.playScene(
            scene,
            vars,
            scene.durationMs,
            memoryRef.current.settings.captions,
            () => eventCancelRef.current,
          );
        },
        speak: async (o) => {
          // No recorded VO yet (task 21); a voice line's caption is its only
          // output, so it is drawn onto the picture and always shown (Fix 11),
          // regardless of the url/stems that will carry audio later.
          restingStatic();
          presenter.showCaption(o.caption);
          setAnnouncement(o.caption);
          await wait(1800);
        },
        flashPrevious: async (ms) => {
          // Flash the captured last frame of the previous owned source, or a
          // station card when there is none / the previous source was YouTube
          // (requirement 10.2/10.3), gated by the flash limiter (13.1).
          const label = channelInfoLookup(channel).name;
          rendererRef.current?.flashPrevious(ms, Date.now(), label);
          await wait(ms);
          restingStatic();
        },
        shaderPulse: async (effect, ms) => {
          const r = rendererRef.current as unknown as {
            requestFlash?: (n: number, a?: () => void) => boolean;
            setRoll?: (a: number) => void;
            setTear?: (a: number) => void;
          } | null;
          if (r?.requestFlash) {
            r.requestFlash(Date.now(), () => {
              if (effect === 'roll') r.setRoll?.(0.6);
              else if (effect === 'tear') r.setTear?.(0.6);
              else rendererRef.current?.setStatic(0.6);
            });
          }
          await wait(ms);
          r?.setRoll?.(0);
          r?.setTear?.(0);
          restingStatic();
        },
        silence: async (ms) => {
          audioRef.current?.setStatic(0);
          await wait(ms);
          restingStatic();
        },
        signOff: async () => {
          onSignOff();
          await wait(10);
        },
        captionsOverStatic: async (caption, ms) => {
          // Degraded path (requirement 9.6): caption drawn over a static field.
          rendererRef.current?.setStatic(0.5);
          audioRef.current?.setStatic(0.5);
          presenter.showCaption(caption);
          setAnnouncement(caption);
          await wait(ms);
          restingStatic();
        },
        cancelled: () => eventCancelRef.current,
      };
    },
    [getPresenter],
  );

  // Resolve an event's step templates against real memory (requirement 9.5),
  // so the runner sequences already-filled text.
  const resolveSteps = useCallback((event: HorrorEventInput, channel: ChannelId): ResolvedStep[] => {
    const d = new Date();
    const tctx = { channel, localHour: d.getHours(), localMinute: d.getMinutes() };
    return event.steps.map((step): ResolvedStep => {
      if (step.do === 'slate') {
        return { ...step, text: renderLine(step.text, step.fallbackText, memoryRef.current, tctx) };
      }
      if (step.do === 'voice') {
        return { ...step, caption: renderLine(step.caption, step.fallbackCaption, memoryRef.current, tctx) };
      }
      return step;
    });
  }, []);

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
        // Draw scene captions per the CC setting (requirement 13.3, Fix 11).
        // Read from memory, which the settings effect keeps in sync with the UI.
        drawCaptions: () => memoryRef.current.settings.captions,
        // Fill scene-layer templates from real memory (Fix 12). A missing value
        // with no fallback hides the layer (null) — so channel 13's history
        // read-back only appears once the viewer came from another channel
        // (requirement 10.1).
        resolveText: (raw: string): string | null => {
          const ch = (stateRef.current.channel ?? 2) as ChannelId;
          const d = new Date();
          const { text, missing } = fillTemplate(raw, memoryRef.current, {
            channel: ch,
            localHour: d.getHours(),
            localMinute: d.getMinutes(),
          });
          return missing.length > 0 ? null : text;
        },
        setSource: (source) => {
          // Remember the owned-source canvas for room lighting; an HTMLCanvas
          // is a scene/file picture (sampleable), anything else is cleared.
          lastSourceRef.current = source instanceof HTMLCanvasElement ? source : null;
          rendererRef.current?.setSource(source as CrtSource | null);
        },
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
        __tv?: {
          channel: () => ChannelId | null;
          broadcastPositionMs: () => number | null;
          act: () => number;
          phase: () => string;
          firedEvents: () => string[];
          lastEventText: () => string;
          forceMidItem: () => void;
          visitTotal: () => number;
        };
      }
    ).__tv = {
      channel: () => stateRef.current.channel,
      broadcastPositionMs: () => {
        const ch = stateRef.current.channel;
        const channel = ch === null ? undefined : getChannel(ch);
        return channel ? broadcastPosition(channel, Date.now(), () => true) : null;
      },
      act: () => {
        // Flush any pending watch span so a test that jumped the clock sees the
        // up-to-date act without waiting for the next ticker fire.
        flushWatch();
        return memoryRef.current.act;
      },
      phase: () => stateRef.current.phase,
      firedEvents: () => Object.keys(memoryRef.current.firedEvents),
      // The last text the event presenter painted onto the picture, so a test
      // can prove event output reaches the canvas (Fix 1) and that the exact
      // sign-off wording was drawn (Fix 2).
      lastEventText: () => presenterRef.current?.lastText() ?? '',
      // Force the next mid-item check to roll a hit (Fix 10 test seam), so a
      // test can deterministically trigger a mid-item event (E03) without
      // waiting on probability.
      forceMidItem: () => {
        midItemRandomRef.current = () => 0;
      },
      // Total recorded visits across channels, read from live memory (not
      // localStorage, which is throttled), so a test can assert tune-complete
      // visit accounting without racing the persistence throttle.
      visitTotal: () => {
        const ch = memoryRef.current.channels;
        return ch[2].visits + ch[4].visits + ch[7].visits + ch[13].visits;
      },
    };
  }, [flushWatch]);

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
    if (midItemTimerRef.current !== null) {
      clearInterval(midItemTimerRef.current);
      midItemTimerRef.current = null;
    }
    // Capture the last owned-source frame before the source goes away, so
    // channel 13's flashPrevious can show it (design §10, requirement 10.2).
    // Owned sources only — a scene/file canvas; YouTube is never captured.
    if (playingRef.current) rendererRef.current?.captureFrame();
    playingRef.current = false;
    watchSinceRef.current = null;
    lastSourceRef.current = null;
    adapterOffRef.current?.();
    adapterOffRef.current = null;
    sceneAdapterRef.current?.stop();
  }, [clearItemEndTimer]);

  // Sample the current owned picture's average colour (8×8 downscale) for room
  // lighting (design §5), or null when off / on a YouTube item. Never reads a
  // YouTube iframe — only the owned scene/file canvas. The room throttles the
  // call rate; this just does one cheap downscaled average.
  const getRoomPicture = useCallback((): { r: number; g: number; b: number } | null => {
    if (stateRef.current.phase === 'OFF') return null;
    const src = lastSourceRef.current;
    if (!src || src.width === 0 || src.height === 0) return null;
    if (!sampleCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      const cx = c.getContext('2d', { willReadFrequently: true });
      if (!cx) return null;
      sampleCanvasRef.current = { canvas: c, ctx: cx };
    }
    const { ctx } = sampleCanvasRef.current;
    try {
      ctx.drawImage(src, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]!;
        g += d[i + 1]!;
        b += d[i + 2]!;
      }
      const n = d.length / 4;
      return { r: r / n, g: g / n, b: b / n };
    } catch {
      return null;
    }
  }, []);

  // Derive the room state from live memory, phase and the sampled picture
  // (design §5). Kept here so memory never leaves the orchestrator; the room
  // canvas consumes the result.
  const getRoomState = useCallback(
    (reduced: boolean, localHour: number, localMinute: number): RoomState =>
      deriveRoom({
        memory: memoryRef.current,
        phase: stateRef.current.phase,
        picture: getRoomPicture(),
        localHour,
        localMinute,
        reduced,
      }),
    [getRoomPicture],
  );

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
        // Credit the watch span of the item that just finished before the next
        // one starts, so a long item's time is not lost at the boundary.
        flushWatch();
        const dispatchEnded = (): void => {
          // Item boundary seam: ask the director first (requirement 9.1). An
          // event fires from ON_AIR via EVENT_START; otherwise re-resolve.
          const boundaryEvent = decideSeamEvent(channel, 'item-boundary');
          if (boundaryEvent) sendRef.current({ type: 'EVENT_START', token, seam: 'item-boundary' });
          else sendRef.current({ type: 'ITEM_ENDED', token });
        };
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
        // Mid-item seam (design §9, Fix 10): while this owned source is on air,
        // every 10s roll the injected random; on a hit ask the director for a
        // mid-item event and fire it from ON_AIR. Never runs on YouTube (only
        // owned sources start here). Cleared when playback stops.
        if (midItemTimerRef.current !== null) clearInterval(midItemTimerRef.current);
        midItemTimerRef.current = setInterval(() => {
          if (stateRef.current.phase !== 'ON_AIR' || !playingRef.current) return;
          if (midItemRandomRef.current() >= MID_ITEM_PROBABILITY) return;
          const midEvent = decideSeamEvent(channel, 'mid-item');
          if (midEvent) sendRef.current({ type: 'EVENT_START', token, seam: 'mid-item' });
        }, MID_ITEM_CHECK_MS);
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
            // Tuning click + full static snow while acquiring the station.
            audioRef.current?.playTuningClick();
            audioRef.current?.setStatic(1);
            const token = effect.token;
            const tuneChannel = effect.channel;
            tuneTimer.current = setTimeout(() => {
              tuneTimer.current = null;
              // Record the visit only when the tune COMPLETES (requirement 7.1,
              // Fix 6): rapid surfing restarts this timer, so only the final
              // channel's tune reaches here and records one visit. The director
              // then sees the up-to-date visit count and visit order.
              dispatchMemory({ type: 'visit', channel: tuneChannel, atMs: Date.now() });
              // A tune-in seam: ask the director first (requirement 9.1). If an
              // event fires, enter the EVENT phase; otherwise resolve to air.
              const tuneEvent = decideSeamEvent(tuneChannel, 'tune-in');
              if (tuneEvent) {
                sendRef.current({ type: 'EVENT_START', token, seam: 'tune-in' });
                return;
              }
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
            // Draw the PLEASE STAND BY slate ONTO the canvas so it passes
            // through the shader (Fix 3) — no DOM text over the tube — with
            // dead-air hiss behind it.
            getPresenter().showSlate('PLEASE STAND BY');
            setAnnouncement('Please stand by');
            rendererRef.current?.setStatic(0.4);
            audioRef.current?.setStatic(0.4);
            break;
          }
          case 'announceChannel': {
            const info = channelInfo(effect.channel);
            setAnnouncement(`Channel ${info.label}, ${info.name}`);
            break;
          }
          case 'powerOff': {
            // Cancel any running event so a stale step cannot run after power
            // off (Fix 4), and clear the sign-off timer.
            eventCancelRef.current = true;
            if (signOffTimerRef.current !== null) {
              clearTimeout(signOffTimerRef.current);
              signOffTimerRef.current = null;
            }
            clearTimers();
            stopPlayback();
            presenterRef.current?.clear();
            // Power-off cue, then suspend the context so nothing plays while off.
            audioRef.current?.playPowerOff();
            void audioRef.current?.suspend();
            setAnnouncement('Television off');
            break;
          }
          case 'stopAll': {
            // Cancel any running event: leaving a channel (CH+/-) during an
            // event must stop its steps so none runs against the new channel
            // (Fix 4). A sign-off event that has NOT yet reached SIGN_OFF is
            // thereby abandoned, so E10 fires again on the next visit to 13.
            eventCancelRef.current = true;
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
          case 'runEvent': {
            // Run the event the director chose for this seam, then drive the
            // state machine to the sign-off cut (if a signOff step ran) or back
            // to ON_AIR.
            const event = pendingEventRef.current;
            const token = effect.token;
            const channel = stateRef.current.channel ?? 2;
            if (!event) {
              sendRef.current({ type: 'EVENT_DONE', token });
              break;
            }
            // Stop the underlying programme while the event plays.
            stopPlayback();
            eventCancelRef.current = false;
            lastEventAtRef.current = Date.now();
            sessionFiredRef.current[event.id] = (sessionFiredRef.current[event.id] ?? 0) + 1;
            // A sign-off event counts as fired only when it REACHES the sign-off
            // (design §7, Fix 4): recording it here would consume the once-per-
            // viewer sign-off even if the viewer left during the voice. Any
            // other event is recorded now, as it runs.
            const isSignOff = event.steps.some((s) => s.do === 'signOff');
            if (!isSignOff) {
              dispatchMemory({ type: 'eventFired', eventId: event.id, atMs: Date.now() });
            }
            let signedOff = false;
            const ops = makeEventOps(() => {
              signedOff = true;
            }, channel);
            const steps = resolveSteps(event, channel);
            void runEventSteps(steps, ops).then(() => {
              pendingEventRef.current = null;
              // If the viewer left or powered off during the event, the machine
              // has already moved on; the token guard below drops this result.
              if (signedOff) sendRef.current({ type: 'SIGN_OFF_START', token, eventId: event.id });
              else sendRef.current({ type: 'EVENT_DONE', token });
            });
            break;
          }
          case 'signOffText': {
            // The sign-off cut has been reached (SIGN_OFF phase). NOW record
            // E10 as fired — design §7 counts it only on reaching SIGN_OFF, so a
            // viewer who left during the voice meets it again (Fix 4). Flush the
            // record immediately so a reload during the text cannot lose it.
            dispatchMemory({ type: 'eventFired', eventId: effect.eventId, atMs: Date.now() });
            getStore().flush(memoryRef.current);
            // Show the exact fixed text (media-bible §9) on a clean picture, no
            // snow, drawn onto the canvas (Fix 1/2) — not a DOM overlay.
            stopPlayback();
            getPresenter().showSignOff();
            rendererRef.current?.setStatic(0);
            audioRef.current?.setStatic(0);
            rendererRef.current?.setPower(1);
            setAnnouncement('NO SIGNAL. THANK YOU FOR WATCHING. BROADCAST TERMINATED.');
            if (signOffTimerRef.current !== null) clearTimeout(signOffTimerRef.current);
            signOffTimerRef.current = setTimeout(() => {
              signOffTimerRef.current = null;
              sendRef.current({ type: 'SIGN_OFF_COMPLETE' });
            }, 8000);
            break;
          }
          case 'setAfterHours': {
            // Sign-off completed: record Act 4 so after-hours variants unlock
            // (requirement 11.2/11.3), and flush immediately so a reload cannot
            // strand the viewer below Act 4 (Fix 4). Clear the sign-off timer.
            if (signOffTimerRef.current !== null) {
              clearTimeout(signOffTimerRef.current);
              signOffTimerRef.current = null;
            }
            getPresenter().clear();
            dispatchMemory({ type: 'signOffComplete' });
            getStore().flush(memoryRef.current);
            break;
          }
        }
      }
    },
    [
      clearTimers,
      getAudio,
      getStore,
      getPresenter,
      startResolvedSource,
      stopPlayback,
      clearItemEndTimer,
      dispatchMemory,
      decideSeamEvent,
      makeEventOps,
      resolveSteps,
      flushWatch,
    ],
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
      if (signOffTimerRef.current !== null) {
        clearTimeout(signOffTimerRef.current);
        signOffTimerRef.current = null;
      }
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
    let loaded = beginSession(store.load(), Date.now(), demo);
    // Reload recovery (Fix 4): if the sign-off (E10) has fired but the act is
    // below 4, a reload happened during the 8s sign-off text — complete the
    // transition so the viewer is never stranded in Act 3. Flush immediately.
    if ((loaded.firedEvents['E10']?.count ?? 0) > 0 && loaded.act < 4) {
      loaded = memoryReducer(loaded, { type: 'signOffComplete' }, demo);
    }
    memoryRef.current = loaded;
    store.save(loaded);
    // Restore persisted settings, but keep reduced-effects honouring the OS
    // setting if either asks for it.
    setSettings((s) => ({
      ...s,
      ...loaded.settings,
      reducedEffects: loaded.settings.reducedEffects || prefersReducedMotion(),
    }));
    // Restore the TV shell from memory: POWER tunes to the last channel watched
    // (requirement 1.3, Fix 8), and after-hours (Act 4) is restored so Act-4
    // variants/events are available on power-on (requirement 11.3).
    const restoredChannel = loaded.lastChannel;
    const afterHours = loaded.act === 4;
    if (loaded.noticeSeen || restoredChannel !== null || afterHours) {
      setState((st) => ({
        ...st,
        noticeSeen: loaded.noticeSeen,
        channel: restoredChannel ?? st.channel,
        afterHours,
      }));
    }
    stateRef.current = {
      ...stateRef.current,
      noticeSeen: loaded.noticeSeen,
      channel: restoredChannel ?? stateRef.current.channel,
      afterHours,
    };
    memoryReadyRef.current = true;

    // Watch-time: timestamp-delta accounting (design §8 "from
    // requestAnimationFrame-independent timestamps"). The ticker credits the
    // real elapsed span since watch last became eligible, and only while
    // visible, on air, and playing (requirement 7.2). Using a delta rather than
    // a fixed per-tick increment means a single long time-jump (or a throttled
    // background tab) still credits the correct amount, and nothing accrues
    // while paused, off air, or hidden.
    const TICK_MS = 1000;
    watchTimer.current = setInterval(() => flushWatch(), TICK_MS);

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
  }, [demo, getStore, flushWatch]);

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
      getAudio,
      getRoomState,
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
      getAudio,
      getRoomState,
    ],
  );
}

/**
 * The one interface every source type plays through (design §6, tech.md: "all
 * playback goes through the PlaybackAdapter interface. No component calls
 * YT.Player or HTMLVideoElement directly except its adapter"). Scenes, files,
 * and YouTube each implement it; `useTelevision` (task 10.2) drives whichever
 * adapter the current item needs and listens for the same events from all.
 */

import type { Item, Look } from '../core/types.ts';
import type { SceneVars } from '../core/scene.ts';
import type { SceneProgramInput } from '../content/schema.ts';
import type { CrtSource } from '../render/CrtRenderer.ts';

/** Events every adapter emits, so the shell handles all sources uniformly. */
export type AdapterEvent =
  | { type: 'playing' }
  | { type: 'paused'; byUser: boolean }
  | { type: 'ended' }
  | { type: 'blocked' }
  | { type: 'error'; fatal: boolean; code?: number };

/**
 * What an adapter needs from the shell to play an item: look up a scene by id,
 * fetch preloaded bitmaps, read the current visit/act, and publish the picture
 * it produces (an owned source hands a canvas/video to the CRT shader; an
 * iframe source renders itself and passes `null`).
 */
export interface SceneContext {
  getScene(sceneId: string): SceneProgramInput | undefined;
  getImages(sceneId: string): Map<string, CanvasImageSource> | undefined;
  getVars(): SceneVars;
  /** Publish the owned-source texture (canvas/video), or null for an iframe. */
  setSource(source: CrtSource | null): void;
  /** Apply a look preset for the item being played. */
  setLook?(look: Look): void;
  /** Monotonic clock in ms, injected so adapters stay testable (no Date.now). */
  now(): number;
}

export interface PlaybackAdapter {
  readonly surface: 'canvas' | 'iframe';
  /** Prepare `item` seeked to `offsetMs`. Resolves when ready to play. */
  load(item: Item, offsetMs: number, ctx: SceneContext): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  setVolume(volume01: number, muted: boolean): void;
  /** Current position within the item, in ms. */
  positionMs(): number;
  /** Subscribe to adapter events; returns an unsubscribe function. */
  on(listener: (e: AdapterEvent) => void): () => void;
}

/**
 * Plays a scene item (design §6 SceneAdapter). A scene is time-addressable:
 * each frame we ask the clock-relative offset, render that instant onto an
 * offscreen 2D canvas with the pure `renderScene`, and publish the canvas as
 * the CRT shader's source texture. No video element, no accumulated state.
 *
 * The adapter owns only timing and the canvas; all drawing is the tested
 * `renderScene`. rAF and the canvas factory are injectable so the adapter runs
 * under jsdom in unit tests and in a real browser unchanged.
 */

import type { Item } from '../core/types.ts';
import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from '../render/looks.ts';
import { renderScene, type Ctx2D } from '../render/sceneRenderer.ts';
import type { AdapterEvent, PlaybackAdapter, SceneContext } from './PlaybackAdapter.ts';

export interface SceneAdapterDeps {
  /** Schedule the next frame; returns a handle. Defaults to requestAnimationFrame. */
  requestFrame?: (cb: (nowMs: number) => void) => number;
  /** Cancel a scheduled frame. Defaults to cancelAnimationFrame. */
  cancelFrame?: (handle: number) => void;
  /** Make the offscreen draw surface. Defaults to a document canvas. */
  createCanvas?: (w: number, h: number) => { ctx: Ctx2D; source: unknown };
  /**
   * Minimum ms between source-texture redraws (default ~50 ms ≈ 20 fps). The
   * CRT shader runs at 60 fps independently; the scene's flat picture only
   * needs refreshing a few times a second (ticker/noise motion stays smooth
   * enough), which keeps GPU/CPU cost down (tech.md 60 fps budget). The rAF
   * loop still runs every frame to detect the item boundary promptly.
   */
  redrawIntervalMs?: number;
}

function defaultCreateCanvas(w: number, h: number): { ctx: Ctx2D; source: unknown } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { ctx, source: canvas };
}

export class SceneAdapter implements PlaybackAdapter {
  readonly surface = 'canvas' as const;

  private readonly requestFrame: (cb: (nowMs: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly ctx: Ctx2D;
  private readonly sourceCanvas: unknown;

  private item: Item | null = null;
  private ctxApp: SceneContext | null = null;
  private sceneId: string | null = null;
  /** Wall-clock (ctx.now()) at which position 0 of the item mapped to startOffset. */
  private anchorNow = 0;
  private startOffsetMs = 0;
  private frame: number | null = null;
  private running = false;
  private endedEmitted = false;
  private readonly listeners = new Set<(e: AdapterEvent) => void>();
  private readonly redrawIntervalMs: number;
  /** ctx.now() of the last actual redraw; -Infinity forces the first draw. */
  private lastDrawAt = -Infinity;

  constructor(deps: SceneAdapterDeps = {}) {
    this.redrawIntervalMs = deps.redrawIntervalMs ?? 50;
    // The scene source is a flat picture refreshed a few times a second (the
    // CRT shader animates at 60 fps on top), so we drive the refresh on a
    // timer at the redraw interval rather than requestAnimationFrame every
    // frame. This caps the source-texture work (tech.md 60 fps budget) and
    // keeps the loop cheap. Tests inject their own scheduler.
    const interval = this.redrawIntervalMs;
    this.requestFrame =
      deps.requestFrame ?? ((cb) => setTimeout(() => cb(Date.now()), interval) as unknown as number);
    this.cancelFrame = deps.cancelFrame ?? ((h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>));
    const made = (deps.createCanvas ?? defaultCreateCanvas)(INTERNAL_WIDTH, INTERNAL_HEIGHT);
    this.ctx = made.ctx;
    this.sourceCanvas = made.source;
  }

  load(item: Item, offsetMs: number, ctx: SceneContext): Promise<void> {
    if (item.source !== 'scene') {
      return Promise.reject(new Error(`SceneAdapter cannot play a ${item.source} item`));
    }
    this.item = item;
    this.ctxApp = ctx;
    this.sceneId = item.sceneId;
    this.startOffsetMs = Math.max(0, offsetMs);
    this.anchorNow = ctx.now();
    this.endedEmitted = false;
    ctx.setLook?.(item.look);
    // Draw the first frame immediately so a paused load still shows the picture.
    this.lastDrawAt = ctx.now();
    this.drawAt(this.startOffsetMs);
    return Promise.resolve();
  }

  play(): Promise<void> {
    if (!this.item || !this.ctxApp) return Promise.resolve();
    if (this.running) return Promise.resolve();
    this.running = true;
    // Re-anchor so the position continues from where it paused.
    this.anchorNow = this.ctxApp.now() - this.startOffsetMs;
    this.emit({ type: 'playing' });
    this.loop();
    return Promise.resolve();
  }

  pause(): void {
    if (!this.running) return;
    this.startOffsetMs = this.positionMs();
    this.stopLoop();
    this.emit({ type: 'paused', byUser: true });
  }

  stop(): void {
    this.stopLoop();
    this.item = null;
    this.sceneId = null;
    this.ctxApp?.setSource(null);
  }

  setVolume(): void {
    // A scene's own audio cues are mixed by the AudioEngine (task 15); the
    // adapter produces no element audio, so there is nothing to gain here.
  }

  positionMs(): number {
    if (!this.item || !this.ctxApp) return this.startOffsetMs;
    if (!this.running) return this.startOffsetMs;
    return this.ctxApp.now() - this.anchorNow;
  }

  on(listener: (e: AdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private loop(): void {
    if (!this.running) return;
    this.frame = this.requestFrame(() => {
      if (!this.running || !this.item || !this.ctxApp) return;
      const pos = this.positionMs();
      if (pos >= this.item.durationMs) {
        // Hold the final frame, publish it, and announce the boundary once.
        this.drawAt(this.item.durationMs - 1);
        if (!this.endedEmitted) {
          this.endedEmitted = true;
          this.running = false;
          this.emit({ type: 'ended' });
        }
        return;
      }
      // Throttle the source redraw to redrawIntervalMs; the loop still runs
      // every frame so the boundary above is detected promptly.
      const nowClock = this.ctxApp.now();
      if (nowClock - this.lastDrawAt >= this.redrawIntervalMs) {
        this.lastDrawAt = nowClock;
        this.drawAt(pos);
      }
      this.loop();
    });
  }

  private stopLoop(): void {
    this.running = false;
    if (this.frame !== null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }
  }

  /** Render the scene at item-offset `posMs`, mapped into the scene's own loop. */
  private drawAt(posMs: number): void {
    if (!this.ctxApp || !this.sceneId) return;
    const scene = this.ctxApp.getScene(this.sceneId);
    if (!scene) {
      // Missing scene: publish nothing so the shell can degrade to static.
      this.ctxApp.setSource(null);
      this.emit({ type: 'error', fatal: false });
      return;
    }
    // A scene shorter than the item loops within the item (design §6).
    const tMs = scene.durationMs > 0 ? posMs % scene.durationMs : 0;
    const images = this.ctxApp.getImages(this.sceneId);
    const resolveText = this.ctxApp.resolveText?.bind(this.ctxApp);
    renderScene(this.ctx, scene, tMs, this.ctxApp.getVars(), {
      ...(images ? { images } : {}),
      ...(this.ctxApp.drawCaptions ? { drawCaptions: this.ctxApp.drawCaptions() } : {}),
      ...(resolveText ? { resolveText } : {}),
    });
    this.ctxApp.setSource(this.sourceCanvas as never);
  }

  private emit(e: AdapterEvent): void {
    for (const l of this.listeners) l(e);
  }
}

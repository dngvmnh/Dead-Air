/**
 * Presents horror-event output as a PICTURE (design §9/§10). It owns a single
 * offscreen 2D canvas and, for each event step, draws onto it — a slate, a
 * caption over static, the fixed sign-off text, or a played scene — then
 * publishes the canvas as the CRT shader's source texture through the injected
 * `publish` callback. This is the fix for the regression where event steps only
 * set the ARIA region and the static level, so nothing of an event ever reached
 * the picture.
 *
 * All drawing goes through the tested pure functions in `render/overlayRenderer`
 * and `render/sceneRenderer`; the presenter only owns the canvas, timing and the
 * publish/clear wiring. Nothing here touches DOM text or styling on the tube.
 *
 * The canvas factory, clock and publish/setStatic hooks are injected so the
 * presenter runs under jsdom in unit tests and in a real browser unchanged.
 */

import { drawApparition, type ApparitionKind } from '../render/apparition.ts';
import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from '../render/looks.ts';
import {
  drawCaptionsOverStatic,
  drawSignOff,
  drawSlate,
  type Ctx2D,
} from '../render/overlayRenderer.ts';
import { renderScene } from '../render/sceneRenderer.ts';
import type { SceneProgramInput } from '../content/schema.ts';
import type { SceneVars } from '../core/scene.ts';
import type { CrtSource } from '../render/CrtRenderer.ts';

export interface EventPresenterDeps {
  /** Make the offscreen draw surface. Defaults to a document canvas. */
  createCanvas?: (w: number, h: number) => { ctx: Ctx2D; source: unknown };
  /** Publish the drawn picture to the renderer (or null to clear). */
  publish: (source: CrtSource | null) => void;
  /** Set the shader/audio static level (0..1). */
  setStatic: (amount: number) => void;
  /** Monotonic clock in ms (injected so the presenter stays testable). */
  now: () => number;
  /** Schedule the next scene frame; defaults to a timer at ~50ms. */
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Preloaded bitmaps for a scene's image layers, by `src`. */
  getImages?: (sceneId: string) => Map<string, CanvasImageSource> | undefined;
}

function defaultCreateCanvas(w: number, h: number): { ctx: Ctx2D; source: unknown } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { ctx, source: canvas };
}

const REDRAW_MS = 50;

export class EventPresenter {
  private readonly ctx: Ctx2D;
  private readonly source: unknown;
  private readonly deps: EventPresenterDeps;
  private readonly requestFrame: (cb: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  /** The last text drawn (joined with \n), for a test seam. */
  private lastTextValue = '';
  private sceneFrame: number | null = null;
  /**
   * Repaints what a caption sits on, without any caption. The canvas keeps its
   * last frame, so a caption drawn straight onto it lands on top of the caption
   * before it, and a shorter band leaves the old lines showing.
   */
  private paintBase: () => void = () => {
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
  };

  constructor(deps: EventPresenterDeps) {
    this.deps = deps;
    const made = (deps.createCanvas ?? defaultCreateCanvas)(INTERNAL_WIDTH, INTERNAL_HEIGHT);
    this.ctx = made.ctx;
    this.source = made.source;
    this.requestFrame =
      deps.requestFrame ?? ((cb) => setTimeout(cb, REDRAW_MS) as unknown as number);
    this.cancelFrame =
      deps.cancelFrame ?? ((h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>));
  }

  /** The last text painted, so a test can assert what reached the picture. */
  lastText(): string {
    return this.lastTextValue;
  }

  /** Draw a slate (one line per `\n`) and publish it. */
  showSlate(text: string): void {
    this.stopSceneLoop();
    this.paintBase = () => drawSlate(this.ctx, text, { width: INTERNAL_WIDTH, height: INTERNAL_HEIGHT });
    this.paintBase();
    this.lastTextValue = text;
    this.publish();
  }

  /** Draw a caption over a static field and publish it (voice/degradation). */
  showCaption(caption: string): void {
    this.stopSceneLoop();
    this.paintBase();
    drawCaptionsOverStatic(this.ctx, caption, { width: INTERNAL_WIDTH, height: INTERNAL_HEIGHT });
    this.lastTextValue = caption;
    this.publish();
  }

  /** Draw the exact fixed sign-off text on a clean picture and publish it. */
  showSignOff(): void {
    this.stopSceneLoop();
    drawSignOff(this.ctx, { width: INTERNAL_WIDTH, height: INTERNAL_HEIGHT });
    this.lastTextValue = 'NO SIGNAL\nTHANK YOU FOR WATCHING.\nBROADCAST TERMINATED · 00:00:13';
    this.publish();
  }

  /**
   * Play `scene` for `durationMs`, drawing frames onto the canvas and publishing
   * each, so a `scene` event step actually shows its scene for its duration
   * instead of waiting 50 ms and showing nothing. Resolves when the duration
   * elapses or `cancelled()` becomes true. Captions follow the CC setting.
   */
  playScene(
    scene: SceneProgramInput,
    vars: SceneVars,
    durationMs: number,
    drawCaptions: boolean,
    cancelled: () => boolean = () => false,
  ): Promise<void> {
    this.stopSceneLoop();
    const start = this.deps.now();
    const images = this.deps.getImages?.(scene.id);
    const drawFrame = (): void => {
      const elapsed = this.deps.now() - start;
      const tMs = scene.durationMs > 0 ? elapsed % scene.durationMs : 0;
      const options = { ...(images ? { images } : {}) };
      renderScene(this.ctx, scene, tMs, vars, { ...options, drawCaptions });
      this.paintBase = () => renderScene(this.ctx, scene, tMs, vars, { ...options, drawCaptions: false });
      this.lastTextValue = (scene.captions ?? [])
        .filter((c) => tMs >= c.atMs && tMs < c.endMs)
        .map((c) => c.text)
        .join('\n');
      this.publish();
    };
    drawFrame();
    return new Promise<void>((resolve) => {
      const loop = (): void => {
        if (cancelled() || this.deps.now() - start >= durationMs) {
          this.stopSceneLoop();
          resolve();
          return;
        }
        drawFrame();
        this.sceneFrame = this.requestFrame(loop);
      };
      this.sceneFrame = this.requestFrame(loop);
    });
  }

  /**
   * Show a wrong picture for `durationMs`. Resolves when it ends or is cancelled.
   */
  showApparition(
    kind: ApparitionKind,
    text: string | undefined,
    durationMs: number,
    reduced: boolean,
    cancelled: () => boolean = () => false,
  ): Promise<void> {
    this.stopSceneLoop();
    const start = this.deps.now();
    const size = { width: INTERNAL_WIDTH, height: INTERNAL_HEIGHT, reduced };
    const drawFrame = (): void => {
      const t = this.deps.now() - start;
      drawApparition(this.ctx, kind, text, t, durationMs, size);
      this.lastTextValue = text ?? '';
      this.publish();
    };
    this.paintBase = () => drawApparition(this.ctx, kind, undefined, durationMs, durationMs, size);
    drawFrame();
    return new Promise<void>((resolve) => {
      const loop = (): void => {
        if (cancelled() || this.deps.now() - start >= durationMs) {
          this.stopSceneLoop();
          resolve();
          return;
        }
        drawFrame();
        this.sceneFrame = this.requestFrame(loop);
      };
      this.sceneFrame = this.requestFrame(loop);
    });
  }

  /** Clear the published picture (back to black/static). */
  clear(): void {
    this.stopSceneLoop();
    this.paintBase = () => {
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
    };
    this.deps.publish(null);
  }

  private publish(): void {
    this.deps.publish(this.source as CrtSource);
  }

  private stopSceneLoop(): void {
    if (this.sceneFrame !== null) {
      this.cancelFrame(this.sceneFrame);
      this.sceneFrame = null;
    }
  }
}

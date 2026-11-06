/**
 * Non-WebGL fallback renderer (requirement 5.3, design.md §10).
 *
 * When WebGL2 is unavailable the TV must remain operable. This draws the source
 * (or procedural snow) onto the tube canvas with a 2D context and leaves the
 * convincing CRT look to a CSS treatment class on the canvas — the design
 * explicitly sanctions a CSS-only surface treatment for this path. There is no
 * shader, so curvature/scanlines/etc. are approximate, but power, static and
 * boot/shutdown brightness all still read, and every control keeps working.
 *
 * Boot and shutdown reuse the same pure envelopes as the WebGL path, so timing
 * matches. Flashes are not produced here (no shader pulses), so there is nothing
 * for the flash limiter to gate; reduced effects simply pins static to a calm
 * grain, consistent with requirement 13.2.
 */

import { type Look } from '../core/types.ts';
import { type CrtSource } from './CrtRenderer.ts';
import { type Renderer } from './Renderer.ts';
import { bootDrive, isComplete, shutdownDrive, type EnvelopePhase } from './envelope.ts';
import { cappedResolution } from './looks.ts';

/** CSS class applied to the canvas so the fallback gets a scanline/vignette look. */
export const FALLBACK_TREATMENT_CLASS = 'crtFallback';

export class FallbackRenderer implements Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private power = 0;
  private staticAmount = 0;
  private tuning = false;
  private reducedEffects = false;
  private source: CrtSource | null = null;

  private envelopePhase: EnvelopePhase = 'idle';
  private envelopeStartMs = 0;
  private envelopeDurationMs = 0;
  private onEnvelopeDone: (() => void) | null = null;

  private rafId: number | null = null;
  private running = false;

  private constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** Create a fallback renderer, or null if even a 2D context is unavailable. */
  static create(canvas: HTMLCanvasElement): FallbackRenderer | null {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    canvas.classList.add(FALLBACK_TREATMENT_CLASS);
    return new FallbackRenderer(canvas, ctx);
  }

  setLook(_look: Look): void {
    // The CSS treatment is look-agnostic in the fallback; presets only tune the
    // shader. Kept for interface parity.
    void _look;
  }

  setStatic(amount: number): void {
    this.staticAmount = clamp01(amount);
  }

  setPower(amount: number): void {
    this.power = clamp01(amount);
  }

  setTuning(active: boolean): void {
    this.tuning = active;
  }

  setReducedEffects(reduced: boolean): void {
    this.reducedEffects = reduced;
  }

  setSource(source: CrtSource | null): void {
    this.source = source;
  }

  startBoot(durationMs: number, onDone?: () => void): void {
    this.beginEnvelope('boot', durationMs, onDone);
  }

  startShutdown(durationMs: number, onDone?: () => void): void {
    this.beginEnvelope('shutdown', durationMs, onDone);
  }

  start(now: number = nowMs()): void {
    if (this.running) return;
    this.running = true;
    void now;
    const tick = (t: number) => {
      if (!this.running) return;
      this.renderFrame(t);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    this.stop();
    this.canvas.classList.remove(FALLBACK_TREATMENT_CLASS);
  }

  /** Draw one frame: source or snow, dimmed by the power envelope. */
  renderFrame(t: number = nowMs()): void {
    this.applyEnvelope(t);
    this.resize();

    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    if (this.power <= 0) return;

    // Draw the source when present and ready; otherwise a dark field.
    if (this.source && isSourceReady(this.source)) {
      ctx.globalAlpha = this.power;
      try {
        ctx.drawImage(this.source, 0, 0, w, h);
      } catch {
        // A not-yet-decodable source: leave the dark field.
      }
      ctx.globalAlpha = 1;
    }

    // Snow: full during tuning, otherwise the configured amount. Reduced effects
    // turns lively snow into a calm, low grain (requirement 13.2).
    const snow = this.tuning ? 1 : this.staticAmount;
    const amount = this.reducedEffects ? Math.min(snow, 0.15) : snow;
    if (amount > 0) this.drawSnow(w, h, amount * this.power, t);
  }

  private drawSnow(w: number, h: number, intensity: number, t: number): void {
    // Chunky value noise, seeded by time, quantised so it reads like snow rather
    // than per-pixel fizz. Cheap enough for the fallback path.
    const ctx = this.ctx;
    const cell = 3;
    const seed = this.reducedEffects ? 0 : Math.floor(t / 33);
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const n = hash2(x + seed, y + seed);
        if (n > 1 - intensity) {
          const v = Math.floor(n * 255);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
  }

  private resize(): void {
    const { canvas } = this;
    const { width, height } = cappedResolution(
      canvas.clientWidth || canvas.width,
      canvas.clientHeight || canvas.height,
    );
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  private beginEnvelope(
    phase: Exclude<EnvelopePhase, 'idle'>,
    durationMs: number,
    onDone?: () => void,
  ): void {
    this.envelopePhase = phase;
    this.envelopeDurationMs = Math.max(0, durationMs);
    this.envelopeStartMs = nowMs();
    this.onEnvelopeDone = onDone ?? null;
    this.applyEnvelope(this.envelopeStartMs);
  }

  private applyEnvelope(now: number): void {
    if (this.envelopePhase === 'idle') return;
    const drive =
      this.envelopePhase === 'boot'
        ? bootDrive(this.envelopeStartMs, now, this.envelopeDurationMs)
        : shutdownDrive(this.envelopeStartMs, now, this.envelopeDurationMs);
    this.power = drive.power;
    if (isComplete(this.envelopeStartMs, now, this.envelopeDurationMs)) {
      this.envelopePhase = 'idle';
      const done = this.onEnvelopeDone;
      this.onEnvelopeDone = null;
      done?.();
    }
  }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function isSourceReady(source: CrtSource): boolean {
  if (source instanceof HTMLVideoElement) return source.readyState >= 2 && source.videoWidth > 0;
  if (source instanceof HTMLImageElement) return source.complete && source.naturalWidth > 0;
  return source.width > 0 && source.height > 0;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

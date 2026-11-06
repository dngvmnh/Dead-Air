/**
 * WebGL2 CRT pipeline (design.md §10, requirement 5).
 *
 * This is the render layer, not core — it may touch the DOM and WebGL. It owns
 * a WebGL2 context on the tube canvas, compiles the shader from crtShader.ts,
 * and draws one full-screen pass per frame, sampling a source texture (a
 * <video>, a 2D canvas, or nothing → black/static) and applying the look
 * presets from looks.ts.
 *
 * Scope of THIS task (4.1): the happy-path pipeline, uniforms, look presets and
 * procedural static. Boot/shutdown/tuning transitions (4.2) and flashLimiter /
 * reduced-effects / context-restore / non-WebGL fallback (4.3) are deliberately
 * left out, but the structure leaves clean seams for them:
 *
 *   - `CrtRenderer.create()` returns null when WebGL2 is unavailable, so 4.3's
 *     fallback renderer can be chosen by the caller without this class throwing.
 *   - `setLook`, `setStatic`, `setPower` and `setTransient` expose the exact
 *     knobs 4.2 animates; today they are driven directly.
 *   - The render loop reads live uniform state every frame, so an animating
 *     caller (4.2) only has to update state, not restart the loop.
 *
 * NOTE: no screen effect is applied through DOM/CSS on the canvas. Curvature,
 * scanlines, shake, roll and collapse all happen in the fragment shader.
 */

import {
  FRAGMENT_SHADER_SOURCE,
  VERTEX_SHADER_SOURCE,
  packUniforms,
  type CrtUniforms,
} from './crtShader.ts';
import {
  DEFAULT_LOOK,
  INERT_TRANSIENT,
  cappedResolution,
  lookPreset,
} from './looks.ts';
import {
  bootDrive,
  isComplete,
  shutdownDrive,
  type EnvelopePhase,
} from './envelope.ts';
import { FlashLimiter } from './flashLimiter.ts';
import { type Look } from '../core/types.ts';

/** Options for {@link CrtRenderer.create}. */
export interface CrtRendererOptions {
  /**
   * Keep the drawing buffer after compositing so the canvas can be read back
   * with `gl.readPixels` on a later frame. Off in production: this renderer
   * draws every frame, and preserving the buffer can cost performance, which
   * matters for the unmeasured 60 fps budget (tech.md). Tests enable it so the
   * pixel-readback proof is reliable; app code leaves it false and reads pixels
   * in the same frame as the draw instead.
   */
  preserveDrawingBuffer?: boolean;
}

/** Anything the shader can sample as a 2D texture. */
export type CrtSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;

/** True when the document can give us a WebGL2 context (capability seam for 4.3). */
export function supportsWebGL2(canvas?: HTMLCanvasElement): boolean {
  try {
    const c = canvas ?? document.createElement('canvas');
    return c.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

const TEXTURE_UNIT = 0;

/** A 1×1 black pixel used as the source until a real one is set. */
const BLACK_PIXEL = new Uint8Array([0, 0, 0, 255]);

type Transient = Omit<CrtUniforms, keyof ReturnType<typeof lookPreset> | 'resolution'>;

export class CrtRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  // GL objects are rebuilt on context restore (requirement 5.5), so they are
  // not readonly.
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private texture: WebGLTexture;
  private locations: Map<string, WebGLUniformLocation | null> = new Map();

  private look: Look = DEFAULT_LOOK;
  private transient: Transient = { ...INERT_TRANSIENT };
  private source: CrtSource | null = null;

  private startTime = 0;
  private rafId: number | null = null;
  private running = false;

  // --- Safety & robustness (task 4.3) ---------------------------------------
  /** Gates every flashing effect to ≤3 per rolling second (requirement 13.1). */
  private readonly flashLimiter = new FlashLimiter();
  /** Reduced effects / reduced motion: zero roll, tear and flashes (req 13.2). */
  private reducedEffects = false;
  /** True between webglcontextlost and webglcontextrestored; skips drawing. */
  private contextLost = false;

  // --- Transition envelopes (task 4.2) --------------------------------------
  // The active boot/shutdown transition and when it began, in the same clock as
  // the render loop. Advanced each frame in `applyEnvelope`; idle leaves the
  // directly-set transient values (setPower/setStatic) untouched.
  private envelopePhase: EnvelopePhase = 'idle';
  private envelopeStartMs = 0;
  private envelopeDurationMs = 0;
  /** When true, hold full static (tuning). Released by setTuning(false). */
  private tuning = false;
  /** Fires once when the active boot/shutdown envelope finishes. */
  private onEnvelopeDone: (() => void) | null = null;

  private constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = canvas;
    this.program = this.buildProgram();
    this.vao = this.buildVao();
    this.texture = this.buildTexture();
    this.cacheLocations();
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  /**
   * On context loss, prevent the default (which would stop restoration) and
   * pause drawing. The GL objects are invalid until restore (requirement 5.5).
   */
  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
  };

  /** On restore, rebuild the program, VAO, texture and uniform locations. */
  private readonly handleContextRestored = (): void => {
    this.program = this.buildProgram();
    this.vao = this.buildVao();
    this.texture = this.buildTexture();
    this.cacheLocations();
    this.contextLost = false;
  };

  /**
   * Create a renderer on a canvas, or return null if WebGL2 is unavailable.
   * Returning null (rather than throwing) is the seam task 4.3 uses to drop to
   * the non-WebGL fallback and keep the TV operable (requirement 5.3).
   */
  static create(
    canvas: HTMLCanvasElement,
    options: CrtRendererOptions = {},
  ): CrtRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      // Off in production (see CrtRendererOptions). Tests opt in so readPixels
      // on a later frame is reliable; the app reads pixels in-frame instead.
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      powerPreference: 'low-power',
    });
    if (!gl) return null;
    return new CrtRenderer(gl, canvas);
  }

  // --- Public knobs (driven directly now; animated by 4.2/4.3) --------------

  /** Choose the resting look preset for the current source. */
  setLook(look: Look): void {
    this.look = look;
  }

  /** 0..1 snow mix. Set to 1 during tuning (task 4.2 ramps it). */
  setStatic(amount: number): void {
    this.transient.static = clamp01(amount);
  }

  /** 0..1 power envelope. Boot ramps up, shutdown ramps down (task 4.2). */
  setPower(amount: number): void {
    this.transient.power = clamp01(amount);
  }

  /** Overwrite any transient effect fields at once (roll/tear/collapse, etc.). */
  setTransient(patch: Partial<Transient>): void {
    this.transient = { ...this.transient, ...patch };
  }

  /**
   * Set the source texture, or clear it with null (→ black / full static).
   * The source is re-uploaded every frame while running (video frames change).
   */
  setSource(source: CrtSource | null): void {
    this.source = source;
  }

  // --- Transitions (task 4.2) ----------------------------------------------

  /**
   * Begin the CRT warm-up: over `durationMs` the picture expands from a dark
   * collapsed line to a full bright image (requirement 1.3, ≤1500ms). The
   * render loop advances the envelope each frame and calls `onDone` once at the
   * end. Picks up the current clock so a boot started while running is smooth.
   */
  startBoot(durationMs: number, onDone?: () => void): void {
    this.beginEnvelope('boot', durationMs, onDone);
  }

  /**
   * Begin the shutdown collapse: over `durationMs` the picture collapses to a
   * line and dot and darkens (requirement 1.4, ≤800ms). `onDone` fires once at
   * the end so the caller can finish powering off (black, audio silenced).
   */
  startShutdown(durationMs: number, onDone?: () => void): void {
    this.beginEnvelope('shutdown', durationMs, onDone);
  }

  /**
   * Hold full static while acquiring a station (tuning), or release it. While
   * active, uStatic is pinned to 1 regardless of setStatic; releasing restores
   * the directly-set static value.
   */
  setTuning(active: boolean): void {
    this.tuning = active;
  }

  /**
   * Toggle reduced effects (Reduced Effects switch or prefers-reduced-motion).
   * When on, roll, tear and flashes are disabled (requirement 13.2): any
   * current roll/tear is zeroed and the flash limiter denies every request so
   * no effect can flash. Collapse and power are left alone so boot and shutdown
   * still read correctly.
   */
  setReducedEffects(reduced: boolean): void {
    this.reducedEffects = reduced;
    this.flashLimiter.setSuppressed(reduced);
    if (reduced) {
      this.transient.roll = 0;
      this.transient.tear = 0;
    }
  }

  get reducedEffectsEnabled(): boolean {
    return this.reducedEffects;
  }

  /**
   * Request a single luminance flash through the shared flash limiter
   * (requirement 13.1). EVERY flashing effect must go through here — the
   * renderer grants at most three flashes per rolling second and none at all
   * when reduced effects is on. Returns true if the flash was permitted.
   *
   * On success the caller's `apply` runs so it can drive the flash (set a
   * transient pulse, capture a frame, etc.); on denial nothing happens and the
   * screen stays safe regardless of what the content asked for.
   */
  requestFlash(nowMs: number, apply?: () => void): boolean {
    const granted = this.flashLimiter.tryFlash(nowMs);
    if (granted) apply?.();
    return granted;
  }

  /** Flashes allowed right now (0..3); 0 when reduced effects is on. */
  flashBudget(nowMs: number): number {
    return this.flashLimiter.remaining(nowMs);
  }

  /** Enable roll interference, but only when reduced effects is off (req 13.2). */
  setRoll(amount: number): void {
    this.transient.roll = this.reducedEffects ? 0 : clamp01(amount);
  }

  /** Enable horizontal tear/jitter, but only when reduced effects is off. */
  setTear(amount: number): void {
    this.transient.tear = this.reducedEffects ? 0 : clamp01(amount);
  }

  /** The transition currently playing, or 'idle'. Exposed for tests/UI. */
  get currentEnvelope(): EnvelopePhase {
    return this.envelopePhase;
  }

  /** Read-only snapshot of the live transient uniforms (for tests/diagnostics). */
  get drive(): Readonly<Transient> {
    return { ...this.transient };
  }

  /** Current time in the same clock the render loop uses (performance.now). */
  private clockMs(): number {
    return performanceNow();
  }

  private beginEnvelope(
    phase: Exclude<EnvelopePhase, 'idle'>,
    durationMs: number,
    onDone?: () => void,
  ): void {
    this.envelopePhase = phase;
    this.envelopeDurationMs = Math.max(0, durationMs);
    this.envelopeStartMs = this.clockMs();
    this.onEnvelopeDone = onDone ?? null;
    // Seed the transient immediately so the first frame is already at the start
    // of the envelope rather than whatever the previous phase left behind.
    this.applyEnvelope(this.envelopeStartMs);
  }

  /**
   * Advance the active boot/shutdown envelope to time `now` and write its
   * drive values into the transient uniforms. Tuning pins static to 1. When a
   * transition completes it latches its end values, fires `onDone` once, and
   * returns to idle.
   */
  private applyEnvelope(now: number): void {
    if (this.envelopePhase !== 'idle') {
      const drive =
        this.envelopePhase === 'boot'
          ? bootDrive(this.envelopeStartMs, now, this.envelopeDurationMs)
          : shutdownDrive(this.envelopeStartMs, now, this.envelopeDurationMs);
      this.transient.power = drive.power;
      this.transient.collapse = drive.collapse;
      if (isComplete(this.envelopeStartMs, now, this.envelopeDurationMs)) {
        this.envelopePhase = 'idle';
        const done = this.onEnvelopeDone;
        this.onEnvelopeDone = null;
        done?.();
      }
    }
    if (this.tuning) this.transient.static = 1;
  }

  // --- Render loop ----------------------------------------------------------

  /** Begin the per-frame render loop. Idempotent. */
  start(now: number = performanceNow()): void {
    if (this.running) return;
    this.running = true;
    this.startTime = now;
    const tick = (t: number) => {
      if (!this.running) return;
      this.renderFrame(t);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Stop the render loop. Safe to call when not running. */
  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Resize the drawing buffer to the capped internal resolution for the canvas's
   * current CSS size. The internal resolution never follows devicePixelRatio
   * (requirement 5.4 / tech.md budget): the browser scales the small buffer up.
   */
  resize(cssWidth: number, cssHeight: number): void {
    const { width, height } = cappedResolution(cssWidth, cssHeight);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /** Render a single frame at time `t` (ms, matching requestAnimationFrame). */
  renderFrame(t: number = performanceNow()): void {
    const gl = this.gl;

    // While the context is lost the GL objects are invalid; skip drawing until
    // webglcontextrestored rebuilds them (requirement 5.5).
    if (this.contextLost || gl.isContextLost()) return;

    // Advance any active boot/shutdown transition and tuning hold before we
    // read the transient uniforms for this frame.
    this.applyEnvelope(t);

    // Keep the buffer at the capped resolution for the canvas's CSS box.
    this.resize(this.canvas.clientWidth || this.canvas.width, this.canvas.clientHeight || this.canvas.height);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.uploadSource();

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const uniforms: CrtUniforms = {
      ...lookPreset(this.look),
      resolution: [this.canvas.width, this.canvas.height],
      ...this.transient,
      time: (t - this.startTime) / 1000,
    };
    this.uploadUniforms(uniforms);

    // Source texture on unit 0.
    gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Release GL resources. The caller drops the reference afterwards. */
  dispose(): void {
    this.stop();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }

  // --- Setup ---------------------------------------------------------------

  private buildProgram(): WebGLProgram {
    const gl = this.gl;
    const vert = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const frag = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    const program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    // Shaders can be deleted once linked.
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`CRT program link failed: ${log ?? 'unknown error'}`);
    }
    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('CRT shader allocation failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`CRT shader compile failed: ${log ?? 'unknown error'}`);
    }
    return shader;
  }

  private buildVao(): WebGLVertexArrayObject {
    const gl = this.gl;
    // The full-screen triangle is generated from gl_VertexID; an empty VAO is
    // enough to issue the draw.
    const vao = gl.createVertexArray();
    return vao;
  }

  private buildTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, BLACK_PIXEL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  private cacheLocations(): void {
    const gl = this.gl;
    const names = [
      'uSource', 'uResolution', 'uTime', 'uCurvature', 'uScanline', 'uMask',
      'uBloom', 'uAberration', 'uNoise', 'uVignette', 'uRoll', 'uTear',
      'uCollapse', 'uStatic', 'uPower',
    ];
    for (const name of names) {
      this.locations.set(name, gl.getUniformLocation(this.program, name));
    }
  }

  // --- Per-frame uploads ----------------------------------------------------

  private uploadSource(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (this.source && this.isSourceReady(this.source)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.source);
    } else {
      // No source yet: keep a black 1×1 so the shader's static/power still show.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, BLACK_PIXEL);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  private isSourceReady(source: CrtSource): boolean {
    if (source instanceof HTMLVideoElement) {
      // readyState >= HAVE_CURRENT_DATA (2) means a frame is available.
      return source.readyState >= 2 && source.videoWidth > 0;
    }
    if (source instanceof HTMLImageElement) {
      return source.complete && source.naturalWidth > 0;
    }
    // Canvas is always sampleable once it has a non-zero size.
    return source.width > 0 && source.height > 0;
  }

  private uploadUniforms(u: CrtUniforms): void {
    const gl = this.gl;
    const packed = packUniforms(u);

    // Sampler always on unit 0.
    const sourceLoc = this.locations.get('uSource');
    if (sourceLoc) gl.uniform1i(sourceLoc, TEXTURE_UNIT);

    for (const [name, value] of Object.entries(packed)) {
      const loc = this.locations.get(name);
      if (!loc) continue;
      if (Array.isArray(value)) {
        gl.uniform2f(loc, value[0], value[1]);
      } else {
        gl.uniform1f(loc, value as number);
      }
    }
  }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

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
import { type Look } from '../core/types.ts';

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
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly texture: WebGLTexture;
  private readonly locations: Map<string, WebGLUniformLocation | null> = new Map();

  private look: Look = DEFAULT_LOOK;
  private transient: Transient = { ...INERT_TRANSIENT };
  private source: CrtSource | null = null;

  private startTime = 0;
  private rafId: number | null = null;
  private running = false;

  private constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = canvas;
    this.program = this.buildProgram();
    this.vao = this.buildVao();
    this.texture = this.buildTexture();
    this.cacheLocations();
  }

  /**
   * Create a renderer on a canvas, or return null if WebGL2 is unavailable.
   * Returning null (rather than throwing) is the seam task 4.3 uses to drop to
   * the non-WebGL fallback and keep the TV operable (requirement 5.3).
   */
  static create(canvas: HTMLCanvasElement): CrtRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      // Keep the last frame readable so pixel readback (the e2e proof that the
      // shader actually drew) is deterministic rather than racing the compositor.
      preserveDrawingBuffer: true,
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

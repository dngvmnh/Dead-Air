/**
 * Draws a {@link TearSheet} as a lit, tearable wall (design §3). This is the
 * render layer, so it may touch WebGL and the DOM; the simulation itself stays
 * pure in `core/tearSheet`.
 *
 * Each frame has three parts:
 *
 * 1. Mask: the surviving triangles are drawn white into a small texture and
 *    blurred. It reads 1 deep in the paper, about 0.5 on a torn edge and 0 in
 *    the middle of a hole, so it works as a cheap distance to the edge.
 * 2. Behind: the whole frame is filled with what is behind the wall, lit by the
 *    same room light as the paper and darkened by the mask, so an opening is
 *    darkest in its middle.
 * 3. Paper: the mesh, with its outline eroded by fibre noise against the mask,
 *    so a tear looks ripped rather than polygonal at this coarse grid.
 *
 * A triangle with a broken edge is dropped from the element buffer, which is
 * rebuilt only when the topology changes. Node positions upload every frame.
 */

import type { TearSheet } from '../core/tearSheet.ts';
import { buildSheetMesh, liveTriangles, markStretched, type SheetMesh } from './sheetMesh.ts';

/** Shared light model, so paper and what is behind it sit in the same room. */
const ROOM_LIGHT = `
uniform float uAmbient;      // base room light 0..1 (falls by act)
uniform vec3 uLight;         // picture glow colour 0..1
uniform float uLightAmount;  // picture glow strength 0..1
uniform vec2 uLightCenter;   // where the set sits, in screen 0..1
uniform float uLevel;        // scripted room level 0..1 (the lights sinking)
float roomPool(vec2 screen) {
  vec2 dv = screen - uLightCenter;
  dv.x *= 1.15;              // roughly round on a wide screen
  return exp(-dot(dv, dv) * 7.0);
}
float roomLit(float pool) {
  return (uAmbient * 0.35 + uLightAmount * pool * 1.35) * uLevel;
}`;

export const NOISE = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}`;

const PAPER_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;    // node position in grid units
layout(location=1) in vec2 aUV;     // rest UV 0..1
layout(location=2) in float aZ;     // curl/lift
uniform vec2 uGrid;                 // cols-1, rows-1
out vec2 vUV;
out vec2 vScreen;
out float vZ;
void main() {
  vUV = aUV;
  vZ = aZ;
  vec2 n = aPos / uGrid;
  vScreen = n;
  gl_Position = vec4(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);
}`;

const PAPER_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vScreen;
in float vZ;
uniform sampler2D uFront;
uniform sampler2D uMask;
uniform vec2 uRes;
out vec4 frag;
${ROOM_LIGHT}
${NOISE}
void main() {
  float m = texture(uMask, gl_FragCoord.xy / uRes).r;
  float fibre =
      noise(vUV * 300.0) * 0.45 +
      noise(vUV * 110.0) * 0.30 +
      noise(vUV * vec2(70.0, 460.0)) * 0.25;
  // Every torn edge is eaten back a little, by a noisy amount. The minimum is
  // above the mask's value on the geometric edge, so no straight mesh edge can
  // survive to be seen.
  float threshold = 0.54 + fibre * 0.3;
  if (m < threshold) discard;
  // Pale paper fibres on the very edge, the paper's lighter core showing.
  float band = 1.0 - smoothstep(threshold, threshold + 0.1, m);
  // A flap catches the light on its raised side.
  float shade = clamp(0.62 + vZ * 0.3, 0.25, 1.1);
  // Paper near an edge has come away from the wall, so it curls and darkens.
  float curl = smoothstep(threshold, threshold + 0.22, m);
  vec4 c = texture(uFront, vUV);
  float pool = roomPool(vScreen);
  float lit = roomLit(pool);
  vec3 col = c.rgb * shade * mix(0.72, 1.0, curl) * lit + c.rgb * uLight * (uLightAmount * pool * 0.9 * uLevel);
  vec3 fibreCol = vec3(0.78, 0.74, 0.66) * (0.5 + 0.5 * fibre);
  col = mix(col, fibreCol * clamp(lit * 1.1, 0.12 * uLevel, 0.7), band * 0.85);
  frag = vec4(col, 1.0);
}`;

/** Fills the frame; the fragment shader works from gl_FragCoord. */
export const FULLSCREEN_VERT = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const BEHIND_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uBehind;
uniform sampler2D uEmissive;
uniform sampler2D uGlimpse;
uniform sampler2D uFigure;
uniform sampler2D uMask;
uniform vec2 uRes;
uniform float uHoleFloor;   // light left in the middle of a hole, 0..1
uniform float uMaskOn;      // test seam
uniform float uTime;
uniform float uMotion;      // slow movement in the dark, 0..1
uniform vec2 uShapePos;     // a shape in the dark, in screen 0..1
uniform float uShapeAmt;
uniform float uGlimpseAmt;
out vec4 frag;
${ROOM_LIGHT}
${NOISE}
void main() {
  // Test seam: a flat colour, so a test can measure a hole's exact shape.
  if (uMaskOn > 0.5) { frag = vec4(1.0, 0.0, 1.0, 1.0); return; }
  vec2 raw = gl_FragCoord.xy / uRes;
  vec2 uv = vec2(raw.x, 1.0 - raw.y);
  vec3 c = texture(uBehind, uv).rgb;

  if (uMotion > 0.0) {
    float n = noise(uv * vec2(5.0, 3.0) + vec2(uTime * 0.018, uTime * 0.027));
    c *= mix(1.0, n * 1.7, uMotion);
  }

  float pool = roomPool(uv);
  float lit = roomLit(pool);
  vec3 col = c * lit + c * uLight * (uLightAmount * pool * 0.5 * uLevel);

  // The mask reads about 0.5 on a torn edge and 0 in the middle of a hole, so
  // light falls away with depth.
  float m = texture(uMask, raw).r;
  float rim = smoothstep(0.03, 0.5, m);
  col *= mix(uHoleFloor, 1.0, rim * rim);

  // The paper above and to the left casts a soft shadow into the opening.
  float paperAbove = texture(uMask, raw + vec2(-5.0, 6.0) / uRes).r;
  col *= 1.0 - 0.45 * smoothstep(0.3, 0.85, paperAbove);

  // Whatever the picture does, the inside of a wall is never the brightest thing
  // in the room.
  col = min(col, vec3(0.42));

  if (uShapeAmt > 0.0) {
    // It stands in the dark at about the height of the window. Added after the
    // hole floor, which would otherwise hide it.
    vec2 p = (uv - uShapePos - vec2(0.0, 0.2)) * vec2(uRes.x / uRes.y, 1.0) / 1.15 + 0.5;
    if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {
      col += texture(uFigure, p).rgb * 0.42 * uShapeAmt * (0.6 + 0.4 * uLevel);
    }
  }

  // Things behind the wall that give their own light.
  col += texture(uEmissive, uv).rgb * (0.35 + 0.65 * uLevel);
  col += texture(uGlimpse, uv).rgb * uGlimpseAmt;
  frag = vec4(col, 1.0);
}`;

export const MASK_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform vec2 uGrid;
void main() {
  vec2 n = aPos / uGrid;
  gl_Position = vec4(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);
}`;

export const MASK_FRAG = `#version 300 es
precision highp float;
out vec4 frag;
void main() { frag = vec4(1.0); }`;

export const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSrc, 0));
  float v = texture(uSrc, uv).r * 0.2;
  v += (texture(uSrc, uv + uStep).r + texture(uSrc, uv - uStep).r) * 0.18;
  v += (texture(uSrc, uv + uStep * 2.0).r + texture(uSrc, uv - uStep * 2.0).r) * 0.14;
  v += (texture(uSrc, uv + uStep * 3.0).r + texture(uSrc, uv - uStep * 3.0).r) * 0.08;
  frag = vec4(v, v, v, 1.0);
}`;

/** The mask's size. Each texel is about 4 screen pixels, which sets the blur. */
const MASK_W = 320;
const MASK_H = 200;
/** Light left in the middle of a hole in an ordinary wall. */
const DEFAULT_HOLE_FLOOR = 0.12;
export interface TearGLOptions {
  preserveDrawingBuffer?: boolean;
}

/** What is behind the wall: lit paint, its own light, and how it behaves. */
export interface BehindLayer {
  albedo: TexImageSource;
  emissive: TexImageSource | null;
  holeFloor: number;
  motion: number;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('tear shader alloc failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`tear shader compile failed: ${log ?? ''}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const v = compile(gl, gl.VERTEX_SHADER, vert);
  const f = compile(gl, gl.FRAGMENT_SHADER, frag);
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`tear link failed: ${log ?? ''}`);
  }
  return p;
}

/** GPU objects, grouped so a restored context can rebuild them in one call. */
interface Gpu {
  paper: WebGLProgram;
  behind: WebGLProgram;
  mask: WebGLProgram;
  blur: WebGLProgram;
  emptyVao: WebGLVertexArrayObject;
  vao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  uvBuf: WebGLBuffer;
  zBuf: WebGLBuffer;
  indexBuf: WebGLBuffer;
  frontTex: WebGLTexture;
  behindTex: WebGLTexture;
  emissiveTex: WebGLTexture;
  glimpseTex: WebGLTexture;
  figureTex: WebGLTexture;
  maskTex: [WebGLTexture, WebGLTexture];
  maskFbo: [WebGLFramebuffer, WebGLFramebuffer];
}

export class TearGLRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private gpu: Gpu;

  private sheet: TearSheet | null = null;
  private indexCount = 0;
  private posArray = new Float32Array(0);
  private zArray = new Float32Array(0);
  private contextLost = false;
  private startMs = 0;
  private ambient = 0.6;
  private light: [number, number, number] = [0, 0, 0];
  private lightAmount = 0;
  private lightCenter: [number, number] = [0.5, 0.5];
  private level = 1;
  private holeMask = false;
  private holeFloor = DEFAULT_HOLE_FLOOR;
  private motion = 0;
  private shape: [number, number, number] = [0.5, 0.5, 0];
  private glimpseAmount = 0;
  /** Sources kept so a restored context can upload them again. */
  private frontSrc: TexImageSource | null = null;
  private behindSrc: TexImageSource | null = null;
  private emissiveSrc: TexImageSource | null = null;
  private glimpseSrc: TexImageSource | null = null;
  private figureSrc: TexImageSource | null = null;
  private mesh: SheetMesh | null = null;
  private lastBrokenCount = -1;
  private lastStretchedCount = -1;

  private constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = canvas;
    this.gpu = this.buildGpu();
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  static create(canvas: HTMLCanvasElement, options: TearGLOptions = {}): TearGLRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      powerPreference: 'low-power',
    });
    if (!gl) return null;
    return new TearGLRenderer(gl, canvas);
  }

  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };

  private readonly onRestored = (): void => {
    this.gpu = this.buildGpu();
    this.contextLost = false;
    if (this.frontSrc) this.uploadTex(this.gpu.frontTex, this.frontSrc);
    if (this.behindSrc) this.uploadTex(this.gpu.behindTex, this.behindSrc);
    if (this.emissiveSrc) this.uploadTex(this.gpu.emissiveTex, this.emissiveSrc);
    if (this.glimpseSrc) this.uploadTex(this.gpu.glimpseTex, this.glimpseSrc);
    if (this.figureSrc) this.uploadTex(this.gpu.figureTex, this.figureSrc);
    if (this.sheet) this.setSheet(this.sheet);
  };

  private buildGpu(): Gpu {
    const gl = this.gl;
    const maskTex: [WebGLTexture, WebGLTexture] = [this.makeMaskTex(), this.makeMaskTex()];
    const maskFbo: [WebGLFramebuffer, WebGLFramebuffer] = [gl.createFramebuffer(), gl.createFramebuffer()];
    maskFbo.forEach((fbo, i) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, maskTex[i]!, 0);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {
      paper: link(gl, PAPER_VERT, PAPER_FRAG),
      behind: link(gl, FULLSCREEN_VERT, BEHIND_FRAG),
      mask: link(gl, MASK_VERT, MASK_FRAG),
      blur: link(gl, FULLSCREEN_VERT, BLUR_FRAG),
      emptyVao: gl.createVertexArray(),
      vao: gl.createVertexArray(),
      posBuf: gl.createBuffer(),
      uvBuf: gl.createBuffer(),
      zBuf: gl.createBuffer(),
      indexBuf: gl.createBuffer(),
      frontTex: this.makeTex([40, 36, 30, 255]),
      behindTex: this.makeTex([40, 36, 30, 255]),
      emissiveTex: this.makeTex([0, 0, 0, 255]),
      glimpseTex: this.makeTex([0, 0, 0, 255]),
      figureTex: this.makeTex([0, 0, 0, 255]),
      maskTex,
      maskFbo,
    };
  }

  private makeTex(pixel: [number, number, number, number]): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixel));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  private makeMaskTex(): WebGLTexture {
    const gl = this.gl;
    const t = this.makeTex([255, 255, 255, 255]);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MASK_W, MASK_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  /** Bind the sheet and build the static UVs and triangle list. */
  setSheet(sheet: TearSheet): void {
    this.sheet = sheet;
    const gl = this.gl;
    const { cols, rows } = sheet;
    const n = cols * rows;
    this.posArray = new Float32Array(n * 2);
    this.zArray = new Float32Array(n);

    const mesh = buildSheetMesh(sheet);
    this.mesh = mesh;
    this.lastBrokenCount = -1;
    this.lastStretchedCount = -1;

    const { vao, posBuf, uvBuf, zBuf, indexBuf } = this.gpu;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.posArray, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, zBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.zArray, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.triangles), gl.DYNAMIC_DRAW);
    this.indexCount = mesh.triangles.length;
    gl.bindVertexArray(null);
  }

  /** Upload a 2D canvas/image as the front (paper) texture. */
  setFrontTexture(src: TexImageSource): void {
    this.frontSrc = src;
    this.uploadTex(this.gpu.frontTex, src);
  }

  /** Replace what is behind the wall. */
  setBehindLayer(layer: BehindLayer): void {
    this.behindSrc = layer.albedo;
    this.uploadTex(this.gpu.behindTex, layer.albedo);
    this.emissiveSrc = layer.emissive;
    if (layer.emissive) {
      this.uploadTex(this.gpu.emissiveTex, layer.emissive);
    } else {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.gpu.emissiveTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    }
    this.holeFloor = layer.holeFloor;
    this.motion = layer.motion;
  }

  /** Set the room lighting for the next frame (ambient + picture glow). */
  setLight(ambient: number, light: { r: number; g: number; b: number; amount: number }): void {
    this.ambient = ambient;
    this.light = [light.r / 255, light.g / 255, light.b / 255];
    this.lightAmount = light.amount;
  }

  /** Scripted room level 0..1, multiplying all room light (the lights sinking). */
  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(1, level));
  }

  /** A shape far back in the dark, at screen 0..1. Amount 0 removes it. */
  setShape(x: number, y: number, amount: number): void {
    this.shape = [x, y, amount];
  }

  /** Upload what stands in the dark. */
  setFigure(src: TexImageSource): void {
    this.figureSrc = src;
    this.uploadTex(this.gpu.figureTex, src);
  }

  /** Upload what can be glimpsed through a tear. */
  setGlimpse(src: TexImageSource): void {
    this.glimpseSrc = src;
    this.uploadTex(this.gpu.glimpseTex, src);
  }

  /** How visible the glimpse is, 0..1. */
  setGlimpseAmount(amount: number): void {
    this.glimpseAmount = Math.max(0, Math.min(1, amount));
  }

  /** Test seam: paint everything behind the paper a flat colour. */
  setHoleMask(on: boolean): void {
    this.holeMask = on;
  }

  /** Set where the set sits (the light-pool centre), in screen 0..1. */
  setLightCenter(x: number, y: number): void {
    this.lightCenter = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  }

  private uploadTex(tex: WebGLTexture, src: TexImageSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch {
      // Source not ready; keep the previous texture.
    }
  }

  resize(cssWidth: number, cssHeight: number, cap: { w: number; h: number }): void {
    const w = Math.min(Math.max(1, Math.round(cssWidth)), cap.w);
    const h = Math.min(Math.max(1, Math.round(cssHeight)), cap.h);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /** Draw the current sheet: mask, what is behind the wall, then the paper. */
  render(nowMs: number): void {
    const gl = this.gl;
    const sheet = this.sheet;
    if (this.contextLost || gl.isContextLost() || !sheet) return;
    if (this.startMs === 0) this.startMs = nowMs;

    this.updateDynamic(sheet);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.renderMask(sheet);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const { behind, paper, emptyVao, vao, behindTex, emissiveTex, glimpseTex, figureTex, frontTex, maskTex } = this.gpu;
    gl.useProgram(behind);
    gl.bindVertexArray(emptyVao);
    this.bindTexture(behind, 'uBehind', 0, behindTex);
    this.bindTexture(behind, 'uEmissive', 1, emissiveTex);
    this.bindTexture(behind, 'uGlimpse', 2, glimpseTex);
    this.bindTexture(behind, 'uMask', 3, maskTex[0]);
    this.bindTexture(behind, 'uFigure', 4, figureTex);
    this.bindLight(behind);
    gl.uniform1f(gl.getUniformLocation(behind, 'uHoleFloor'), this.holeFloor);
    gl.uniform1f(gl.getUniformLocation(behind, 'uMaskOn'), this.holeMask ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(behind, 'uTime'), (nowMs - this.startMs) / 1000);
    gl.uniform1f(gl.getUniformLocation(behind, 'uMotion'), this.motion);
    gl.uniform2f(gl.getUniformLocation(behind, 'uShapePos'), this.shape[0], this.shape[1]);
    gl.uniform1f(gl.getUniformLocation(behind, 'uShapeAmt'), this.shape[2]);
    gl.uniform1f(gl.getUniformLocation(behind, 'uGlimpseAmt'), this.glimpseAmount);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(paper);
    gl.bindVertexArray(vao);
    gl.uniform2f(gl.getUniformLocation(paper, 'uGrid'), sheet.cols - 1, sheet.rows - 1);
    this.bindTexture(paper, 'uFront', 0, frontTex);
    this.bindTexture(paper, 'uMask', 1, maskTex[0]);
    this.bindLight(paper);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /** Draw the surviving paper into the mask and blur it (see the file header). */
  private renderMask(sheet: TearSheet): void {
    const gl = this.gl;
    const { mask, blur, vao, emptyVao, maskFbo, maskTex } = this.gpu;
    // A texture cannot be both sampled and rendered to, so unbind the mask from
    // the units the previous frame's draws left it on.
    for (let unit = 0; unit < 4; unit += 1) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.viewport(0, 0, MASK_W, MASK_H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, maskFbo[0]);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(mask);
    gl.bindVertexArray(vao);
    gl.uniform2f(gl.getUniformLocation(mask, 'uGrid'), sheet.cols - 1, sheet.rows - 1);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    // Separable blur: 0 -> 1 horizontally, then 1 -> 0 vertically.
    gl.useProgram(blur);
    gl.bindVertexArray(emptyVao);
    const uStep = gl.getUniformLocation(blur, 'uStep');
    gl.bindFramebuffer(gl.FRAMEBUFFER, maskFbo[1]);
    this.bindTexture(blur, 'uSrc', 0, maskTex[0]);
    gl.uniform2f(uStep, 1 / MASK_W, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, maskFbo[0]);
    this.bindTexture(blur, 'uSrc', 0, maskTex[1]);
    gl.uniform2f(uStep, 0, 1 / MASK_H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private bindTexture(program: WebGLProgram, name: string, unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  }

  private bindLight(program: WebGLProgram): void {
    const gl = this.gl;
    gl.uniform2f(gl.getUniformLocation(program, 'uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(gl.getUniformLocation(program, 'uAmbient'), this.ambient);
    gl.uniform3f(gl.getUniformLocation(program, 'uLight'), this.light[0], this.light[1], this.light[2]);
    gl.uniform1f(gl.getUniformLocation(program, 'uLightAmount'), this.lightAmount);
    gl.uniform2f(gl.getUniformLocation(program, 'uLightCenter'), this.lightCenter[0], this.lightCenter[1]);
    gl.uniform1f(gl.getUniformLocation(program, 'uLevel'), this.level);
  }

  /** Upload live node positions/z each frame, and rebuild the index on a change. */
  private updateDynamic(sheet: TearSheet): void {
    const gl = this.gl;
    const n = sheet.cols * sheet.rows;
    for (let i = 0; i < n; i += 1) {
      this.posArray[i * 2] = sheet.xs[i]!;
      this.posArray[i * 2 + 1] = sheet.ys[i]!;
      this.zArray[i] = sheet.zs[i]!;
    }
    gl.bindVertexArray(this.gpu.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.posArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.zBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.zArray);
    gl.bindVertexArray(null);

    let broken = 0;
    for (let k = 0; k < sheet.broken.length; k += 1) if (sheet.broken[k] === 1) broken += 1;
    const mesh = this.mesh;
    if (!mesh) return;
    const stretched = markStretched(sheet, mesh);
    if (broken !== this.lastBrokenCount || stretched !== this.lastStretchedCount) {
      this.lastBrokenCount = broken;
      this.lastStretchedCount = stretched;
      const live = liveTriangles(sheet, mesh);
      gl.bindVertexArray(this.gpu.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gpu.indexBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, live, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);
      this.indexCount = live.length;
    }
  }

  dispose(): void {
    const gl = this.gl;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const g = this.gpu;
    for (const p of [g.paper, g.behind, g.mask, g.blur]) gl.deleteProgram(p);
    gl.deleteVertexArray(g.vao);
    gl.deleteVertexArray(g.emptyVao);
    for (const b of [g.posBuf, g.uvBuf, g.zBuf, g.indexBuf]) gl.deleteBuffer(b);
    for (const t of [g.frontTex, g.behindTex, g.emissiveTex, g.glimpseTex, g.figureTex, ...g.maskTex]) gl.deleteTexture(t);
    for (const f of g.maskFbo) gl.deleteFramebuffer(f);
  }
}

/**
 * The picture, torn (requirement 2, design §3). A pass inside `CrtRenderer`:
 *
 *   source texture -> this pass (640x480) -> the CRT shader -> canvas
 *
 * Because it sits ahead of the CRT shader, a tear gets the same curvature,
 * scanlines and bloom as the programme. With no tear the pass is skipped, so an
 * untouched picture costs nothing. Owned sources only: it never sees a YouTube
 * player, and `Screen` attaches no pointer handlers while one is up.
 */

import {
  cutPath,
  countBroken,
  createSheet,
  grab,
  moveGrab,
  nodeIndex,
  release,
  stepSheet,
  type TearSheet,
} from '../core/tearSheet.ts';
import { buildSheetMesh, liveTriangles, markStretched, type SheetMesh } from './sheetMesh.ts';
import { BLUR_FRAG, FULLSCREEN_VERT, MASK_FRAG, MASK_VERT, NOISE } from './tearRenderer.ts';

const TUBE_COLS = 40;
const TUBE_ROWS = 30;
const OUT_W = 640;
const OUT_H = 480;
const MASK_W = 160;
const MASK_H = 120;
/** Frames the flaps keep moving after the last touch. */
const SETTLE_FRAMES = 180;

/** Same mesh position maths as the wall, but rendered the right way up for a source. */
const PAPER_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aZ;
uniform vec2 uGrid;
out vec2 vUV;
out float vZ;
void main() {
  vUV = aUV;
  vZ = aZ;
  vec2 n = aPos / uGrid;
  gl_Position = vec4(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);
}`;

const PAPER_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vZ;
uniform sampler2D uSource;
uniform sampler2D uMaskTex;
uniform vec2 uRes;
out vec4 frag;
${NOISE}
void main() {
  float m = texture(uMaskTex, gl_FragCoord.xy / uRes).r;
  float fibre = noise(vUV * 300.0) * 0.5 + noise(vUV * vec2(70.0, 300.0)) * 0.5;
  float threshold = 0.54 + fibre * 0.3;
  if (m < threshold) discard;
  float band = 1.0 - smoothstep(threshold, threshold + 0.1, m);
  vec3 col = texture(uSource, vUV).rgb * clamp(0.9 + vZ * 0.3, 0.45, 1.1);
  // Bright where the picture's edge has been torn, like the paper it turns out to be.
  col = mix(col, vec3(0.62, 0.6, 0.56) * (0.5 + 0.5 * fibre), band * 0.85);
  frag = vec4(col, 1.0);
}`;

const BEHIND_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform sampler2D uMaskTex;
uniform vec2 uRes;
uniform vec3 uTint;
uniform float uHasImage;
uniform float uTime;
out vec4 frag;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col;
  if (uHasImage > 0.5) {
    // Where the back of the set should be, the wall of the viewer's own room.
    col = texture(uImage, uv).rgb * 0.34;
  } else {
    // The set's own dark, in the channel's colour.
    float wires = 0.4 + 0.6 * smoothstep(0.35, 0.5, abs(fract(uv.y * 34.0) - 0.5));
    float grain = noise(uv * vec2(9.0, 240.0) + vec2(0.0, uTime * 0.05));
    col = uTint * (0.05 + 0.13 * grain) * wires;
  }
  float m = texture(uMaskTex, uv).r;
  col *= mix(0.3, 1.0, smoothstep(0.03, 0.5, m));
  col *= 1.0 - 0.5 * smoothstep(0.3, 0.85, texture(uMaskTex, uv + vec2(-5.0, -6.0) / uRes).r);
  frag = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('tube shader alloc failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`tube shader compile failed: ${log ?? ''}`);
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
    throw new Error(`tube link failed: ${log ?? ''}`);
  }
  return p;
}

/** Where the viewer's finger or mouse is, as fractions of the tube from its top left. */
export interface TubePointerInput {
  id: number;
  kind: 'down' | 'move' | 'up';
  x: number;
  y: number;
}

interface Gpu {
  paper: WebGLProgram;
  behind: WebGLProgram;
  mask: WebGLProgram;
  blur: WebGLProgram;
  vao: WebGLVertexArrayObject;
  emptyVao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  uvBuf: WebGLBuffer;
  zBuf: WebGLBuffer;
  indexBuf: WebGLBuffer;
  imageTex: WebGLTexture;
  outTex: WebGLTexture;
  outFbo: WebGLFramebuffer;
  maskTex: [WebGLTexture, WebGLTexture];
  maskFbo: [WebGLFramebuffer, WebGLFramebuffer];
}

export class TubeTear {
  private readonly gl: WebGL2RenderingContext;
  private gpu: Gpu | null = null;
  private sheet: TearSheet = createSheet(TUBE_COLS, TUBE_ROWS, 0x70be);
  private mesh: SheetMesh = buildSheetMesh(this.sheet, true);
  private readonly pos = new Float32Array(TUBE_COLS * TUBE_ROWS * 2);
  private readonly z = new Float32Array(TUBE_COLS * TUBE_ROWS);
  private readonly drags = new Map<number, { node: number; gx: number; gy: number }>();
  private indexCount = 0;
  private lastBroken = -1;
  private lastStretched = -1;
  private settle = 0;
  private lastFrame = 0;
  private tint: readonly [number, number, number] = [0.5, 0.5, 0.5];
  private image: TexImageSource | null = null;
  private imageDirty = false;
  /** Strokes since the last reset, for the seam and for "has this been touched". */
  private torn = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /** A restored context has none of this pass's objects. They rebuild on next use. */
  contextRestored(): void {
    this.gpu = null;
    this.imageDirty = this.image !== null;
    this.lastBroken = -1;
  }

  get active(): boolean {
    return this.torn;
  }

  brokenCount(): number {
    return countBroken(this.sheet);
  }

  hasImage(): boolean {
    return this.image !== null;
  }

  /** What is behind the picture: the channel's dark, or an image in place of it. */
  setBehind(tint: readonly [number, number, number], image: TexImageSource | null): void {
    this.tint = tint;
    if (image !== this.image) this.imageDirty = image !== null;
    this.image = image;
  }

  /** Forget all damage. Returns whether there was any. */
  reset(): boolean {
    const had = this.torn;
    this.drags.clear();
    if (!had) return false;
    this.sheet = createSheet(TUBE_COLS, TUBE_ROWS, 0x70be);
    this.mesh = buildSheetMesh(this.sheet, true);
    this.torn = false;
    this.lastBroken = -1;
    this.lastStretched = -1;
    this.settle = 0;
    return true;
  }

  /** Drop anything held, without mending what has already been torn. */
  releaseAll(): void {
    for (const d of this.drags.values()) release(this.sheet, d.node);
    this.drags.clear();
  }

  /** Grid position under a tube position. `curvature` matches what the shader bends. */
  private toGrid(x: number, y: number, curvature: number): { gx: number; gy: number } {
    const cx = x - 0.5;
    const cy = y - 0.5;
    const d = cx * cx + cy * cy;
    const bx = x + cx * d * curvature;
    const by = y + cy * d * curvature;
    return { gx: bx * (TUBE_COLS - 1), gy: by * (TUBE_ROWS - 1) };
  }

  private nearest(gx: number, gy: number): number {
    const c = Math.max(0, Math.min(TUBE_COLS - 1, Math.round(gx)));
    const r = Math.max(0, Math.min(TUBE_ROWS - 1, Math.round(gy)));
    return nodeIndex(this.sheet, c, r);
  }

  /** Follow the pointer. Returns true when this move cut anything. */
  pointer(e: TubePointerInput, curvature: number): boolean {
    const { gx, gy } = this.toGrid(e.x, e.y, curvature);
    const held = this.drags.get(e.id);
    if (e.kind === 'down') {
      if (this.drags.size >= 2) return false;
      const node = this.nearest(gx, gy);
      if (this.sheet.pinned[node] === 1) return false;
      grab(this.sheet, node, gx, gy);
      this.drags.set(e.id, { node, gx, gy });
      return false;
    }
    if (!held) return false;
    if (e.kind === 'up') {
      release(this.sheet, held.node);
      this.drags.delete(e.id);
      return false;
    }
    const tip = this.nearest(gx, gy);
    if (tip !== held.node && this.sheet.pinned[tip] === 0) {
      release(this.sheet, held.node);
      grab(this.sheet, tip, gx, gy);
      held.node = tip;
    } else {
      moveGrab(this.sheet, held.node, gx, gy);
    }
    const before = countBroken(this.sheet);
    cutPath(this.sheet, held.gx, held.gy, gx, gy);
    held.gx = gx;
    held.gy = gy;
    this.settle = SETTLE_FRAMES;
    const cut = countBroken(this.sheet) !== before;
    if (cut) this.torn = true;
    return cut;
  }

  private build(): Gpu {
    const gl = this.gl;
    const tex = (w: number, h: number): WebGLTexture => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    const fbo = (t: WebGLTexture): WebGLFramebuffer => {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return f;
    };
    const outTex = tex(OUT_W, OUT_H);
    const maskTex: [WebGLTexture, WebGLTexture] = [tex(MASK_W, MASK_H), tex(MASK_W, MASK_H)];
    const gpu: Gpu = {
      paper: link(gl, PAPER_VERT, PAPER_FRAG),
      behind: link(gl, FULLSCREEN_VERT, BEHIND_FRAG),
      mask: link(gl, MASK_VERT, MASK_FRAG),
      blur: link(gl, FULLSCREEN_VERT, BLUR_FRAG),
      vao: gl.createVertexArray(),
      emptyVao: gl.createVertexArray(),
      posBuf: gl.createBuffer(),
      uvBuf: gl.createBuffer(),
      zBuf: gl.createBuffer(),
      indexBuf: gl.createBuffer(),
      imageTex: tex(1, 1),
      outTex,
      outFbo: fbo(outTex),
      maskTex,
      maskFbo: [fbo(maskTex[0]), fbo(maskTex[1])],
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(gpu.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.mesh.uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.zBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.z, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indexBuf);
    gl.bindVertexArray(null);
    this.lastBroken = -1;
    return gpu;
  }

  private bindTexture(program: WebGLProgram, name: string, unit: number, t: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  }

  /** Move the sheet on one frame and draw. Returns the picture with its damage. */
  render(source: WebGLTexture, nowMs: number): WebGLTexture {
    const gl = this.gl;
    const gpu = this.gpu ?? (this.gpu = this.build());
    const sheet = this.sheet;

    const dt = this.lastFrame === 0 ? 16.67 : Math.min(50, nowMs - this.lastFrame);
    this.lastFrame = nowMs;
    const moving = this.drags.size > 0 || this.settle > 0;
    if (moving) {
      stepSheet(sheet, dt);
      if (this.settle > 0) this.settle -= 1;
      const n = TUBE_COLS * TUBE_ROWS;
      for (let i = 0; i < n; i += 1) {
        this.pos[i * 2] = sheet.xs[i]!;
        this.pos[i * 2 + 1] = sheet.ys[i]!;
        this.z[i] = sheet.zs[i]!;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.zBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.z);
    }
    const broken = countBroken(sheet);
    const stretched = markStretched(sheet, this.mesh);
    if (broken !== this.lastBroken || stretched !== this.lastStretched) {
      this.lastBroken = broken;
      this.lastStretched = stretched;
      const live = liveTriangles(sheet, this.mesh);
      gl.bindVertexArray(gpu.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indexBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, live, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);
      this.indexCount = live.length;
    }

    if (this.imageDirty && this.image) {
      gl.bindTexture(gl.TEXTURE_2D, gpu.imageTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.imageDirty = false;
    }

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // Mask, as on the wall: 1 deep in the picture, about 0.5 on a torn edge.
    for (let unit = 0; unit < 3; unit += 1) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.viewport(0, 0, MASK_W, MASK_H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.maskFbo[0]);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(gpu.mask);
    gl.bindVertexArray(gpu.vao);
    gl.uniform2f(gl.getUniformLocation(gpu.mask, 'uGrid'), TUBE_COLS - 1, TUBE_ROWS - 1);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.useProgram(gpu.blur);
    gl.bindVertexArray(gpu.emptyVao);
    const uStep = gl.getUniformLocation(gpu.blur, 'uStep');
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.maskFbo[1]);
    this.bindTexture(gpu.blur, 'uSrc', 0, gpu.maskTex[0]);
    gl.uniform2f(uStep, 1 / MASK_W, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.maskFbo[0]);
    this.bindTexture(gpu.blur, 'uSrc', 0, gpu.maskTex[1]);
    gl.uniform2f(uStep, 0, 1 / MASK_H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // What is behind, then the picture on top.
    gl.viewport(0, 0, OUT_W, OUT_H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.outFbo);
    gl.useProgram(gpu.behind);
    gl.bindVertexArray(gpu.emptyVao);
    this.bindTexture(gpu.behind, 'uImage', 0, gpu.imageTex);
    this.bindTexture(gpu.behind, 'uMaskTex', 1, gpu.maskTex[0]);
    gl.uniform2f(gl.getUniformLocation(gpu.behind, 'uRes'), OUT_W, OUT_H);
    gl.uniform3f(gl.getUniformLocation(gpu.behind, 'uTint'), this.tint[0], this.tint[1], this.tint[2]);
    gl.uniform1f(gl.getUniformLocation(gpu.behind, 'uHasImage'), this.image ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(gpu.behind, 'uTime'), nowMs / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(gpu.paper);
    gl.bindVertexArray(gpu.vao);
    gl.uniform2f(gl.getUniformLocation(gpu.paper, 'uGrid'), TUBE_COLS - 1, TUBE_ROWS - 1);
    gl.uniform2f(gl.getUniformLocation(gpu.paper, 'uRes'), OUT_W, OUT_H);
    this.bindTexture(gpu.paper, 'uSource', 0, source);
    this.bindTexture(gpu.paper, 'uMaskTex', 1, gpu.maskTex[0]);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    // Nothing may stay bound that the next frame renders into.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return gpu.outTex;
  }

  dispose(): void {
    const gl = this.gl;
    const g = this.gpu;
    if (!g) return;
    for (const p of [g.paper, g.behind, g.mask, g.blur]) gl.deleteProgram(p);
    gl.deleteVertexArray(g.vao);
    gl.deleteVertexArray(g.emptyVao);
    for (const b of [g.posBuf, g.uvBuf, g.zBuf, g.indexBuf]) gl.deleteBuffer(b);
    for (const t of [g.imageTex, g.outTex, ...g.maskTex]) gl.deleteTexture(t);
    for (const f of [g.outFbo, ...g.maskFbo]) gl.deleteFramebuffer(f);
    this.gpu = null;
  }
}

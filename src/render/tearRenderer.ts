/**
 * Draws a {@link TearSheet} as a lit, tearable mesh (design §3). Shared by the
 * room wall canvas and (later) the tube tear pass. This is the render layer, so
 * it may touch WebGL/DOM; the simulation itself stays pure in `core/tearSheet`.
 *
 * Each frame we upload the sheet's node positions to a dynamic buffer. The mesh
 * is a triangle list over the grid; a triangle with a broken edge is dropped
 * from the element buffer so a tear opens a real hole. The fragment shader
 * samples the front texture by rest UV and shades by the `z` lift so torn paper
 * reads as 3D.
 *
 * Design §3 offered two ways to remove torn triangles. We rebuild the index
 * buffer on BREAK EVENTS ONLY (when the broken-constraint count changes), not
 * every frame: positions upload each frame, but the (larger) element buffer is
 * untouched until a tear actually changes the topology. This is the cheaper and
 * simpler option at our grid sizes — noted here per the design's request.
 */

import type { TearSheet } from '../core/tearSheet.ts';

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;    // node position in grid units
layout(location=1) in vec2 aUV;     // rest UV 0..1
layout(location=3) in float aZ;     // curl/lift
layout(location=4) in float aEdge;  // 1 at a node touching a torn edge, else 0
uniform vec2 uGrid;                 // cols-1, rows-1 (for normalising pos)
out vec2 vUV;      // rest UV (for sampling the paper)
out vec2 vScreen;  // on-screen 0..1 position (for the light pool)
out float vZ;
out float vEdge;
void main() {
  vUV = aUV;
  vZ = aZ;
  vEdge = aEdge;
  // Normalise grid position to clip space. Torn triangles are removed from the
  // index buffer, so no per-vertex collapse is needed here.
  vec2 n = aPos / uGrid;            // 0..1 (may exceed when torn/pulled)
  vScreen = n;
  vec2 clip = vec2(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vScreen;
in float vZ;
in float vEdge;
uniform sampler2D uFront;
uniform float uTime;
uniform float uAmbient;      // base room light 0..1 (falls by act)
uniform vec3 uLight;         // picture glow colour 0..1
uniform float uLightAmount;  // picture glow strength 0..1
uniform vec2 uLightCenter;   // where the set sits, in screen 0..1
out vec4 frag;

// Cheap value noise, so a torn edge erodes along fibre rather than a clean line.
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
}

void main() {
  vec4 c = texture(uFront, vUV);

  // --- Noise-eroded torn edge (design §3) -----------------------------------
  // vEdge rises toward a torn boundary; break it up with multi-octave fibre
  // noise so the edge dissolves into ragged paper rather than the straight
  // polygon it is built from. Several octaves (incl. a stretched vertical grain)
  // erase the staircase of the triangle edges.
  float fibre =
      noise(vUV * 340.0) * 0.45 +
      noise(vUV * 150.0) * 0.30 +
      noise(vUV * vec2(70.0, 520.0)) * 0.25;   // vertical grain, like torn fibre
  float edge = clamp(vEdge, 0.0, 1.0);
  // Erode across a WIDE band so the noise, not the mesh, decides the outline.
  float erodeField = edge - fibre * 1.25;
  if (erodeField > 0.08) discard;               // ragged hole, not a flat line
  // Pale fibre band of lifted paper threads just inside the torn edge.
  float band = smoothstep(-0.30, 0.06, erodeField);

  // --- Flap lighting from the lift (z) --------------------------------------
  // A lifted flap catches the room light on its raised side and shadows its
  // underside, so torn paper reads as 3D (design §3).
  float shade = clamp(0.62 + vZ * 1.1, 0.25, 1.5);
  vec3 col = c.rgb * shade;

  // --- The TV light pool (task 5a.2) ----------------------------------------
  // A real pool centred on the set: bright and readable near the tube, falling
  // to darkness at the viewport edges. Aspect-correct the distance a little so
  // the pool is roughly round on a wide screen.
  vec2 dv = vScreen - uLightCenter;
  dv.x *= 1.15;
  float d = length(dv);
  float pool = exp(-d * d * 7.0);                 // smooth round falloff
  float lit = uAmbient * 0.35 + uLightAmount * pool * 1.35;
  col = col * lit + c.rgb * uLight * (uLightAmount * pool * 0.9);

  // Pale, slightly warm fibre colour painted into the band.
  vec3 fibreCol = vec3(0.78, 0.74, 0.66) * (0.5 + 0.5 * fibre);
  col = mix(col, fibreCol * max(lit, 0.25), band * 0.85);

  frag = vec4(col, 1.0);
}`;

/** Full-screen pass that fills the frame with the behind texture (the reveal). */
const BEHIND_VERT = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  // Full-screen triangle from gl_VertexID.
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUV = vec2((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const BEHIND_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uBehind;
out vec4 frag;
void main() { frag = texture(uBehind, vUV); }`;

/**
 * Drop-shadow pass (design §3): the flaps around a tear cast a soft shadow onto
 * the behind layer. We draw the torn-edge triangles, pushed down and out by the
 * flap lift, as a dark translucent fill on top of the behind texture — so the
 * reveal has depth and the tear does not look like a flat cut-out.
 */
const SHADOW_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=3) in float aZ;
uniform vec2 uGrid;
out float vZ;
void main() {
  vZ = aZ;
  vec2 n = aPos / uGrid;
  // Offset the shadow down-right, scaled by the flap lift, so it falls away
  // from the light and reads as a cast shadow rather than an outline.
  n += vec2(0.006, 0.012) * (0.4 + abs(aZ) * 2.0);
  vec2 clip = vec2(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const SHADOW_FRAG = `#version 300 es
precision highp float;
in float vZ;
out vec4 frag;
void main() {
  // Soft, lift-scaled darkening. Premultiplied-alpha-safe: we blend over behind.
  float a = clamp(0.28 + abs(vZ) * 0.5, 0.0, 0.6);
  frag = vec4(0.0, 0.0, 0.0, a);
}`;

export interface TearGLOptions {
  preserveDrawingBuffer?: boolean;
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

export class TearGLRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private program: WebGLProgram;
  private behindProgram: WebGLProgram;
  private shadowProgram: WebGLProgram;
  private emptyVao: WebGLVertexArrayObject;
  private vao: WebGLVertexArrayObject;
  private posBuf: WebGLBuffer;
  private uvBuf: WebGLBuffer;
  private zBuf: WebGLBuffer;
  private edgeBuf: WebGLBuffer;
  private indexBuf: WebGLBuffer;
  private shadowIndexBuf: WebGLBuffer;
  private frontTex: WebGLTexture;
  private behindTex: WebGLTexture;

  private sheet: TearSheet | null = null;
  private indexCount = 0;
  private shadowIndexCount = 0;
  private posArray = new Float32Array(0);
  private zArray = new Float32Array(0);
  private edgeArray = new Float32Array(0);
  private contextLost = false;
  private startMs = 0;
  // Lighting (set by the room each frame from deriveRoom).
  private ambient = 0.6;
  private light: [number, number, number] = [0, 0, 0];
  private lightAmount = 0;
  /** Where the set sits, in screen 0..1 (the light pool centre). */
  private lightCenter: [number, number] = [0.5, 0.5];
  /** All triangles as node-index triples (static), and their 3 edge-constraint ids. */
  private triangles: Int32Array = new Int32Array(0);
  private triEdges: Int32Array = new Int32Array(0);
  /** Broken-constraint count at the last index rebuild, so we rebuild only on change. */
  private lastBrokenCount = -1;

  private constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = canvas;
    this.program = this.buildProgram();
    this.behindProgram = this.buildProgramFrom(BEHIND_VERT, BEHIND_FRAG);
    this.shadowProgram = this.buildProgramFrom(SHADOW_VERT, SHADOW_FRAG);
    this.emptyVao = gl.createVertexArray();
    this.vao = gl.createVertexArray();
    this.posBuf = gl.createBuffer();
    this.uvBuf = gl.createBuffer();
    this.zBuf = gl.createBuffer();
    this.edgeBuf = gl.createBuffer();
    this.indexBuf = gl.createBuffer();
    this.shadowIndexBuf = gl.createBuffer();
    this.frontTex = this.makeTex();
    this.behindTex = this.makeTex();
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
    this.program = this.buildProgram();
    this.behindProgram = this.buildProgramFrom(BEHIND_VERT, BEHIND_FRAG);
    this.shadowProgram = this.buildProgramFrom(SHADOW_VERT, SHADOW_FRAG);
    this.emptyVao = this.gl.createVertexArray();
    this.vao = this.gl.createVertexArray();
    this.posBuf = this.gl.createBuffer();
    this.uvBuf = this.gl.createBuffer();
    this.zBuf = this.gl.createBuffer();
    this.edgeBuf = this.gl.createBuffer();
    this.indexBuf = this.gl.createBuffer();
    this.shadowIndexBuf = this.gl.createBuffer();
    this.frontTex = this.makeTex();
    this.behindTex = this.makeTex();
    this.contextLost = false;
    if (this.sheet) this.setSheet(this.sheet);
  };

  private buildProgram(): WebGLProgram {
    return this.buildProgramFrom(VERT, FRAG);
  }

  private buildProgramFrom(vert: string, frag: string): WebGLProgram {
    const gl = this.gl;
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

  private makeTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 36, 30, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  /** Bind the sheet and build the static index buffer and UV attribute. */
  setSheet(sheet: TearSheet): void {
    this.sheet = sheet;
    const gl = this.gl;
    const { cols, rows } = sheet;
    const n = cols * rows;
    this.posArray = new Float32Array(n * 2);
    this.zArray = new Float32Array(n);
    this.edgeArray = new Float32Array(n);

    // Rest UVs (static).
    const uv = new Float32Array(n * 2);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        uv[i * 2] = c / (cols - 1);
        uv[i * 2 + 1] = r / (rows - 1);
      }
    }

    // Map each node pair to its constraint index, so a triangle can look up
    // whether any of its 3 edges has broken (design §3: a triangle with a
    // broken edge gets zero area — we rebuild the index buffer on break events,
    // the cheaper option noted in the log).
    const pairToConstraint = new Map<number, number>();
    const key = (a: number, b: number): number => (a < b ? a * n + b : b * n + a);
    const cc = sheet.restLength.length;
    for (let k = 0; k < cc; k += 1) {
      pairToConstraint.set(key(sheet.constraints[k * 2]!, sheet.constraints[k * 2 + 1]!), k);
    }

    // Two triangles per cell; record each triangle's node triple and the 3
    // constraint ids of its edges.
    const tris: number[] = [];
    const edges: number[] = [];
    const pushTri = (a: number, b: number, c2: number): void => {
      tris.push(a, b, c2);
      edges.push(pairToConstraint.get(key(a, b)) ?? -1, pairToConstraint.get(key(b, c2)) ?? -1, pairToConstraint.get(key(a, c2)) ?? -1);
    };
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const i = r * cols + c;
        pushTri(i, i + 1, i + cols);
        pushTri(i + 1, i + cols + 1, i + cols);
      }
    }
    this.triangles = Int32Array.from(tris);
    this.triEdges = Int32Array.from(edges);
    this.lastBrokenCount = -1; // force an index build on first render

    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.posArray, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.zBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.zArray, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.edgeArray, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);

    // The element buffer and the torn-edge shadow buffer are rebuilt on break
    // events (dynamic). rebuildIndex also fills the per-node edge field; force
    // it on first render.
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(this.triangles), gl.DYNAMIC_DRAW);
    this.indexCount = this.triangles.length;
    this.shadowIndexCount = 0;

    gl.bindVertexArray(null);
  }

  /**
   * Rebuild the element buffer on a break event. A triangle with a broken edge
   * is dropped from the live mesh (that opens the hole). Triangles that *kept*
   * one or two broken-edge vertices form the torn boundary: their nodes get a
   * per-node `edge` field (so the fragment shader can erode and paint a fibre
   * band), and those triangles are collected into a shadow index for the cast
   * shadow onto the behind layer.
   */
  private rebuildIndex(sheet: TearSheet): void {
    const gl = this.gl;
    const live: number[] = [];
    const shadow: number[] = [];
    const n = sheet.cols * sheet.rows;
    // Mark every node that touches a broken constraint as a torn-edge node.
    const edge = this.edgeArray;
    for (let i = 0; i < n; i += 1) edge[i] = 0;
    const cc = sheet.restLength.length;
    for (let k = 0; k < cc; k += 1) {
      if (sheet.broken[k] !== 1) continue;
      edge[sheet.constraints[k * 2]!] = 1;
      edge[sheet.constraints[k * 2 + 1]!] = 1;
    }

    const triCount = this.triangles.length / 3;
    for (let t = 0; t < triCount; t += 1) {
      const e0 = this.triEdges[t * 3]!;
      const e1 = this.triEdges[t * 3 + 1]!;
      const e2 = this.triEdges[t * 3 + 2]!;
      const brokenEdge =
        (e0 >= 0 && sheet.broken[e0] === 1) ||
        (e1 >= 0 && sheet.broken[e1] === 1) ||
        (e2 >= 0 && sheet.broken[e2] === 1);
      const a = this.triangles[t * 3]!;
      const b = this.triangles[t * 3 + 1]!;
      const c = this.triangles[t * 3 + 2]!;
      if (brokenEdge) continue; // dropped from the mesh: this is the hole
      live.push(a, b, c);
      // A surviving triangle that still has a torn-edge vertex sits on the
      // boundary: it is a flap, so it casts the drop shadow.
      if (edge[a] === 1 || edge[b] === 1 || edge[c] === 1) shadow.push(a, b, c);
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, edge);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(live), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    this.indexCount = live.length;

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.shadowIndexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(shadow), gl.DYNAMIC_DRAW);
    this.shadowIndexCount = shadow.length;
  }

  /** Upload a 2D canvas/image as the front (paper) texture. */
  setFrontTexture(src: TexImageSource): void {
    this.uploadTex(this.frontTex, src);
  }

  /** Upload a 2D canvas/image as the behind (reveal) texture. */
  setBehindTexture(src: TexImageSource): void {
    this.uploadTex(this.behindTex, src);
  }

  /** Set the room lighting for the next frame (ambient + picture glow). */
  setLight(ambient: number, light: { r: number; g: number; b: number; amount: number }): void {
    this.ambient = ambient;
    this.light = [light.r / 255, light.g / 255, light.b / 255];
    this.lightAmount = light.amount;
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

  /**
   * Draw the current sheet. First the behind texture fills the frame, then the
   * paper mesh is drawn on top, so a torn hole (collapsed triangles) reveals the
   * layer behind.
   */
  render(nowMs: number): void {
    const gl = this.gl;
    const sheet = this.sheet;
    if (this.contextLost || gl.isContextLost() || !sheet) return;
    if (this.startMs === 0) this.startMs = nowMs;

    const { cols, rows } = sheet;
    this.updateDynamic(sheet);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);

    // Behind pass: fill the frame with the plaster so a torn hole reveals it.
    gl.useProgram(this.behindProgram);
    gl.bindVertexArray(this.emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.behindTex);
    gl.uniform1i(gl.getUniformLocation(this.behindProgram, 'uBehind'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Shadow pass: the flaps around a tear darken the revealed behind layer, so
    // the hole has depth (design §3). Blend over the behind, before the paper.
    if (this.shadowIndexCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.shadowProgram);
      gl.bindVertexArray(this.vao);
      gl.uniform2f(gl.getUniformLocation(this.shadowProgram, 'uGrid'), cols - 1, rows - 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.shadowIndexBuf);
      gl.drawElements(gl.TRIANGLES, this.shadowIndexCount, gl.UNSIGNED_INT, 0);
      gl.disable(gl.BLEND);
      // Restore the mesh's own index buffer for the paper pass.
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
      gl.bindVertexArray(null);
    }

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const uGrid = gl.getUniformLocation(this.program, 'uGrid');
    gl.uniform2f(uGrid, cols - 1, rows - 1);
    const uTime = gl.getUniformLocation(this.program, 'uTime');
    gl.uniform1f(uTime, (nowMs - this.startMs) / 1000);
    const uFront = gl.getUniformLocation(this.program, 'uFront');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frontTex);
    gl.uniform1i(uFront, 0);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uAmbient'), this.ambient);
    gl.uniform3f(gl.getUniformLocation(this.program, 'uLight'), this.light[0], this.light[1], this.light[2]);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uLightAmount'), this.lightAmount);
    gl.uniform2f(gl.getUniformLocation(this.program, 'uLightCenter'), this.lightCenter[0], this.lightCenter[1]);

    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /** Upload live node positions/z each frame, and rebuild the index on a break. */
  private updateDynamic(sheet: TearSheet): void {
    const gl = this.gl;
    const n = sheet.cols * sheet.rows;
    for (let i = 0; i < n; i += 1) {
      this.posArray[i * 2] = sheet.xs[i]!;
      this.posArray[i * 2 + 1] = sheet.ys[i]!;
      this.zArray[i] = sheet.zs[i]!;
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.posArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.zBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.zArray);
    gl.bindVertexArray(null);

    // Rebuild the element buffer only when the broken count changed (design §3:
    // on break events, not every frame).
    let broken = 0;
    for (let k = 0; k < sheet.broken.length; k += 1) if (sheet.broken[k] === 1) broken += 1;
    if (broken !== this.lastBrokenCount) {
      this.lastBrokenCount = broken;
      this.rebuildIndex(sheet);
    }
  }

  dispose(): void {
    const gl = this.gl;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.behindProgram);
    gl.deleteProgram(this.shadowProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.emptyVao);
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.uvBuf);
    gl.deleteBuffer(this.zBuf);
    gl.deleteBuffer(this.edgeBuf);
    gl.deleteBuffer(this.indexBuf);
    gl.deleteBuffer(this.shadowIndexBuf);
    gl.deleteTexture(this.frontTex);
    gl.deleteTexture(this.behindTex);
  }
}

/**
 * CRT fragment shader: GLSL source and uniform plumbing (design.md §10).
 *
 * This module is pure data and pure helpers — no WebGL calls, no DOM. It owns
 * the GLSL text, the list of uniform names, and the shape that drives them, so
 * both `CrtRenderer` (the WebGL2 pipeline) and the unit tests can reason about
 * the shader without a GL context. jsdom has no WebGL, so everything testable
 * lives here rather than inside the renderer.
 *
 * Every screen effect named in requirement 5.1 — barrel curvature, scanlines,
 * shadow mask, bloom, chromatic aberration, noise, vignette and rolling
 * interference — is a uniform-driven branch in the fragment shader. None of it
 * is ever applied through DOM styling on the tube (see youtube-compliance.md
 * and design.md §3): curvature, scanlines, shake, roll all happen here.
 *
 * Tasks 4.2 (boot/shutdown/tuning via uPower, uStatic) and 4.3 (flashLimiter,
 * reduced effects, context restore, fallback) extend this without rewriting it:
 * the uniforms they need (uPower, uStatic, uRoll, uTear, uCollapse) already
 * exist here and default to inert values.
 */

/** Names of every uniform the fragment shader reads. Order is not significant. */
export const UNIFORM_NAMES = [
  'uSource', // sampler2D: the source texture (video frame or 2D canvas)
  'uResolution', // vec2: internal render resolution in pixels
  'uTime', // float: seconds since renderer start; drives static and roll
  'uCurvature', // float: barrel distortion amount
  'uScanline', // float: scanline darkening strength
  'uMask', // float: shadow-mask (aperture grille) strength
  'uBloom', // float: bloom / glow amount
  'uAberration', // float: chromatic aberration offset in pixels
  'uNoise', // float: baseline film-grain noise over the picture
  'uVignette', // float: corner darkening strength
  'uRoll', // float: rolling interference bar strength (0 = off)
  'uTear', // float: horizontal tear/jitter strength (0 = off)
  'uCollapse', // float: vertical collapse-to-a-line amount, 0..1 (0 = normal)
  'uStatic', // float: snow mix, 0..1 (1 = full static, used during tuning)
  'uPower', // float: warm-up/shutdown envelope, 0..1 (0 = dark, 1 = full)
] as const;

export type UniformName = (typeof UNIFORM_NAMES)[number];

/**
 * The per-frame uniform values the renderer uploads. `uSource` and the vertex
 * attributes are handled by the renderer itself; this is the look/effect state.
 * Look presets (looks.ts) and later transition code (4.2/4.3) produce this.
 */
export interface CrtUniforms {
  resolution: readonly [number, number];
  time: number;
  curvature: number;
  scanline: number;
  mask: number;
  bloom: number;
  aberration: number;
  noise: number;
  vignette: number;
  roll: number;
  tear: number;
  collapse: number;
  /** 0..1 snow mix. 1 during tuning. */
  static: number;
  /** 0..1 power envelope. Boot ramps up, shutdown ramps down (task 4.2). */
  power: number;
}

/** A full-screen triangle; no vertex buffer needed, driven by gl_VertexID. */
export const VERTEX_SHADER_SOURCE = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // Oversized triangle covering the viewport. gl_VertexID in {0,1,2}.
  vec2 pos = vec2(
    float((gl_VertexID & 1) << 2) - 1.0,
    float((gl_VertexID & 2) << 1) - 1.0
  );
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

/**
 * The CRT fragment shader. Each listed effect is gated by its uniform, so a
 * preset that sets an amount to zero removes that effect at no visual cost.
 * Procedural static is generated here with a hash of the pixel and uTime; there
 * is no snow texture to load (design.md §10).
 */
export const FRAGMENT_SHADER_SOURCE = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uResolution;
uniform float uTime;
uniform float uCurvature;
uniform float uScanline;
uniform float uMask;
uniform float uBloom;
uniform float uAberration;
uniform float uNoise;
uniform float uVignette;
uniform float uRoll;
uniform float uTear;
uniform float uCollapse;
uniform float uStatic;
uniform float uPower;

// --- Hash / value noise: deterministic per pixel per frame ------------------
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Time-varying white noise used for procedural static (design.md §10).
float staticNoise(vec2 uv, float t) {
  // Quantise to the internal resolution so snow has chunky scanline-sized dots
  // rather than per-fragment shimmer, and advance the seed with time.
  vec2 cell = floor(uv * uResolution) + floor(t * 60.0);
  return hash(cell + t);
}

// Barrel distortion: pull the UV toward the centre by uCurvature.
vec2 barrel(vec2 uv, float amount) {
  vec2 cc = uv - 0.5;
  float dist = dot(cc, cc);
  return uv + cc * dist * amount;
}

void main() {
  vec2 uv = vUv;

  // --- Vertical collapse (power-off to a line; task 4.2 animates uCollapse) --
  // Squeeze V toward the centre line. At 1.0 the picture is a thin bar.
  if (uCollapse > 0.0) {
    uv.y = (uv.y - 0.5) / max(1.0 - uCollapse, 0.0015) + 0.5;
  }

  // --- Barrel curvature ------------------------------------------------------
  uv = barrel(uv, uCurvature);

  // --- Rolling interference: a soft bright bar sweeping down the screen ------
  float rollBar = 0.0;
  if (uRoll > 0.0) {
    float band = fract(uv.y - uTime * 0.25);
    rollBar = smoothstep(0.96, 1.0, band) * uRoll;
    // The bar also nudges the sampled row, like a vertical-hold wobble.
    uv.y += rollBar * 0.02;
  }

  // --- Horizontal tear / jitter ---------------------------------------------
  if (uTear > 0.0) {
    float line = floor(uv.y * uResolution.y);
    float jitter = (hash(vec2(line, floor(uTime * 24.0))) - 0.5) * 2.0;
    uv.x += jitter * uTear * 0.05;
  }

  // Outside the tube after distortion reads as black (the glass edge).
  float inBounds = step(0.0, uv.x) * step(uv.x, 1.0)
                 * step(0.0, uv.y) * step(uv.y, 1.0);

  // --- Chromatic aberration: sample R/G/B at slightly offset UVs ------------
  vec2 px = uAberration / uResolution;
  vec3 col;
  col.r = texture(uSource, uv + vec2(px.x, 0.0)).r;
  col.g = texture(uSource, uv).g;
  col.b = texture(uSource, uv - vec2(px.x, 0.0)).b;
  col *= inBounds;

  // --- Bloom: cheap 4-tap glow added back on top ----------------------------
  if (uBloom > 0.0) {
    vec2 b = 1.5 / uResolution;
    vec3 blur = texture(uSource, uv + vec2(b.x, b.y)).rgb
              + texture(uSource, uv + vec2(-b.x, b.y)).rgb
              + texture(uSource, uv + vec2(b.x, -b.y)).rgb
              + texture(uSource, uv + vec2(-b.x, -b.y)).rgb;
    col += (blur * 0.25) * uBloom * inBounds;
  }

  // --- Procedural static: mix snow over the picture -------------------------
  // uNoise adds a faint constant grain; uStatic mixes toward full snow.
  float snow = staticNoise(vUv, uTime);
  col = mix(col, vec3(snow), clamp(uStatic, 0.0, 1.0));
  col += (snow - 0.5) * uNoise;

  // Rolling bar brightens wherever it is.
  col += rollBar;

  // --- Scanlines -------------------------------------------------------------
  if (uScanline > 0.0) {
    float s = sin(vUv.y * uResolution.y * 3.14159265);
    col *= 1.0 - uScanline * (0.5 - 0.5 * s);
  }

  // --- Shadow mask (aperture grille): tint by column triad ------------------
  if (uMask > 0.0) {
    float m = mod(floor(vUv.x * uResolution.x), 3.0);
    vec3 maskTint = vec3(
      m == 0.0 ? 1.0 : 1.0 - uMask,
      m == 1.0 ? 1.0 : 1.0 - uMask,
      m == 2.0 ? 1.0 : 1.0 - uMask
    );
    col *= maskTint;
  }

  // --- Vignette --------------------------------------------------------------
  if (uVignette > 0.0) {
    vec2 vc = vUv - 0.5;
    float v = 1.0 - dot(vc, vc) * uVignette * 2.0;
    col *= clamp(v, 0.0, 1.0);
  }

  // --- Power envelope: warm-up / collapse brightness (task 4.2) -------------
  col *= clamp(uPower, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;

/**
 * Flatten `CrtUniforms` into the scalar/vector values uploaded to GL, keyed by
 * uniform name. Pure, so it can be unit-tested without a GL context, and it is
 * the single place that maps the look state onto the shader's inputs.
 *
 * `uSource` is omitted: the texture unit is bound by the renderer, not packed.
 */
export function packUniforms(u: CrtUniforms): Record<Exclude<UniformName, 'uSource'>, number | readonly [number, number]> {
  return {
    uResolution: u.resolution,
    uTime: u.time,
    uCurvature: u.curvature,
    uScanline: u.scanline,
    uMask: u.mask,
    uBloom: u.bloom,
    uAberration: u.aberration,
    uNoise: u.noise,
    uVignette: u.vignette,
    uRoll: u.roll,
    uTear: u.tear,
    uCollapse: u.collapse,
    uStatic: u.static,
    uPower: u.power,
  };
}

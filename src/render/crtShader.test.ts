import { describe, expect, it } from 'vitest';
import {
  FRAGMENT_SHADER_SOURCE,
  UNIFORM_NAMES,
  VERTEX_SHADER_SOURCE,
  packUniforms,
  type CrtUniforms,
} from './crtShader.ts';

const SAMPLE: CrtUniforms = {
  resolution: [960, 720],
  time: 1.5,
  curvature: 0.12,
  scanline: 0.18,
  mask: 0.1,
  bloom: 0.25,
  aberration: 0.6,
  noise: 0.04,
  vignette: 0.35,
  roll: 0,
  tear: 0,
  collapse: 0,
  static: 1,
  power: 1,
  reflAmount: 0,
  reflShadow: 0,
};

describe('CRT shader source', () => {
  it('targets WebGL2 / GLSL ES 3.00 in both stages', () => {
    expect(VERTEX_SHADER_SOURCE).toContain('#version 300 es');
    expect(FRAGMENT_SHADER_SOURCE).toContain('#version 300 es');
  });

  it('declares every uniform named in UNIFORM_NAMES', () => {
    for (const name of UNIFORM_NAMES) {
      // Each uniform must appear in a `uniform ... <name>;` declaration.
      const declared = new RegExp(`uniform\\s+\\w+\\s+${name}\\b`).test(FRAGMENT_SHADER_SOURCE);
      expect(declared, `${name} should be declared in the fragment shader`).toBe(true);
    }
  });

  it('covers every CRT effect required by requirement 5.1', () => {
    // Each effect is driven by its uniform; presence of the uniform in the
    // shader body is the proof the effect is implemented, not styled in CSS.
    const effectUniforms = [
      'uCurvature', // barrel curvature
      'uScanline', // scanlines
      'uMask', // shadow mask
      'uBloom', // bloom
      'uAberration', // chromatic aberration
      'uNoise', // noise
      'uVignette', // vignette
      'uRoll', // rolling interference
    ];
    for (const u of effectUniforms) {
      // Used beyond its declaration: appears at least twice (declare + read).
      const count = FRAGMENT_SHADER_SOURCE.split(u).length - 1;
      expect(count, `${u} should be read in the shader body`).toBeGreaterThanOrEqual(2);
    }
  });

  it('generates procedural static from a time-varying hash (no snow texture)', () => {
    // A hash function and a time-seeded static sampler must exist, and uStatic
    // must mix it in. There must be no second sampler for a snow texture.
    expect(FRAGMENT_SHADER_SOURCE).toMatch(/float\s+hash\s*\(/);
    expect(FRAGMENT_SHADER_SOURCE).toMatch(/staticNoise\s*\(/);
    expect(FRAGMENT_SHADER_SOURCE).toContain('uStatic');
    const samplers = FRAGMENT_SHADER_SOURCE.match(/uniform\s+sampler2D\s+\w+/g) ?? [];
    // The picture, and the viewer's optional reflection. Neither is a snow texture.
    expect(samplers.map((s) => s.split(/\s+/).pop())).toEqual(['uSource', 'uReflection']);
  });

  it('exposes the transition uniforms tasks 4.2 and 4.3 drive', () => {
    for (const name of ['uPower', 'uStatic', 'uRoll', 'uTear', 'uCollapse']) {
      expect(UNIFORM_NAMES).toContain(name);
    }
  });
});

describe('packUniforms', () => {
  it('maps every CrtUniforms field to its uniform name, excluding the sampler', () => {
    const packed = packUniforms(SAMPLE);
    expect(packed.uResolution).toEqual([960, 720]);
    expect(packed.uTime).toBe(1.5);
    expect(packed.uCurvature).toBe(0.12);
    expect(packed.uScanline).toBe(0.18);
    expect(packed.uMask).toBe(0.1);
    expect(packed.uBloom).toBe(0.25);
    expect(packed.uAberration).toBe(0.6);
    expect(packed.uNoise).toBe(0.04);
    expect(packed.uVignette).toBe(0.35);
    expect(packed.uRoll).toBe(0);
    expect(packed.uTear).toBe(0);
    expect(packed.uCollapse).toBe(0);
    expect(packed.uStatic).toBe(1);
    expect(packed.uPower).toBe(1);
  });

  it('does not emit the sampler uniform (the renderer binds the texture unit)', () => {
    const packed = packUniforms(SAMPLE);
    expect('uSource' in packed).toBe(false);
  });

  it('packs a value for every non-sampler uniform name', () => {
    const packed = packUniforms(SAMPLE);
    const expected = UNIFORM_NAMES.filter((n) => n !== 'uSource' && n !== 'uReflection');
    expect(Object.keys(packed).sort()).toEqual([...expected].sort());
  });
});

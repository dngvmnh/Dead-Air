/**
 * Draws a scene programme at a single time offset onto a 2D canvas (design §6,
 * §10 step 1; requirement 3.3). The canvas is then handed to the CRT shader as
 * a source texture — so every "screen effect" still happens in the shader, and
 * this only paints the flat picture (no glow, curvature or scanlines here).
 *
 * Time-addressable: `renderScene` is a pure function of `tMs` with no retained
 * state, so the clock can seek to any instant. Visibility and keyframe sampling
 * come from the tested pure helpers in `core/scene.ts`; this file is the thin
 * drawing shell.
 *
 * Missing media never crashes the TV (tech.md): an image layer whose bitmap is
 * not loaded draws a labelled placeholder block instead.
 */

import type { LayerInput, SceneProgramInput } from '../content/schema.ts';
import { activeCaptions, layerVisible, sampleKeyframes, type SceneVars } from '../core/scene.ts';
import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from './looks.ts';

/** Minimal 2D context surface used here (keeps the module testable). */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface RenderSceneOptions {
  /** Preloaded bitmaps by layer `src`. A missing entry draws a placeholder. */
  images?: Map<string, CanvasImageSource>;
  /** Draw the active captions at the bottom (requirement 13.3). Default true. */
  drawCaptions?: boolean;
  /** Canvas size; defaults to the internal 960×720 cap. */
  width?: number;
  height?: number;
}

/**
 * Render `program` at offset `tMs` for the current `vars` (visit/act) onto
 * `ctx`. Draws a black field first, then each visible layer in order, then
 * captions.
 */
export function renderScene(
  ctx: Ctx2D,
  program: SceneProgramInput,
  tMs: number,
  vars: SceneVars,
  options: RenderSceneOptions = {},
): void {
  const W = options.width ?? INTERNAL_WIDTH;
  const H = options.height ?? INTERNAL_HEIGHT;
  const images = options.images;

  ctx.save();
  // Opaque black base: a scene always fills the frame.
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  for (const layer of program.layers) {
    if (!layerVisible(layer.when, vars)) continue;
    const kf = sampleKeyframes(layer.keyframes, tMs);
    const opacity = kf.opacity ?? 1;
    if (opacity <= 0) continue;
    ctx.globalAlpha = clamp01(opacity);
    drawLayer(ctx, layer, kf, tMs, W, H, images);
  }

  ctx.globalAlpha = 1;
  if (options.drawCaptions ?? true) {
    drawCaptionBand(ctx, activeCaptions(program.captions, tMs), W, H);
  }
  ctx.restore();
}

function drawLayer(
  ctx: Ctx2D,
  layer: LayerInput,
  kf: { x?: number; y?: number; scale?: number; text?: string },
  tMs: number,
  W: number,
  H: number,
  images: Map<string, CanvasImageSource> | undefined,
): void {
  switch (layer.type) {
    case 'image': {
      const scale = kf.scale ?? 1;
      const w = W * scale;
      const h = H * scale;
      const x = kf.x ?? 0;
      const y = kf.y ?? 0;
      const bitmap = images?.get(layer.src);
      if (bitmap) ctx.drawImage(bitmap, x, y, w, h);
      else drawImagePlaceholder(ctx, layer.src, x, y, w, h);
      break;
    }
    case 'rect': {
      ctx.fillStyle = layer.colour;
      ctx.fillRect(kf.x ?? layer.x, kf.y ?? layer.y, layer.w, layer.h);
      break;
    }
    case 'text': {
      const size = layer.size ?? 48;
      ctx.fillStyle = layer.colour ?? '#e8e8e8';
      ctx.font = `${size}px "Courier New", monospace`;
      ctx.textBaseline = 'top';
      ctx.fillText(kf.text ?? layer.text, kf.x ?? layer.x ?? 40, kf.y ?? layer.y ?? 40);
      break;
    }
    case 'ticker': {
      drawTicker(ctx, kf.text ?? layer.text, layer.speed ?? 80, tMs, W, H);
      break;
    }
    case 'noise': {
      drawNoiseBand(ctx, layer.intensity, tMs, W, H);
      break;
    }
  }
}

function drawImagePlaceholder(ctx: Ctx2D, src: string, x: number, y: number, w: number, h: number): void {
  // A visible, deterministic block so a scene renders without its art.
  ctx.fillStyle = '#1b1b24';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#44445a';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
  ctx.fillStyle = '#6a6a88';
  ctx.font = '24px "Courier New", monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(`[${src}]`, x + 12, y + 12);
}

function drawTicker(ctx: Ctx2D, text: string, speedPxPerSec: number, tMs: number, W: number, H: number): void {
  const bandH = 48;
  const y = H - bandH;
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, y, W, bandH);
  ctx.fillStyle = '#d8d84a';
  ctx.font = '28px "Courier New", monospace';
  ctx.textBaseline = 'middle';
  // Scroll right-to-left, wrapping over a fixed virtual span so it is periodic
  // and therefore time-addressable.
  const span = W + text.length * 18 + W;
  const offset = ((speedPxPerSec * tMs) / 1000) % span;
  ctx.fillText(text, W - offset, y + bandH / 2);
}

function drawNoiseBand(ctx: Ctx2D, intensity: number, tMs: number, W: number, H: number): void {
  // A sparse procedural grain over the whole frame. Deterministic in tMs so the
  // scene is seekable; the shader adds the real animated static on top.
  const n = Math.floor(clamp01(intensity) * 900);
  ctx.fillStyle = '#9aa0b0';
  let seed = Math.floor(tMs) * 2654435761;
  for (let i = 0; i < n; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const px = seed % W;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const py = seed % H;
    ctx.globalAlpha = clamp01(intensity);
    ctx.fillRect(px, py, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawCaptionBand(ctx: Ctx2D, lines: string[], W: number, H: number): void {
  if (lines.length === 0) return;
  const lineH = 44;
  const pad = 12;
  const bandH = lines.length * lineH + pad * 2;
  const y = H - bandH - 60;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, y, W, bandH);
  ctx.fillStyle = '#ffffff';
  ctx.font = '34px "Courier New", monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, y + pad + i * lineH);
  });
  ctx.textAlign = 'left';
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

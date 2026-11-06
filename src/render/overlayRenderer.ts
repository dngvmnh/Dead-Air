/**
 * Draws horror-event output — slates, captions-over-static and the fixed
 * sign-off text — onto a 2D canvas so it can be published as the CRT shader's
 * source texture (design §9, §10 step 1). This is the fix for the regression
 * where events only set the ARIA live region and the static level, so nothing
 * of an event ever reached the picture.
 *
 * Like `sceneRenderer.ts` this paints only the flat picture: no glow, curvature
 * or scanlines (those stay in the shader), and never any DOM text or styling on
 * the tube. Every function is a pure function of its inputs so it is unit-
 * testable against a fake 2D context without a GPU.
 */

import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from './looks.ts';

/** Minimal 2D context surface used here (keeps the module testable). */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface OverlaySize {
  width?: number;
  height?: number;
}

/**
 * The exact fixed sign-off text, copied verbatim from `docs/media-bible.md`
 * section 9, including the blank lines that lay it out. No other wording, and
 * no extra label (requirement 11.1).
 */
export const SIGN_OFF_LINES: readonly string[] = [
  'NO SIGNAL',
  '',
  'THANK YOU FOR WATCHING.',
  '',
  'BROADCAST TERMINATED · 00:00:13',
];

const SLATE_BG = '#0d0d12';
const SLATE_FG = '#e8e8e0';

/**
 * Draw a slate: a dim opaque field with the text centred, one line per `\n`.
 * Used for event slates (E05/E07/E08/E12 etc.) so the words are part of the
 * picture, not a DOM overlay.
 */
export function drawSlate(ctx: Ctx2D, text: string, size: OverlaySize = {}): void {
  const W = size.width ?? INTERNAL_WIDTH;
  const H = size.height ?? INTERNAL_HEIGHT;
  const lines = text.split('\n');
  paintLines(ctx, lines, W, H, { bg: SLATE_BG, fg: SLATE_FG, fontPx: 48 });
}

/**
 * Draw caption text over a static field (requirement 9.6 degradation, and the
 * honest path for voice lines with no recorded audio): a translucent dark band
 * is not enough on its own because the shader's static sits behind, so we paint
 * a legible caption band. One line per `\n`.
 */
export function drawCaptionsOverStatic(ctx: Ctx2D, caption: string, size: OverlaySize = {}): void {
  const W = size.width ?? INTERNAL_WIDTH;
  const H = size.height ?? INTERNAL_HEIGHT;
  const lines = wrap(caption, 36);
  // A dark field with slightly higher alpha so the caption reads over snow; the
  // shader still mixes its static in front per the current static level.
  paintLines(ctx, lines, W, H, { bg: '#000000', fg: '#ffffff', fontPx: 40, bandOnly: true });
}

/** Draw the exact fixed sign-off text on a clean (opaque black) picture. */
export function drawSignOff(ctx: Ctx2D, size: OverlaySize = {}): void {
  const W = size.width ?? INTERNAL_WIDTH;
  const H = size.height ?? INTERNAL_HEIGHT;
  // Only the non-blank lines are painted; the blank lines are layout and become
  // vertical gaps.
  const drawn = SIGN_OFF_LINES.filter((l) => l.length > 0);
  paintLines(ctx, drawn, W, H, { bg: '#000000', fg: '#f2f2ea', fontPx: 46, lineGapPx: 44 });
}

/**
 * Draw a station card from the channel name (requirement 10.3): a flat card
 * flashed when there is no captured frame or the previous source was YouTube.
 * Generated on canvas from text only, so no asset is needed and nothing is read
 * from a YouTube player.
 */
export function drawStationCard(ctx: Ctx2D, name: string, size: OverlaySize = {}): void {
  const W = size.width ?? INTERNAL_WIDTH;
  const H = size.height ?? INTERNAL_HEIGHT;
  ctx.save();
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c8c8d8';
  ctx.font = `bold ${Math.round(H / 12)}px "Courier New", monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(name, W / 2, H / 2);
  ctx.textAlign = 'left';
  ctx.restore();
}

interface PaintOpts {
  bg: string;
  fg: string;
  fontPx: number;
  /** Extra vertical gap between lines on top of the font height. */
  lineGapPx?: number;
  /** Paint only a band behind the text rather than the whole field. */
  bandOnly?: boolean;
}

function paintLines(ctx: Ctx2D, lines: string[], W: number, H: number, opts: PaintOpts): void {
  ctx.save();
  const lineH = opts.fontPx + (opts.lineGapPx ?? 16);
  const blockH = lines.length * lineH;
  const top = Math.max(0, (H - blockH) / 2);

  if (opts.bandOnly) {
    // A caption band near the lower third so it reads over static.
    const bandH = blockH + 24;
    const bandTop = H - bandH - 48;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, bandTop, W, bandH);
    paintText(ctx, lines, W, bandTop + 12, lineH, opts.fg, opts.fontPx);
    ctx.restore();
    return;
  }

  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, W, H);
  paintText(ctx, lines, W, top, lineH, opts.fg, opts.fontPx);
  ctx.restore();
}

function paintText(
  ctx: Ctx2D,
  lines: string[],
  W: number,
  top: number,
  lineH: number,
  fg: string,
  fontPx: number,
): void {
  ctx.fillStyle = fg;
  ctx.font = `${fontPx}px "Courier New", monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, top + i * lineH);
  });
  ctx.textAlign = 'left';
}

/** Word-wrap a caption to roughly `max` characters per line (1+ lines). */
export function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if (line.length === 0) line = w;
    else if ((line + ' ' + w).length <= max) line += ' ' + w;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line.length > 0) out.push(line);
  return out;
}

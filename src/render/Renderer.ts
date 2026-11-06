/**
 * The surface contract the television shell drives, shared by the WebGL2
 * `CrtRenderer` and the non-WebGL `FallbackRenderer` (requirement 5.3). The app
 * talks to a `Renderer`, so a device without WebGL2 keeps working with the same
 * control flow — only the picture treatment differs.
 */

import { type Look } from '../core/types.ts';
import { type CrtSource } from './CrtRenderer.ts';

export interface Renderer {
  /** Choose the resting look preset for the current source. */
  setLook(look: Look): void;
  /** 0..1 snow mix (1 = full static). */
  setStatic(amount: number): void;
  /** 0..1 brightness/power envelope (0 = dark). */
  setPower(amount: number): void;
  /** Hold full static while tuning, or release it. */
  setTuning(active: boolean): void;
  /** Reduced effects / reduced motion: disable flashes, roll and jitter. */
  setReducedEffects(reduced: boolean): void;
  /** Begin the warm-up envelope over `durationMs`. */
  startBoot(durationMs: number, onDone?: () => void): void;
  /** Begin the shutdown collapse over `durationMs`. */
  startShutdown(durationMs: number, onDone?: () => void): void;
  /** Set the source texture, or clear it with null. */
  setSource(source: CrtSource | null): void;
  /**
   * Capture the current source frame into a small 320×240 buffer for a later
   * `flashPrevious` (design §10). Owned sources only; never call for a YouTube
   * item (its iframe cannot be sampled). A no-op when there is no source.
   */
  captureFrame(): void;
  /**
   * Flash a previously captured frame for `ms`, gated by the flash limiter
   * (requirement 10.2, 13.1). When no frame was captured — or the previous
   * source was YouTube — pass `stationCardLabel` so a station card is
   * synthesised on canvas and flashed instead (requirement 10.3); the renderer
   * never reads from a YouTube player. Returns true if the flash was permitted.
   */
  flashPrevious(ms: number, nowMs: number, stationCardLabel?: string): boolean;
  /** Start the per-frame loop. */
  start(now?: number): void;
  /** Stop the per-frame loop. */
  stop(): void;
  /** Release resources and listeners. */
  dispose(): void;
}

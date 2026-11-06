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
  /** Start the per-frame loop. */
  start(now?: number): void;
  /** Stop the per-frame loop. */
  stop(): void;
  /** Release resources and listeners. */
  dispose(): void;
}

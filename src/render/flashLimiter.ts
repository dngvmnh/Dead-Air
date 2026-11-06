/**
 * Flash limiter (requirement 13.1, design.md §10).
 *
 * Photosensitivity safety: the screen must never show more than three flashes
 * in any one-second window, whatever the content asks for. Every effect that
 * can produce a luminance flash — tuning bursts, roll/tear pulses, event
 * `shaderPulse`/`flashPrevious` steps, sign-off — routes its flash requests
 * through a single limiter, so no code path can bypass the cap.
 *
 * Pure: no DOM, no WebGL, no wall-clock reads. The caller passes the current
 * time in (the renderer uses its rAF clock), keeping src/render testable and
 * the limit deterministic.
 */

/** Hard cap: at most three flashes per rolling one-second window (req 13.1). */
export const MAX_FLASHES_PER_SECOND = 3;

/** Length of the rolling window, in milliseconds. */
export const FLASH_WINDOW_MS = 1000;

export class FlashLimiter {
  /** Timestamps (ms) of flashes still inside the rolling window, oldest first. */
  private readonly recent: number[] = [];
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  /** When true, no flash is ever permitted (reduced effects / reduced motion). */
  private suppressed = false;

  constructor(
    maxPerWindow: number = MAX_FLASHES_PER_SECOND,
    windowMs: number = FLASH_WINDOW_MS,
  ) {
    this.maxPerWindow = Math.max(0, Math.floor(maxPerWindow));
    this.windowMs = Math.max(1, windowMs);
  }

  /**
   * Suppress all flashes regardless of the count. Used when Reduced Effects or
   * `prefers-reduced-motion` is active (requirement 13.2): flashes, roll and
   * jitter are disabled, so the limiter denies every request.
   */
  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
  }

  get isSuppressed(): boolean {
    return this.suppressed;
  }

  /**
   * Request permission to show one flash at time `nowMs`. Returns true and
   * records the flash if fewer than the cap have occurred in the trailing
   * window; otherwise returns false and records nothing. When suppressed, always
   * returns false.
   */
  tryFlash(nowMs: number): boolean {
    if (this.suppressed || this.maxPerWindow === 0) return false;
    this.evict(nowMs);
    if (this.recent.length >= this.maxPerWindow) return false;
    this.recent.push(nowMs);
    return true;
  }

  /** How many more flashes are allowed right now (0..maxPerWindow). */
  remaining(nowMs: number): number {
    if (this.suppressed) return 0;
    this.evict(nowMs);
    return Math.max(0, this.maxPerWindow - this.recent.length);
  }

  /** Forget all recorded flashes (e.g. on power-off or memory reset). */
  reset(): void {
    this.recent.length = 0;
  }

  /** Drop timestamps that have fallen out of the trailing window. */
  private evict(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    // Timestamps are pushed in non-decreasing order, so evict from the front.
    let drop = 0;
    while (drop < this.recent.length && this.recent[drop]! <= cutoff) drop += 1;
    if (drop > 0) this.recent.splice(0, drop);
  }
}

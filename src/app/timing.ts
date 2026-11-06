/**
 * Shared transition timings for the television (requirements 1.3, 1.4, 2.3).
 *
 * One source of truth for the durations the state machine's timers and the CRT
 * renderer's boot/shutdown/tuning envelopes both need, so they can never drift
 * apart. These mirror the design tokens in src/styles/tokens.css; keep the two
 * in step. Values are in milliseconds.
 *
 * - Boot must finish within 1500ms (requirement 1.3).
 * - Shutdown must collapse the picture within 800ms (requirement 1.4).
 * - Tuning shows static for 350–700ms (requirement 2.3); TUNE_MS sits inside
 *   that window.
 */
export const BOOT_MS = 1400;
export const SHUTDOWN_MS = 700;
export const TUNE_MS = 500;

import { expect, test, type Page } from '@playwright/test';

/**
 * Task 5.1: the procedural AudioEngine unlocks on the POWER gesture
 * (requirement 12.1) and applies volume/mute (requirement 12.3). Chromium only
 * (`--project=chromium`); firefox/webkit are not installed or run.
 *
 * Audio has no visible output, so this verifies real-browser behaviour that
 * jsdom cannot: that the AudioContext actually reaches the 'running' state after
 * a user gesture (browsers block audio before one). The engine is exposed on
 * window under the same test flag the renderer uses; production never sets it.
 */

async function ready(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean })
      .__CRT_PRESERVE_DRAWING_BUFFER__ = true;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /i understand/i }).click();
}

function readAudio(page: Page) {
  return page.evaluate(() => {
    const a = (window as unknown as {
      __tvAudio?: { context: { state: string } | null; effectiveGain: number; isUnlocked: boolean };
    }).__tvAudio;
    if (!a) return null;
    return {
      hasEngine: true,
      state: a.context ? a.context.state : null,
      effectiveGain: a.effectiveGain,
      isUnlocked: a.isUnlocked,
    };
  });
}

test.describe('AudioEngine', () => {
  test('unlocks the AudioContext on the POWER gesture (req 12.1)', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: /^power$/i }).click();

    // The context must reach 'running' after the gesture.
    await expect
      .poll(async () => (await readAudio(page))?.state, { timeout: 5000 })
      .toBe('running');

    const a = await readAudio(page);
    expect(a?.isUnlocked).toBe(true);
  });

  test('applies mute to the master gain (req 12.3)', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: /^power$/i }).click();
    await expect
      .poll(async () => (await readAudio(page))?.state, { timeout: 5000 })
      .toBe('running');

    // Default volume gives a positive master gain.
    const before = await readAudio(page);
    expect(before?.effectiveGain).toBeGreaterThan(0);

    // Muting drops the effective gain to zero.
    await page.getByRole('button', { name: /^mute$/i }).click();
    await expect
      .poll(async () => (await readAudio(page))?.effectiveGain, { timeout: 2000 })
      .toBe(0);
  });
});

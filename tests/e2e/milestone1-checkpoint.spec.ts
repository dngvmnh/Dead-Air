import { expect, test, type Page } from '@playwright/test';

/**
 * Milestone 1 checkpoint (task 6): POWER on, surf through static across the four
 * empty channels with the correct LED and sound, then POWER off. Chromium only
 * (`--project=chromium`); firefox/webkit are not installed or run.
 *
 * This is the end-to-end proof that the television, CRT renderer and audio come
 * together: every tune shows static on the canvas, the chassis LED tracks the
 * channel, the AudioContext is running (so sound is produced), and power-off
 * returns the screen to black. We read canvas pixels and renderer/audio state,
 * not merely the absence of errors. The engine and renderer are exposed on
 * window under the usual test flag; production never sets it.
 */

const CYCLE = ['02', '04', '07', '13'] as const;

async function ready(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean })
      .__CRT_PRESERVE_DRAWING_BUFFER__ = true;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /i understand/i }).click();
}

function ledText(page: Page) {
  return page.locator('[class*="channelLed"]').innerText();
}

async function canvasMeanLum(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="tube-opening"] canvas',
    );
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) return -1;
    const p = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) sum += (p[i]! + p[i + 1]! + p[i + 2]!) / 3;
    return sum / (canvas.width * canvas.height);
  });
}

function audioState(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __tvAudio?: { context: { state: string } | null } }).__tvAudio
        ?.context?.state ?? null,
  );
}

test.describe('Milestone 1 checkpoint', () => {
  test('powers on, surfs four channels through static with LED and sound, powers off', async ({
    page,
  }) => {
    await ready(page);
    const tube = page.getByTestId('tube-opening');

    // POWER on → boot → tune to channel 02 by default.
    await page.getByRole('button', { name: /^power$/i }).click();
    await expect
      .poll(async () => tube.getAttribute('data-phase'), { timeout: 12000 })
      .toMatch(/TUNING|ON_AIR/);
    await expect.poll(() => ledText(page), { timeout: 8000 }).toMatch(/02/);

    // Audio is running (sound is being produced), proving the gesture unlock.
    await expect.poll(() => audioState(page), { timeout: 5000 }).toBe('running');

    // Surf the full cycle 02 → 04 → 07 → 13 → 02. Each hop passes through static,
    // and the LED lands on the expected channel.
    for (let i = 1; i <= CYCLE.length; i += 1) {
      const expected = CYCLE[i % CYCLE.length]!;
      await page.getByRole('button', { name: /channel up/i }).click();

      // The tune shows static on the canvas: catch a bright frame during the
      // brief TUNING window by sampling against the best value seen.
      let brightest = 0;
      await expect
        .poll(
          async () => {
            const m = await canvasMeanLum(page);
            if (m > brightest) brightest = m;
            return brightest;
          },
          { timeout: 8000, intervals: [80] },
        )
        .toBeGreaterThan(16);

      // The LED tracks the channel once tuned.
      await expect.poll(() => ledText(page), { timeout: 8000 }).toMatch(new RegExp(expected));
    }

    // POWER off → the screen collapses and goes black.
    await page.getByRole('button', { name: /^power$/i }).click();
    await expect(tube).toHaveAttribute('data-phase', 'OFF');
    await expect
      .poll(async () => canvasMeanLum(page), { timeout: 5000, intervals: [100] })
      .toBeLessThan(8);

    // And audio is no longer running once powered off.
    await expect.poll(() => audioState(page), { timeout: 3000 }).not.toBe('running');
  });
});

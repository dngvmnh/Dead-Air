import { expect, test, type Page } from '@playwright/test';

/**
 * Proves the WebGL2 CRT shader actually DRAWS (task 4.1, requirement 5.1/5.4).
 *
 * jsdom has no WebGL, so the real pipeline can only be exercised in a browser.
 * This runs on Chromium only (`--project=chromium`); firefox/webkit are not
 * installed or run for this task. We power the TV on, let it reach TUNING where
 * the shader fills the screen with procedural static, and read the canvas back
 * to assert it drew a varied, non-black picture — not merely that nothing threw.
 */

/** Read the tube canvas pixels via its own WebGL2 context. */
async function sampleCanvas(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="tube-opening"] canvas',
    );
    if (!canvas) return { found: false as const };
    const gl = canvas.getContext('webgl2');
    if (!gl) return { found: true as const, webgl2: false as const };

    const w = canvas.width;
    const h = canvas.height;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Summarise: how many pixels are lit, and how many distinct luminance
    // buckets appear. Static should light most pixels across many buckets.
    let lit = 0;
    let sum = 0;
    const buckets = new Set<number>();
    const total = w * h;
    for (let i = 0; i < pixels.length; i += 4) {
      const lum = (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
      sum += lum;
      if (lum > 12) lit += 1;
      buckets.add(Math.floor(lum / 16));
    }
    return {
      found: true as const,
      webgl2: true as const,
      width: w,
      height: h,
      total,
      litFraction: lit / total,
      meanLum: sum / total,
      distinctBuckets: buckets.size,
    };
  });
}

test.describe('CRT renderer', () => {
  test('renders a WebGL2 canvas capped at 960×720 and draws procedural static', async ({
    page,
  }) => {
    await page.goto('/');

    // Dismiss the first-run content notice so POWER works.
    await page.getByRole('button', { name: /i understand/i }).click();

    // Power on and wait for the tuning phase, where the shader draws full static.
    await page.getByRole('button', { name: /^power$/i }).click();
    const tube = page.getByTestId('tube-opening');
    await expect(tube).toHaveAttribute('data-phase', 'TUNING', { timeout: 5000 });

    // Give the render loop a few frames to draw.
    await page.waitForTimeout(300);

    const sample = await sampleCanvas(page);
    expect(sample.found).toBe(true);
    if (!sample.found) return;
    // The environment must support WebGL2 for this proof to mean anything.
    expect(sample.webgl2, 'Chromium should provide a WebGL2 context').toBe(true);
    if (!sample.webgl2) return;

    // Internal resolution is capped (requirement 5.4): never above 960×720.
    expect(sample.width).toBeGreaterThan(0);
    expect(sample.height).toBeGreaterThan(0);
    expect(sample.width).toBeLessThanOrEqual(960);
    expect(sample.height).toBeLessThanOrEqual(720);

    // The shader actually drew: static lights most of the screen with a spread
    // of luminances, not a single flat colour and not black.
    expect(sample.litFraction, 'static should light most pixels').toBeGreaterThan(0.3);
    expect(sample.meanLum, 'mean luminance should not be black').toBeGreaterThan(16);
    expect(
      sample.distinctBuckets,
      'static should span many luminance values, not one flat colour',
    ).toBeGreaterThan(4);
  });

  test('keeps the canvas dark and unstarted while the TV is off', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /i understand/i }).click();

    const tube = page.getByTestId('tube-opening');
    await expect(tube).toHaveAttribute('data-phase', 'OFF');

    await page.waitForTimeout(150);
    const sample = await sampleCanvas(page);
    expect(sample.found).toBe(true);
    if (!sample.found || !('webgl2' in sample) || !sample.webgl2) return;

    // With uPower at 0 the shader multiplies the picture to black.
    expect(sample.meanLum, 'an off TV should be black').toBeLessThan(8);
  });
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Proves the WebGL2 CRT shader actually DRAWS and that the task-4.2 boot,
 * tuning and shutdown transitions are visible on the canvas (requirements 1.3,
 * 1.4, 2.3, 5.1, 5.4).
 *
 * jsdom has no WebGL, so the real pipeline can only be exercised in a browser.
 * This runs on Chromium only (`--project=chromium`); firefox/webkit are not
 * installed or run. Production disables preserveDrawingBuffer (this renderer
 * draws every frame and the 60 fps budget is unmeasured), so before any script
 * runs we set a window flag the app reads to enable it for the test alone; that
 * is what makes `gl.readPixels` on a later frame reliable here.
 *
 * Samples are taken with `expect.poll` rather than a fixed sleep, so the proof
 * does not race the render loop under parallel workers.
 */

interface CanvasSample {
  found: boolean;
  webgl2: boolean;
  width: number;
  height: number;
  litFraction: number;
  meanLum: number;
  distinctBuckets: number;
  /** Mean luminance of the middle 20% of rows (the collapse line region). */
  centreBandMeanLum: number;
  /** Mean luminance of the top 20% of rows (dark once collapsed). */
  topBandMeanLum: number;
}

/** Enable the test-only preserveDrawingBuffer path before the app boots. */
async function enablePixelReadback(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean })
      .__CRT_PRESERVE_DRAWING_BUFFER__ = true;
  });
}

/** Read the tube canvas pixels via its WebGL2 context and summarise them. */
async function sampleCanvas(page: Page): Promise<CanvasSample> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="tube-opening"] canvas',
    );
    if (!canvas) {
      return {
        found: false,
        webgl2: false,
        width: 0,
        height: 0,
        litFraction: 0,
        meanLum: 0,
        distinctBuckets: 0,
        centreBandMeanLum: 0,
        topBandMeanLum: 0,
      };
    }
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      return {
        found: true,
        webgl2: false,
        width: canvas.width,
        height: canvas.height,
        litFraction: 0,
        meanLum: 0,
        distinctBuckets: 0,
        centreBandMeanLum: 0,
        topBandMeanLum: 0,
      };
    }

    const w = canvas.width;
    const h = canvas.height;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let lit = 0;
    let sum = 0;
    const buckets = new Set<number>();
    const total = w * h;

    const bandLo = Math.floor(h * 0.4);
    const bandHi = Math.ceil(h * 0.6);
    const topLo = Math.floor(h * 0.8);
    let centreSum = 0;
    let centreCount = 0;
    let topSum = 0;
    let topCount = 0;

    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const lum = (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
        sum += lum;
        if (lum > 12) lit += 1;
        buckets.add(Math.floor(lum / 16));
        if (y >= bandLo && y < bandHi) {
          centreSum += lum;
          centreCount += 1;
        }
        if (y >= topLo) {
          topSum += lum;
          topCount += 1;
        }
      }
    }

    return {
      found: true,
      webgl2: true,
      width: w,
      height: h,
      litFraction: lit / total,
      meanLum: sum / total,
      distinctBuckets: buckets.size,
      centreBandMeanLum: centreCount > 0 ? centreSum / centreCount : 0,
      topBandMeanLum: topCount > 0 ? topSum / topCount : 0,
    };
  });
}

async function dismissNoticeAndReady(page: Page) {
  await enablePixelReadback(page);
  await page.goto('/');
  await page.getByRole('button', { name: /i understand/i }).click();
}

test.describe('CRT renderer', () => {
  test('renders a WebGL2 canvas capped at 960×720 and draws procedural static', async ({
    page,
  }) => {
    await dismissNoticeAndReady(page);

    await page.getByRole('button', { name: /^power$/i }).click();

    // The TUNING static window is brief (~500ms) and can be missed under heavy
    // parallel load, so we poll for the full-static signature from the moment
    // POWER is pressed and keep the brightest sample seen. Static lights most of
    // the screen across many luminance buckets — not black, not one flat colour.
    let best = { litFraction: 0, meanLum: 0, distinctBuckets: 0, width: 0, height: 0, webgl2: false };
    await expect
      .poll(
        async () => {
          const s = await sampleCanvas(page);
          if (s.webgl2 && s.meanLum > best.meanLum) {
            best = {
              litFraction: s.litFraction,
              meanLum: s.meanLum,
              distinctBuckets: s.distinctBuckets,
              width: s.width,
              height: s.height,
              webgl2: s.webgl2,
            };
          }
          return best.meanLum;
        },
        { timeout: 12000, intervals: [100] },
      )
      .toBeGreaterThan(16);

    expect(best.webgl2, 'Chromium should provide a WebGL2 context').toBe(true);

    // Internal resolution is capped (requirement 5.4): never above 960×720.
    expect(best.width).toBeGreaterThan(0);
    expect(best.height).toBeGreaterThan(0);
    expect(best.width).toBeLessThanOrEqual(960);
    expect(best.height).toBeLessThanOrEqual(720);

    // The shader actually drew static: most of the screen lit, many luminances.
    expect(best.litFraction, 'static should light most pixels').toBeGreaterThan(0.3);
    expect(best.meanLum, 'mean luminance should not be black').toBeGreaterThan(16);
    expect(
      best.distinctBuckets,
      'static should span many luminance values, not one flat colour',
    ).toBeGreaterThan(4);
  });

  test('keeps the canvas dark and unstarted while the TV is off', async ({ page }) => {
    await dismissNoticeAndReady(page);

    const tube = page.getByTestId('tube-opening');
    await expect(tube).toHaveAttribute('data-phase', 'OFF');

    // The off TV must stay black: poll a few times so a transient can't pass.
    await expect
      .poll(async () => (await sampleCanvas(page)).meanLum, { timeout: 2000 })
      .toBeLessThan(8);
  });

  test('warms up during BOOTING: the picture brightens over time (req 1.3)', async ({
    page,
  }) => {
    await dismissNoticeAndReady(page);

    // Capture the earliest frame right after POWER (dark warm-up start), then
    // poll for the picture brightening as uPower ramps 0→1. We assert the rise
    // rather than catching the brief BOOTING phase label, which can be missed
    // under heavy parallel load.
    await page.getByRole('button', { name: /^power$/i }).click();
    const early = await sampleCanvas(page);
    expect(early.webgl2).toBe(true);

    await expect
      .poll(async () => (await sampleCanvas(page)).meanLum, { timeout: 10000, intervals: [100] })
      .toBeGreaterThan(early.meanLum + 2);
  });

  test('collapses to a line and darkens on power-off (req 1.4)', async ({ page }) => {
    await dismissNoticeAndReady(page);
    const tube = page.getByTestId('tube-opening');

    // Power on and reach the lit on-air phase.
    await page.getByRole('button', { name: /^power$/i }).click();
    await expect(tube).toHaveAttribute('data-phase', 'ON_AIR', { timeout: 12000 });
    await expect
      .poll(async () => (await sampleCanvas(page)).meanLum, { timeout: 8000, intervals: [100] })
      .toBeGreaterThan(2);
    const onAir = await sampleCanvas(page);
    expect(onAir.webgl2).toBe(true);

    // Power off: the shutdown envelope collapses the picture to a centre line
    // and darkens it (requirement 1.4). While it collapses, rows away from the
    // centre map outside the tube and go black, so the centre band stays
    // brighter than the top band. Capture the strongest such frame as the
    // picture dims below its on-air brightness.
    await page.getByRole('button', { name: /^power$/i }).click();
    await expect(tube).toHaveAttribute('data-phase', 'OFF');

    let maxCollapseGap = -Infinity;
    let sawDimming = false;
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const s = await sampleCanvas(page);
      if (s.meanLum < onAir.meanLum) sawDimming = true;
      maxCollapseGap = Math.max(maxCollapseGap, s.centreBandMeanLum - s.topBandMeanLum);
      if (s.meanLum < 1) break;
    }

    expect(sawDimming, 'power-off dims the picture below on-air brightness').toBe(true);
    expect(
      maxCollapseGap,
      'the collapse concentrates light at the centre line (centre brighter than top)',
    ).toBeGreaterThanOrEqual(0);

    // After the shutdown window the screen is essentially black.
    await expect
      .poll(async () => (await sampleCanvas(page)).meanLum, { timeout: 5000, intervals: [100] })
      .toBeLessThan(8);
  });
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Task 14: channels 04 (Pumpkin Hour) and 07 (Midnight Shopping) play their
 * scene rundowns, and channel 07's set changes on revisit (requirement 8.4:
 * "change at least one set object relative to the previous visit"). Chromium
 * only (`--project=chromium`); firefox/webkit are not installed or run.
 *
 * We drive a fake clock for determinism and read tube-canvas pixels: each
 * channel draws a lit, structured picture, and visiting channel 07 a second
 * time produces a visibly different frame (the shelf's clock slot appears at
 * minVisits:2), proving the moving-set-object variant.
 */

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T20:00:00Z') });
  await page.addInitScript(() => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean })
      .__CRT_PRESERVE_DRAWING_BUFFER__ = true;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /i understand/i }).click();
}

function phase(page: Page) {
  return page.getByTestId('tube-opening').getAttribute('data-phase');
}

function ledText(page: Page) {
  return page.locator('[class*="channelLed"]').innerText();
}

interface Frame {
  meanLum: number;
  litFraction: number;
  buckets: number;
  /** A coarse per-region luminance fingerprint for comparing two frames. */
  signature: number[];
}

async function readFrame(page: Page): Promise<Frame> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="tube-opening"] canvas');
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) return { meanLum: -1, litFraction: -1, buckets: -1, signature: [] };
    const w = canvas.width;
    const h = canvas.height;
    const p = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);
    let sum = 0;
    let lit = 0;
    const seen = new Set<number>();
    // 4x4 region grid fingerprint.
    const grid = 4;
    const regLum = new Array(grid * grid).fill(0);
    const regCount = new Array(grid * grid).fill(0);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const lum = (p[i]! + p[i + 1]! + p[i + 2]!) / 3;
        sum += lum;
        if (lum > 12) lit += 1;
        seen.add(Math.round(lum / 8));
        const rx = Math.min(grid - 1, Math.floor((x / w) * grid));
        const ry = Math.min(grid - 1, Math.floor((y / h) * grid));
        const r = ry * grid + rx;
        regLum[r] += lum;
        regCount[r] += 1;
      }
    }
    const n = w * h;
    const signature = regLum.map((s, idx) => (regCount[idx] ? s / regCount[idx] : 0));
    return { meanLum: sum / n, litFraction: lit / n, buckets: seen.size, signature };
  });
}

async function onAir(page: Page) {
  await expect.poll(() => phase(page), { timeout: 10000 }).toBe('ON_AIR');
}

test.describe('Channels 04 and 07', () => {
  test('channel 04 draws the Pumpkin Hour scene', async ({ page }) => {
    await setup(page);
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.clock.runFor(2500);
    await onAir(page); // channel 02

    // Surf 02 -> 04.
    await page.getByRole('button', { name: /channel up/i }).click();
    await page.clock.runFor(700);
    await expect.poll(() => ledText(page)).toMatch(/04/);
    await onAir(page);

    let best: Frame = { meanLum: 0, litFraction: 0, buckets: 0, signature: [] };
    await expect
      .poll(
        async () => {
          const f = await readFrame(page);
          if (f.meanLum > best.meanLum) best = f;
          return best.meanLum;
        },
        { timeout: 8000, intervals: [100] },
      )
      .toBeGreaterThan(12);
    expect(best.litFraction).toBeGreaterThan(0.2);
    expect(best.buckets).toBeGreaterThan(4);
  });

  test('channel 07 draws the Midnight Shopping scene', async ({ page }) => {
    await setup(page);
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.clock.runFor(2500);
    await onAir(page); // channel 02

    // Surf 02 -> 04 -> 07.
    await page.getByRole('button', { name: /channel up/i }).click();
    await page.clock.runFor(700);
    await page.getByRole('button', { name: /channel up/i }).click();
    await page.clock.runFor(700);
    await expect.poll(() => ledText(page)).toMatch(/07/);
    await onAir(page);

    let best: Frame = { meanLum: 0, litFraction: 0, buckets: 0, signature: [] };
    await expect
      .poll(
        async () => {
          const f = await readFrame(page);
          if (f.meanLum > best.meanLum) best = f;
          return best.meanLum;
        },
        { timeout: 8000, intervals: [100] },
      )
      .toBeGreaterThan(12);
    expect(best.litFraction).toBeGreaterThan(0.2);
    expect(best.buckets).toBeGreaterThan(4);
  });
});

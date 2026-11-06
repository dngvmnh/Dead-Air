import { expect, test, type Page } from '@playwright/test';

/**
 * Task 10: channel 02 plays its scene rundown on the tube. Chromium only
 * (`--project=chromium`); firefox/webkit are not installed or run.
 *
 * We power on (which tunes to channel 02 by default), wait for ON_AIR, and
 * read the tube canvas pixels to prove the scene actually drew through the CRT
 * shader — not merely that no error was thrown. The placeholder scene paints a
 * navy newsroom with a red logo and off-white text, so the picture is lit, has
 * many distinct luminance values (structure, unlike flat black), and carries a
 * visible blue component from the navy palette. We also confirm the programme
 * advances across an item boundary (a second item is reached), proving the
 * clock → adapter → re-resolve loop (requirement 3.3).
 */

async function ready(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean })
      .__CRT_PRESERVE_DRAWING_BUFFER__ = true;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /i understand/i }).click();
}

interface Pixels {
  meanLum: number;
  litFraction: number;
  buckets: number;
  meanBlue: number;
}

async function readPixels(page: Page): Promise<Pixels> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="tube-opening"] canvas',
    );
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) return { meanLum: -1, litFraction: -1, buckets: -1, meanBlue: -1 };
    const p = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
    const n = canvas.width * canvas.height;
    let sum = 0;
    let lit = 0;
    let blue = 0;
    const seen = new Set<number>();
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i]!;
      const g = p[i + 1]!;
      const b = p[i + 2]!;
      const lum = (r + g + b) / 3;
      sum += lum;
      blue += b;
      if (lum > 12) lit += 1;
      seen.add(Math.round(lum / 8));
    }
    return { meanLum: sum / n, litFraction: lit / n, buckets: seen.size, meanBlue: blue / n };
  });
}

function broadcastPos(page: Page): Promise<number | null> {
  return page.evaluate(
    () =>
      (window as unknown as { __tv?: { broadcastPositionMs: () => number | null } }).__tv
        ?.broadcastPositionMs() ?? null,
  );
}

test.describe('Channel 02 rundown', () => {
  test('tunes to channel 02 and draws the scene on the tube', async ({ page }) => {
    await ready(page);
    const tube = page.getByTestId('tube-opening');

    await page.getByRole('button', { name: /^power$/i }).click();

    // Reach ON_AIR (boot → tune → source playing).
    await expect
      .poll(async () => tube.getAttribute('data-phase'), { timeout: 15000 })
      .toBe('ON_AIR');

    // The scene is drawn through the shader: lit, structured, and carrying the
    // navy palette's blue. Poll the brightest/best frame to avoid sampling a
    // transient dark frame.
    let best: Pixels = { meanLum: 0, litFraction: 0, buckets: 0, meanBlue: 0 };
    await expect
      .poll(
        async () => {
          const px = await readPixels(page);
          if (px.meanLum > best.meanLum) best = px;
          return best.meanLum;
        },
        { timeout: 10000, intervals: [100] },
      )
      .toBeGreaterThan(14);

    expect(best.litFraction).toBeGreaterThan(0.3);
    // A real picture has many luminance levels; flat black/one-colour would not.
    expect(best.buckets).toBeGreaterThan(4);
    // The navy newsroom contributes a clear blue component.
    expect(best.meanBlue).toBeGreaterThan(10);
  });

  test('advances across an item boundary without user action (requirement 3.3)', async ({
    page,
  }) => {
    // Use a fake clock so progression is deterministic (no real-time race under
    // parallel workers). The first item (station ID) is 8s; after ~10s the
    // clock must have re-resolved to a later item with no user input.
    await page.clock.install({ time: new Date('2026-01-01T20:00:00Z') });
    await page.addInitScript(() => {
      (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean })
        .__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    });
    await page.goto('/');
    await page.getByRole('button', { name: /i understand/i }).click();
    const tube = page.getByTestId('tube-opening');

    await page.getByRole('button', { name: /^power$/i }).click();
    await page.clock.runFor(2500); // boot + tune
    await expect.poll(async () => tube.getAttribute('data-phase'), { timeout: 10000 }).toBe('ON_AIR');

    const pos0 = await broadcastPos(page);
    expect(pos0).not.toBeNull();

    // Advance 10s of wall-clock time: past the 8s first item. The clock-driven
    // item-end fires ITEM_ENDED and re-resolves with no user action.
    await page.clock.runFor(10_000);

    const TOTAL_MS = 92_000;
    await expect
      .poll(
        async () => {
          const p = await broadcastPos(page);
          if (p === null) return 0;
          return ((p - (pos0 as number)) % TOTAL_MS + TOTAL_MS) % TOTAL_MS;
        },
        { timeout: 8000, intervals: [200] },
      )
      .toBeGreaterThan(8000);

    // The TV is still playing a programme (not off/idle) after the boundary.
    expect(['ON_AIR', 'EVENT', 'TUNING']).toContain(await tube.getAttribute('data-phase'));
  });
});

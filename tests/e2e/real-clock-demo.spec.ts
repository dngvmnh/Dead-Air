import { expect, test } from '@playwright/test';

/**
 * Requirement 9.4, task 11: from a fresh memory on the real clock, a viewer who
 * presses CH+ every 15 seconds under `?demo=1` reaches the sign-off within 3 min
 * 30 s, seeing E13 on the way. No test flag, so startles run as they do for anyone.
 * About three minutes long, so it runs only when asked for:
 *
 *   REAL_CLOCK=1 PW_GPU=1 npx playwright test --project=chromium real-clock-demo
 */

const LIMIT_MS = 210_000;
const SURF_MS = 15_000;

test('fresh viewer, CH+ every 15 s, reaches the sign-off through E13', async ({ page }) => {
  test.skip(!process.env.REAL_CLOCK, 'Real-clock run. Set REAL_CLOCK=1.');
  test.setTimeout(LIMIT_MS + 30_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?demo=1&reset=1');
  await page.getByRole('button', { name: /i understand/i }).click();
  const up = await page.getByRole('button', { name: /channel up/i }).boundingBox();
  await page.getByRole('button', { name: /^power$/i }).click();
  const start = Date.now();

  const shots = process.env.REAL_CLOCK_SHOTS;
  const timeline: string[] = [];
  const seen = new Set<string>();
  let nextSurf = start + SURF_MS;
  let surfs = 0;
  let signOffAt: number | null = null;
  while (Date.now() - start < LIMIT_MS) {
    const live = await page.evaluate(() => document.querySelector('[aria-live]')?.textContent ?? '');
    if (live.includes('BROADCAST TERMINATED')) {
      signOffAt = Date.now() - start;
      break;
    }
    const fired = await page.evaluate(() => {
      const raw = localStorage.getItem('deadair.memory.v1');
      return raw ? Object.keys((JSON.parse(raw) as { firedEvents: Record<string, unknown> }).firedEvents) : [];
    });
    for (const id of fired) {
      if (seen.has(id)) continue;
      seen.add(id);
      timeline.push(`${Math.round((Date.now() - start) / 1000)}s ${id}`);
      if (id === 'E13' && shots) await page.screenshot({ path: `${shots}/demo-e13.png` });
    }
    if (Date.now() >= nextSurf) {
      // A real click where the button is: a jump covering the window takes it, as
      // it would from a real viewer.
      await page.mouse.click(up!.x + up!.width / 2, up!.y + up!.height / 2);
      surfs += 1;
      nextSurf += SURF_MS;
    }
    await page.waitForTimeout(250);
  }
  if (shots) await page.screenshot({ path: `${shots}/demo-signoff.png` });
  console.log(`sign-off at ${signOffAt === null ? 'never' : `${(signOffAt / 1000).toFixed(1)} s`} after ${surfs} surfs`);
  console.log(timeline.join(', '));

  expect(errors).toEqual([]);
  expect(signOffAt).not.toBeNull();
  expect(signOffAt!).toBeLessThanOrEqual(LIMIT_MS);
  // Stored within a 5 s throttle, but E13 and the sign-off both flush at once.
  expect([...seen]).toContain('E13');
});

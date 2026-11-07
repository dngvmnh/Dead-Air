import { expect, test, type Page } from '@playwright/test';

/**
 * Requirement 11.12: a startle that comes due waits for the viewer, and lands on what
 * they do. The real pacer runs here at its real timings; only the start is a seam.
 * And the set fills the screen from the first click.
 */

interface Tv {
  phase: () => string;
  runPacer: () => void;
  pacer: () => { dueAt: number | null; armedUntil: number | null; firedAt: number[] } | null;
  lastStartle: () => string | null;
}

async function seed(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((more) => {
    const w = window as unknown as Record<string, unknown>;
    w.__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    Object.assign(w, more);
    const ch = () => ({ visits: 1, watchMs: 0, lastVisitedAt: 1 });
    const now = Date.now();
    localStorage.setItem(
      'deadair.memory.v1',
      JSON.stringify({
        schemaVersion: 1,
        firstSeenAt: now - 3600000,
        lastSeenAt: now - 1000,
        sessionCount: 1,
        totalWatchMs: 0,
        channels: { 2: ch(), 4: ch(), 7: ch(), 13: ch() },
        visitOrder: [2],
        lastChannel: 2,
        firedEvents: {},
        act: 0,
        noticeSeen: true,
        settings: { volume: 0, muted: true, captions: true, reducedEffects: false },
      }),
    );
  }, extra);
}

const tv = <T,>(page: Page, fn: (t: Tv) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__tv)`) as Promise<T>;

async function onAirWithPacer(page: Page): Promise<void> {
  await seed(page);
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __tv?: unknown }).__tv);
  await tv(page, (t) => t.runPacer());
  await page.getByRole('button', { name: /^power$/i }).click();
  await expect.poll(() => tv(page, (t) => t.phase()), { timeout: 15000 }).toBe('ON_AIR');
}

/** Wait until a startle is due and waiting for the viewer. */
async function armed(page: Page): Promise<void> {
  // Due, on air, and with time left to act in. A story event can take the screen
  // first; the pacer then waits again.
  await expect
    .poll(
      () =>
        tv(page, (t) => {
          const p = t.pacer();
          return t.phase() === 'ON_AIR' && p !== null && p.armedUntil !== null && p.armedUntil - Date.now() > 1200;
        }),
      { timeout: 40000, intervals: [100] },
    )
    .toBe(true);
}

test.describe('startles land on what the viewer does', () => {
  test.describe.configure({ timeout: 90000 });
  // What is checked is that one fired, and when, not which one the director chose.
  const fired = (page: Page) => tv(page, (t) => t.pacer()?.firedAt.length ?? 0);

  /**
   * Wait until one is due, click, and return how long it took to land. The director
   * can refuse at an item change-over; the pacer then comes due again shortly, so
   * try again, at most three times.
   */
  async function clickWhenDue(page: Page): Promise<number> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await armed(page);
      const before = Date.now();
      await page.getByRole('button', { name: /closed captions/i }).click();
      const ok = await expect
        .poll(() => fired(page), { timeout: 1500, intervals: [25] })
        .toBe(1)
        .then(() => true)
        .catch(() => false);
      if (ok) return Date.now() - before;
    }
    throw new Error('no startle landed on a click in three tries');
  }

  test('a due startle waits, then lands on a click', async ({ page }) => {
    await onAirWithPacer(page);
    expect(await fired(page)).toBe(0);
    const lag = await clickWhenDue(page);
    expect(lag).toBeLessThan(1500);
    expect(await tv(page, (t) => t.lastStartle())).not.toBeNull();
  });

  test('keeping still is no shelter', async ({ page }) => {
    await onAirWithPacer(page);
    await armed(page);
    const until = await tv(page, (t) => t.pacer()!.armedUntil!);
    await expect.poll(() => fired(page), { timeout: 9000 }).toBe(1);
    expect(Date.now()).toBeGreaterThanOrEqual(until - 50);
  });

  test('right after one, clicking does not bring another', async ({ page }) => {
    await onAirWithPacer(page);
    await clickWhenDue(page);
    const cc = page.getByRole('button', { name: /closed captions/i });
    const first = await tv(page, (t) => t.pacer()!.firedAt[0]!);
    // Keep clicking for most of the gap. A slow machine may click on past it, when a
    // new one may rightly come, so what is checked is the gap itself.
    while ((await page.evaluate(() => Date.now())) - first < 6000) {
      await cc.click();
      await page.waitForTimeout(250);
    }
    const times = await tv(page, (t) => t.pacer()!.firedAt);
    expect(times.filter((t) => t - first > 0 && t - first < 8000)).toEqual([]);
  });

  test('the first tear of the session answers as the hand leaves the wall', async ({ page }) => {
    await onAirWithPacer(page);
    const chassis = await page.locator('[class*="chassis"]').first().boundingBox();
    const x = Math.round((chassis?.x ?? 200) / 2);
    await page.mouse.move(x, 200);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) await page.mouse.move(x, 200 + i * 20);
    await page.mouse.up();
    await expect.poll(() => tv(page, (t) => t.lastStartle()), { timeout: 3000 }).not.toBeNull();
  });
});

test.describe('fullscreen', () => {
  test('the first POWER press fills the screen', async ({ page }) => {
    await seed(page, { __FULLSCREEN_TEST__: true });
    await page.goto('/');
    await page.waitForFunction(() => (window as unknown as { __tv?: unknown }).__tv);
    expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await page.getByRole('button', { name: /^power$/i }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  });

  test('the first-run notice fills the screen when acknowledged', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
      (window as unknown as Record<string, unknown>).__FULLSCREEN_TEST__ = true;
    });
    await page.goto('/');
    await page.getByRole('button', { name: /i understand/i }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  });
});

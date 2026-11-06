import { expect, test, type Page } from '@playwright/test';

/**
 * Startles (requirement 15). The timer is off under the test flag, so each test
 * fires one on demand and then proves it comes back to the programme.
 */

async function seed(page: Page, act: number, reduced = false): Promise<void> {
  await page.addInitScript(
    ([a, r]) => {
      (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
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
          act: a,
          noticeSeen: true,
          settings: { volume: 0.7, muted: false, captions: true, reducedEffects: r },
        }),
      );
    },
    [act, reduced] as const,
  );
}

interface Tv {
  phase: () => string;
  channel: () => number | null;
  lastEventText: () => string;
  forceStartle: (id: string) => string | null;
  forceTearAnswer: () => void;
  lastStartle: () => string | null;
  roomEventRunning: () => boolean;
}

const tv = <T,>(page: Page, fn: (t: Tv) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__tv)`) as Promise<T>;

async function onAir(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /^power$/i }).click();
  await expect.poll(() => tv(page, (t) => t.phase()), { timeout: 15000 }).toBe('ON_AIR');
}

test.describe('startles', () => {
  test('a picture startle shows, then returns to the programme', async ({ page }) => {
    await seed(page, 1);
    await onAir(page);
    await page.evaluate(() => (window as unknown as { __tv: Tv }).__tv.forceStartle('S01'));
    await expect.poll(() => tv(page, (t) => t.phase()), { timeout: 3000 }).toBe('EVENT');
    await expect.poll(() => tv(page, (t) => t.lastEventText()), { timeout: 4000 }).toBe('ALDER RD');
    await expect.poll(() => tv(page, (t) => t.phase()), { timeout: 7000 }).toBe('ON_AIR');
  });

  test('a room startle leaves the picture alone and restores the lights', async ({ page }) => {
    await seed(page, 0);
    await onAir(page);
    await page.evaluate(() => (window as unknown as { __tv: Tv }).__tv.forceStartle('S05'));
    expect(await tv(page, (t) => t.phase())).toBe('ON_AIR');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __room: { level: () => number } }).__room.level()), { timeout: 2000 })
      .toBeLessThan(0.9);
    expect(await tv(page, (t) => t.phase())).toBe('ON_AIR');
    await expect.poll(() => tv(page, (t) => t.roomEventRunning()), { timeout: 5000 }).toBe(false);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __room: { level: () => number } }).__room.level()), { timeout: 3000 })
      .toBeGreaterThan(0.98);
  });

  test('changing channel cuts a startle short', async ({ page }) => {
    await seed(page, 1);
    await onAir(page);
    await page.evaluate(() => (window as unknown as { __tv: Tv }).__tv.forceStartle('S01'));
    await expect.poll(() => tv(page, (t) => t.phase()), { timeout: 3000 }).toBe('EVENT');
    await page.getByRole('button', { name: /channel up|^\+$/i }).click();
    await expect.poll(() => tv(page, (t) => t.channel()), { timeout: 3000 }).toBe(4);
    await expect.poll(() => tv(page, (t) => t.phase()), { timeout: 8000 }).toBe('ON_AIR');
    expect(await tv(page, (t) => t.channel())).toBe(4);
  });

  test('powering off cuts a room startle and restores the lights', async ({ page }) => {
    await seed(page, 1);
    await onAir(page);
    await page.evaluate(() => (window as unknown as { __tv: Tv }).__tv.forceStartle('S07'));
    await page.getByRole('button', { name: /^power$/i }).click();
    await expect.poll(() => tv(page, (t) => t.roomEventRunning()), { timeout: 6000 }).toBe(false);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __room: { level: () => number } }).__room.level()), { timeout: 4000 })
      .toBeGreaterThan(0.98);
  });

  test('a finished tear can answer back, without touching the picture', async ({ page }) => {
    await seed(page, 1);
    await onAir(page);
    await page.evaluate(() => (window as unknown as { __tv: Tv }).__tv.forceTearAnswer());
    const chassis = await page.locator('[class*="chassis"]').first().boundingBox();
    const x = Math.round((chassis?.x ?? 200) / 2);
    await page.mouse.move(x, 200);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) await page.mouse.move(x, 200 + i * 20);
    await page.mouse.up();
    await expect.poll(() => tv(page, (t) => t.lastStartle()), { timeout: 3000 }).toBe('T01');
    expect(await tv(page, (t) => t.phase())).toBe('ON_AIR');
  });

  test('a startle still shows under reduced effects', async ({ page }) => {
    await seed(page, 1, true);
    await onAir(page);
    await page.evaluate(() => (window as unknown as { __tv: Tv }).__tv.forceStartle('S01'));
    await expect.poll(() => tv(page, (t) => t.lastEventText()), { timeout: 4000 }).toBe('ALDER RD');
    await expect.poll(() => tv(page, (t) => t.phase()), { timeout: 7000 }).toBe('ON_AIR');
  });
});

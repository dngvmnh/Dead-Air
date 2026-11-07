import { expect, test, type Page } from '@playwright/test';

/**
 * Startles (requirement 11). The timer is off under the test flag, so each test
 * fires one on demand and then proves it comes back to the programme.
 */

async function seed(page: Page, act: number): Promise<void> {
  await page.addInitScript(
    (a) => {
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
          settings: { volume: 0.7, muted: false, captions: true, reducedEffects: false },
        }),
      );
    },
    act,
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
  test('a jump arrives cold: nothing on the tube first, face already painted', async ({ page }) => {
    await seed(page, 0);
    await onAir(page);
    await page.evaluate(() => {
      const w = window as unknown as { __firstBright: number; __tv: Tv };
      w.__firstBright = -1;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (!(n instanceof HTMLCanvasElement) || n.dataset.testid !== 'jump-scare') continue;
            const { data } = n.getContext('2d')!.getImageData(0, 0, n.width, n.height);
            let sum = 0;
            for (let i = 0; i < data.length; i += 4) sum += data[i]!;
            w.__firstBright = sum / (data.length / 4);
          }
        }
      }).observe(document.body, { childList: true });
      w.__tv.forceStartle('S01');
    });
    // The picture never leaves the programme, so nothing on the tube can warn of it.
    expect(await tv(page, (t) => t.phase())).toBe('ON_AIR');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __firstBright: number }).__firstBright), { timeout: 3000 })
      .toBeGreaterThan(20);
  });

  test('a jump fills the window, takes no clicks, and goes away', async ({ page }) => {
    await seed(page, 0);
    await onAir(page);
    await page.evaluate(() => (window as unknown as { __tv: Tv }).__tv.forceStartle('S01'));
    const jump = page.locator('[data-testid="jump-scare"]');
    await expect(jump).toHaveCount(1, { timeout: 5000 });
    const box = await jump.boundingBox();
    expect(box?.width).toBe(page.viewportSize()?.width);
    expect(await jump.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    await expect(jump).toHaveCount(0, { timeout: 3000 });
    await expect.poll(() => tv(page, (t) => t.phase()), { timeout: 5000 }).toBe('ON_AIR');
  });

  test('the system reduced-motion setting keeps the sound and drops the picture', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(page, 0);
    await onAir(page);
    await page.evaluate(() => {
      (window as unknown as { __sawJump: boolean }).__sawJump = false;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="jump-scare"]')) (window as unknown as { __sawJump: boolean }).__sawJump = true;
      }).observe(document.body, { childList: true });
      (window as unknown as { __tv: Tv }).__tv.forceStartle('S01');
    });
    await expect.poll(() => tv(page, (t) => t.roomEventRunning()), { timeout: 3000 }).toBe(true);
    await expect.poll(() => tv(page, (t) => t.roomEventRunning()), { timeout: 5000 }).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { __sawJump: boolean }).__sawJump)).toBe(false);
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
    await page.evaluate(() => (window as unknown as { __tv: Tv }).__tv.forceStartle('S07'));
    await expect.poll(() => tv(page, (t) => t.roomEventRunning()), { timeout: 2000 }).toBe(true);
    await page.getByRole('button', { name: /channel up|^\+$/i }).click();
    await expect.poll(() => tv(page, (t) => t.channel()), { timeout: 3000 }).toBe(4);
    await expect.poll(() => tv(page, (t) => t.roomEventRunning()), { timeout: 3000 }).toBe(false);
    await expect.poll(() => tv(page, (t) => t.phase()), { timeout: 8000 }).toBe('ON_AIR');
  });

  test('every kind of jump plays and goes away', async ({ page }) => {
    test.setTimeout(90000);
    await seed(page, 0);
    await onAir(page);
    const jump = page.locator('[data-testid="jump-scare"]');
    for (const id of ['S01', 'J01', 'J02', 'J03', 'J04', 'J05', 'J06', 'J07', 'J08', 'J09', 'J10']) {
      // A startle is refused while an item changes over, so ask until it is taken.
      await expect
        .poll(() => page.evaluate((i) => (window as unknown as { __tv: Tv }).__tv.forceStartle(i), id), { timeout: 8000 })
        .toBe(id);
      await expect(jump, id).toHaveCount(1, { timeout: 5000 });
      await expect(jump, id).toHaveCount(0, { timeout: 3000 });
      await expect.poll(() => tv(page, (t) => t.roomEventRunning()), { timeout: 2000 }).toBe(false);
    }
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
    await expect.poll(() => tv(page, (t) => t.lastStartle()), { timeout: 3000 }).toBe('T03');
    expect(await tv(page, (t) => t.phase())).toBe('ON_AIR');
  });
});

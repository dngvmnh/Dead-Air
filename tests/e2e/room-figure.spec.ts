import { expect, test, type Page } from '@playwright/test';

/**
 * Task 8: the figure and objects move only while nobody is looking (requirements
 * 5.5, 5.6), with real pixels for the part a viewer sees.
 */

interface RoomSeam {
  figureStep: () => number;
  objectVariant: () => number;
  level: () => number;
}

type Win = { __room?: RoomSeam; __tv?: { phase: () => string; channel: () => number | null } };

function memory(extra: Record<string, unknown>, room: Record<string, unknown> = {}): Record<string, unknown> {
  const ch = () => ({ visits: 1, watchMs: 0, lastVisitedAt: 1 });
  const now = Date.now();
  return {
    schemaVersion: 2,
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
    settings: { volume: 1, muted: false, captions: true, reducedEffects: false },
    room: { strokes: [], figureStep: 0, objectVariant: 0, ripBackDone: false, ...room },
    ...extra,
  };
}

async function open(page: Page, stored: Record<string, unknown>): Promise<void> {
  await page.addInitScript((m) => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('deadair.memory.v1', JSON.stringify(m));
      sessionStorage.setItem('seeded', '1');
    }
  }, stored);
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as Win).__room && (window as unknown as Win).__tv);
}

const step = (page: Page) => page.evaluate(() => (window as unknown as Win).__room!.figureStep());
const variant = (page: Page) => page.evaluate(() => (window as unknown as Win).__room!.objectVariant());
const storedRoom = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('deadair.memory.v1') ?? '{}') as { room?: { figureStep: number; objectVariant: number } }).room);

async function powerOn(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^power$/i }).click();
  await page.waitForFunction(() => (window as unknown as Win).__tv!.phase() === 'ON_AIR', undefined, { timeout: 15000 });
}

/** Summed brightness of the wall's right-hand band: where the figure stands. */
function rightBand(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="room-canvas"]')!;
    const gl = canvas.getContext('webgl2')!;
    const x = Math.floor(canvas.width * 0.88);
    const w = canvas.width - x;
    const px = new Uint8Array(w * canvas.height * 4);
    gl.readPixels(x, 0, w, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i]! + px[i + 1]! + px[i + 2]!;
    return sum;
  });
}

test.describe('the figure and the objects', () => {
  test('nothing moves on load, and a reload does not move it', async ({ page }) => {
    await open(page, memory({ act: 3 }, { figureStep: 1, objectVariant: 1 }));
    await page.waitForTimeout(1500);
    expect(await step(page)).toBe(1);
    expect(await variant(page)).toBe(1);
    await page.reload();
    await page.waitForFunction(() => (window as unknown as Win).__room);
    await page.waitForTimeout(1000);
    expect(await step(page)).toBe(1);
    expect(await storedRoom(page)).toMatchObject({ figureStep: 1, objectVariant: 1 });
  });

  test('a tune is one step closer, and watching changes nothing', async ({ page }) => {
    await open(page, memory({ act: 2, sessionCount: 2 }, { figureStep: 1, objectVariant: 1 }));
    await powerOn(page);
    await expect.poll(() => step(page)).toBe(2);
    await expect.poll(() => variant(page)).toBe(2);
    expect(await storedRoom(page)).toMatchObject({ figureStep: 2, objectVariant: 2 });

    // On air, with the viewer looking at it, it stays put.
    await page.waitForTimeout(2500);
    expect(await step(page)).toBe(2);

    // Act 2 in a later session is as close as it comes for now: step 3.
    await page.getByRole('button', { name: /channel up/i }).click();
    await expect.poll(() => step(page)).toBe(3);
    await page.getByRole('button', { name: /channel up/i }).click();
    await page.waitForFunction(() => (window as unknown as Win).__tv!.phase() === 'ON_AIR', undefined, { timeout: 15000 });
    expect(await step(page)).toBe(3);
  });

  test('the lights dip while it moves, and not for a viewer who asked for less motion', async ({ page, browser }) => {
    await open(page, memory({ act: 1 }));
    await page.evaluate(() => {
      const w = window as unknown as Win & { __lowest?: number };
      w.__lowest = 1;
      setInterval(() => (w.__lowest = Math.min(w.__lowest!, w.__room!.level())), 10);
    });
    await page.getByRole('button', { name: /^power$/i }).click();
    await expect.poll(() => step(page)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __lowest: number }).__lowest)).toBeLessThan(0.5);

    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const calm = await context.newPage();
    await open(calm, memory({ act: 1 }));
    await calm.evaluate(() => {
      const w = window as unknown as Win & { __lowest?: number };
      w.__lowest = 1;
      setInterval(() => (w.__lowest = Math.min(w.__lowest!, w.__room!.level())), 10);
    });
    await calm.getByRole('button', { name: /^power$/i }).click();
    await expect.poll(() => step(calm)).toBe(1);
    expect(await calm.evaluate(() => (window as unknown as { __lowest: number }).__lowest)).toBe(1);
    await context.close();
  });

  test('a hidden tab counts as not looking', async ({ page }) => {
    await open(page, memory({ act: 1 }));
    await page.waitForTimeout(500);
    expect(await step(page)).toBe(0);
    const setVisibility = (state: string) =>
      page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);
    await setVisibility('hidden');
    expect(await step(page)).toBe(0);
    await setVisibility('visible');
    await expect.poll(() => step(page)).toBe(1);
    expect(await storedRoom(page)).toMatchObject({ figureStep: 1 });
  });

  test('the shadow is really on the wall, darker the closer it stands', async ({ page, browser }) => {
    const shot = async (p: Page, figureStep: number): Promise<number> => {
      await open(p, memory({ act: 0 }, { figureStep }));
      await p.waitForTimeout(1200);
      expect(await step(p)).toBe(figureStep);
      return rightBand(p);
    };
    const none = await shot(page, 0);
    const context = await browser.newContext();
    const far = await shot(await context.newPage(), 1);
    const near = await shot(await context.newPage(), 5);
    await context.close();
    expect(far).toBeLessThan(none);
    expect(near).toBeLessThan(far);
  });

  test('Forget me sends it away', async ({ page }) => {
    await open(page, memory({ act: 3 }, { figureStep: 3, objectVariant: 2 }));
    await page.getByRole('button', { name: /^forget me$/i }).click();
    await page.getByRole('button', { name: /confirm forget me/i }).click();
    await expect.poll(() => step(page)).toBe(0);
    expect(await variant(page)).toBe(0);
  });
});

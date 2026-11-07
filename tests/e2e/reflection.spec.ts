import { expect, test, type Page } from '@playwright/test';

/**
 * Task 12: the reflection, with Chromium's fake camera only (design §10). A real
 * camera is never contacted. Whatever the tests measure in the glass is real pixels.
 */

test.use({
  launchOptions: {
    args: [
      ...(process.env.PW_GPU ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] : []),
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
});

interface Win {
  __crt: { reflectionStats: () => { hasVideo: boolean; level: number; shadow: boolean } };
  __tv: {
    phase: () => string;
    forceSurface: (s: 'canvas' | 'youtube') => void;
    forceStartle: (id: string) => string | null;
  };
  __gum: number;
  __streams: MediaStream[];
}

function memory(extra: Record<string, unknown> = {}): Record<string, unknown> {
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
    settings: { volume: 1, muted: true, captions: true, reducedEffects: false },
    room: { strokes: [], figureStep: 0, objectVariant: 0, ripBackDone: false },
    ...extra,
  };
}

/** Refuse the camera with this error, instead of the fake device. */
async function open(page: Page, seed = memory(), refuse?: string): Promise<void> {
  await page.addInitScript(
    ([m, refusal]) => {
      (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('deadair.memory.v1', JSON.stringify(m));
        sessionStorage.setItem('seeded', '1');
      }
      const w = window as unknown as Win;
      w.__gum = 0;
      w.__streams = [];
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => {
        w.__gum += 1;
        if (refusal) {
          const e = new Error('refused');
          e.name = refusal as string;
          throw e;
        }
        const s = await real(c);
        w.__streams.push(s);
        return s;
      };
    },
    [seed, refuse ?? null] as const,
  );
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as Win).__crt && (window as unknown as Win).__tv);
}

const control = (page: Page) => page.getByRole('button', { name: /let it see you|look away/i });
const lamp = (page: Page) => page.getByTestId('refl-lamp');
const stats = (page: Page) => page.evaluate(() => (window as unknown as Win).__crt.reflectionStats());
const asks = (page: Page) => page.evaluate(() => (window as unknown as Win).__gum);
const live = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);

async function switchOn(page: Page): Promise<void> {
  await control(page).click();
  await expect(lamp(page)).toHaveAttribute('data-lit', 'true');
}

/** How bright the tube is, and how far off grey, averaged. */
function glass(page: Page): Promise<{ mean: number; colour: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="tube-opening"] canvas')!;
    const gl = canvas.getContext('webgl2')!;
    const px = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    let colour = 0;
    for (let i = 0; i < px.length; i += 4) {
      sum += (px[i]! + px[i + 1]! + px[i + 2]!) / 3;
      colour += Math.abs(px[i]! - px[i + 1]!) + Math.abs(px[i + 1]! - px[i + 2]!);
    }
    const n = px.length / 4;
    return { mean: sum / n, colour: colour / n };
  });
}

test.describe('the reflection', () => {
  test('no camera on load, and the control says so before any prompt', async ({ page }) => {
    await open(page);
    await page.waitForTimeout(800);
    expect(await asks(page)).toBe(0);
    await expect(lamp(page)).toHaveAttribute('data-lit', 'false');
    await expect(page.getByText(/Stays on this device\. Nothing is recorded or sent\./)).toBeVisible();
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'ON_AIR', undefined, { timeout: 15000 });
    expect(await asks(page)).toBe(0);
  });

  test('in the dark glass: faint, grey and gone when switched off', async ({ page }) => {
    await open(page);
    await page.waitForTimeout(400);
    const before = await glass(page);
    expect(before.mean).toBeLessThan(0.5);

    await switchOn(page);
    expect(await asks(page)).toBe(1);
    await page.waitForFunction(() => (window as unknown as Win).__crt.reflectionStats().level > 0.9);
    await page.waitForTimeout(600);
    const on = await glass(page);
    expect(on.mean).toBeGreaterThan(before.mean + 2);
    // Low: nothing near a picture. Grey: the fake camera's colours are gone.
    expect(on.mean).toBeLessThan(38);
    expect(on.colour).toBeLessThan(1);

    await control(page).click();
    await expect(lamp(page)).toHaveAttribute('data-lit', 'false');
    expect(await live(page)).toBe(0);
    await page.waitForTimeout(200);
    expect((await glass(page)).mean).toBeLessThan(0.5);
  });

  test('power does not touch the camera, and the picture covers the reflection', async ({ page }) => {
    await open(page);
    await switchOn(page);
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'ON_AIR', undefined, { timeout: 15000 });
    await expect.poll(async () => (await stats(page)).level).toBeLessThan(0.02);
    expect(await live(page)).toBe(1);
    await expect(lamp(page)).toHaveAttribute('data-lit', 'true');

    // Off again, and it is there once the shutdown has finished.
    await page.getByRole('button', { name: /^power$/i }).click();
    await expect.poll(async () => (await stats(page)).level).toBeGreaterThan(0.9);
    expect(await live(page)).toBe(1);
  });

  test('during a scripted silence on our own picture, and not on a YouTube surface', async ({ page }) => {
    await open(page, memory({ act: 1, lastChannel: 4 }));
    await switchOn(page);
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'ON_AIR', undefined, { timeout: 15000 });
    await expect.poll(async () => (await stats(page)).level).toBeLessThan(0.02);

    // E03 is silence, then a line.
    await page.waitForFunction(() => (window as unknown as Win).__tv.forceStartle('E03') !== null);
    await expect.poll(async () => (await stats(page)).level, { timeout: 4000 }).toBeGreaterThan(0.3);
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'ON_AIR', undefined, { timeout: 15000 });
    await expect.poll(async () => (await stats(page)).level).toBeLessThan(0.02);

    await page.evaluate(() => (window as unknown as Win).__tv.forceSurface('youtube'));
    await page.waitForFunction(() => (window as unknown as Win).__tv.forceStartle('E03') !== null);
    await page.waitForTimeout(500);
    expect((await stats(page)).level).toBeLessThan(0.02);
  });

  test('never over the sign-off', async ({ page }) => {
    await open(page, memory({ act: 3, lastChannel: 13 }));
    await switchOn(page);
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'SIGN_OFF', undefined, { timeout: 15000 });
    await expect.poll(async () => (await stats(page)).level).toBeLessThan(0.02);
  });

  test('Forget me stops the camera', async ({ page }) => {
    await open(page);
    await switchOn(page);
    await page.getByRole('button', { name: /^forget me$/i }).click();
    await page.getByRole('button', { name: /confirm forget me/i }).click();
    await expect(lamp(page)).toHaveAttribute('data-lit', 'false');
    expect(await live(page)).toBe(0);
    expect((await stats(page)).hasVideo).toBe(false);
  });

  test('a hidden tab stops it, and only the viewer starts it again', async ({ page }) => {
    await open(page);
    await switchOn(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(lamp(page)).toHaveAttribute('data-lit', 'false');
    expect(await live(page)).toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);
    expect(await asks(page)).toBe(1);
    await switchOn(page);
    expect(await asks(page)).toBe(2);
  });

  test('the choice does not survive a reload', async ({ page }) => {
    await open(page);
    await switchOn(page);
    await page.reload();
    await page.waitForFunction(() => (window as unknown as Win).__crt);
    await page.waitForTimeout(500);
    expect(await asks(page)).toBe(0);
    await expect(lamp(page)).toHaveAttribute('data-lit', 'false');
  });

  test('denied, or no camera: back to off with a short message, and nothing else', async ({ page, browser }) => {
    await open(page, memory(), 'NotAllowedError');
    await control(page).click();
    await expect(page.getByText('Camera permission was denied.')).toBeVisible();
    await expect(lamp(page)).toHaveAttribute('data-lit', 'false');
    expect((await stats(page)).hasVideo).toBe(false);

    const context = await browser.newContext();
    const other = await context.newPage();
    await open(other, memory(), 'NotFoundError');
    await control(other).click();
    await expect(other.getByText('No camera was found.')).toBeVisible();
    await context.close();
  });

  test('a small window can still reach the control and its words', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page);
    await control(page).scrollIntoViewIfNeeded();
    await expect(control(page)).toBeInViewport();
    await switchOn(page);
    const forget = page.getByRole('button', { name: /^forget me$/i });
    await forget.scrollIntoViewIfNeeded();
    await expect(forget).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollLeft)).toBe(0);
  });

  test('from Act 3 there is a fixed shadow in it', async ({ page, browser }) => {
    await open(page, memory({ act: 2 }));
    await switchOn(page);
    expect((await stats(page)).shadow).toBe(false);
    const context = await browser.newContext();
    const other = await context.newPage();
    await open(other, memory({ act: 3 }));
    await switchOn(other);
    expect((await stats(other)).shadow).toBe(true);
    await context.close();
  });
});

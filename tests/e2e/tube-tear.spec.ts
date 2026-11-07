import { expect, test, type Page } from '@playwright/test';

/**
 * Task 9: the picture tears, inside the CRT pipeline, and only ever on our own
 * sources (requirement 2). Real WebGL: what the tests measure is on the canvas.
 */

interface CrtSeam {
  tubeStats: () => { enabled: boolean; active: boolean; broken: number; behindImage: boolean };
}
interface TvSeam {
  phase: () => string;
  channel: () => number | null;
  lastEventText: () => string;
  forceSurface: (surface: 'canvas' | 'youtube') => void;
  tubeTearable: () => boolean;
}
type Win = { __crt: CrtSeam; __tv: TvSeam; __tubeListeners: number };

const stats = (page: Page) => page.evaluate(() => (window as unknown as Win).__crt.tubeStats());

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

async function onAir(page: Page, stored = memory()): Promise<void> {
  await page.addInitScript((m) => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    localStorage.setItem('deadair.memory.v1', JSON.stringify(m));
    // Count every pointer listener put on the tube's canvas, whoever adds it.
    const w = window as unknown as Win;
    w.__tubeListeners = 0;
    const add = HTMLCanvasElement.prototype.addEventListener;
    const remove = HTMLCanvasElement.prototype.removeEventListener;
    const isTube = (el: HTMLCanvasElement): boolean => el.dataset.testid !== 'room-canvas';
    HTMLCanvasElement.prototype.addEventListener = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith('pointer') && isTube(this)) w.__tubeListeners += 1;
      return (add as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof add;
    HTMLCanvasElement.prototype.removeEventListener = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith('pointer') && isTube(this)) w.__tubeListeners -= 1;
      return (remove as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof remove;
  }, stored);
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as Win).__crt && (window as unknown as Win).__tv);
  await page.getByRole('button', { name: /^power$/i }).click();
  await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'ON_AIR', undefined, { timeout: 15000 });
  await page.waitForFunction(() => (window as unknown as Win).__tv.tubeTearable());
  await page.waitForTimeout(600);
}

async function dragAcross(page: Page): Promise<void> {
  const box = (await page.locator('[data-testid="tube-opening"]').boundingBox())!;
  const x = box.x + box.width * 0.5;
  const y0 = box.y + box.height * 0.25;
  const y1 = box.y + box.height * 0.75;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) {
    await page.mouse.move(x + Math.sin(i / 3) * 8, y0 + ((y1 - y0) * i) / 20);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/** The tube canvas along the middle of the drag, as a grid of brightnesses. */
function tubeStrip(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="tube-opening"] canvas')!;
    const gl = canvas.getContext('webgl2')!;
    const w = Math.floor(canvas.width * 0.2);
    const h = Math.floor(canvas.height * 0.4);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(Math.floor(canvas.width * 0.4), Math.floor(canvas.height * 0.3), w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const out: number[] = [];
    for (let i = 0; i < px.length; i += 4) out.push(px[i]! + px[i + 1]! + px[i + 2]!);
    return out;
  });
}

test.describe('tearing the picture', () => {
  test('a drag opens a hole in the picture, on the canvas itself', async ({ page }) => {
    await onAir(page);
    expect(await stats(page)).toMatchObject({ enabled: true, active: false, broken: 0 });
    await dragAcross(page);
    await page.waitForTimeout(500);
    const s = await stats(page);
    expect(s.active).toBe(true);
    expect(s.broken).toBeGreaterThan(10);

    // The programme keeps moving, so look for what a hole is: a band that stays
    // dark across frames where the picture around it does not.
    const a = await tubeStrip(page);
    await page.waitForTimeout(700);
    const b = await tubeStrip(page);
    let darkBoth = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i]! < 110 && b[i]! < 110) darkBoth += 1;
    expect(darkBoth).toBeGreaterThan(200);
  });

  test('a tune mends it through the static, and the broadcast clock never noticed', async ({ page }) => {
    await onAir(page);
    await dragAcross(page);
    expect((await stats(page)).broken).toBeGreaterThan(0);
    const position = () =>
      page.evaluate(() => (window as unknown as { __tv: { broadcastPositionMs: () => number | null } }).__tv.broadcastPositionMs());
    const before = await position();
    await page.getByRole('button', { name: /channel up/i }).click();
    await expect.poll(async () => (await stats(page)).broken).toBe(0);
    expect((await stats(page)).active).toBe(false);
    expect(await position()).not.toBeNull();
    expect(before).not.toBeNull();
  });

  test('a YouTube surface has no tear and no pointer handler', async ({ page }) => {
    await onAir(page);
    expect(await page.evaluate(() => (window as unknown as Win).__tubeListeners)).toBeGreaterThan(0);

    await page.evaluate(() => (window as unknown as Win).__tv.forceSurface('youtube'));
    await page.waitForFunction(() => !(window as unknown as Win).__tv.tubeTearable());
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).__tubeListeners)).toBe(0);
    expect((await stats(page)).enabled).toBe(false);
    await dragAcross(page);
    await page.waitForTimeout(200);
    expect(await stats(page)).toMatchObject({ active: false, broken: 0 });

    // Back on our own picture, it tears again.
    await page.evaluate(() => (window as unknown as Win).__tv.forceSurface('canvas'));
    await page.waitForFunction(() => (window as unknown as Win).__tv.tubeTearable());
    await dragAcross(page);
    expect((await stats(page)).broken).toBeGreaterThan(0);
  });

  test('no tube tear while an event is on the screen', async ({ page }) => {
    await onAir(page);
    await dragAcross(page);
    expect((await stats(page)).broken).toBeGreaterThan(0);
    await page.evaluate(() => (window as unknown as { __tv: { forceStartle: (id: string) => string | null } }).__tv.forceStartle('E08'));
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'EVENT', undefined, { timeout: 5000 });
    await expect.poll(async () => (await stats(page)).enabled).toBe(false);
    expect(await stats(page)).toMatchObject({ active: false, broken: 0 });
    await dragAcross(page);
    expect((await stats(page)).broken).toBe(0);
  });

  test('the sign-off cannot be damaged', async ({ page }) => {
    await onAir(page, memory({ act: 3, lastChannel: 7 }));
    await dragAcross(page);
    expect((await stats(page)).broken).toBeGreaterThan(0);
    // Channel 13 in Act 3 is the sign-off.
    await page.getByRole('button', { name: /channel up/i }).click();
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'SIGN_OFF', undefined, { timeout: 15000 });
    await expect.poll(async () => (await stats(page)).enabled).toBe(false);
    expect((await stats(page)).broken).toBe(0);
    await dragAcross(page);
    expect((await stats(page)).broken).toBe(0);
  });

  test('channel 13 from Act 2 has the viewer\'s own wall behind its picture', async ({ page }) => {
    await onAir(page, memory({ act: 2, lastChannel: 13 }));
    expect(await page.evaluate(() => (window as unknown as Win).__tv.channel())).toBe(13);
    expect((await stats(page)).behindImage).toBe(true);
    await page.getByRole('button', { name: /channel up/i }).click();
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'ON_AIR');
    await expect.poll(async () => (await stats(page)).behindImage).toBe(false);
  });

  test('the fallback renderer takes tube calls without doing anything', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __CRT_FORCE_FALLBACK__?: boolean }).__CRT_FORCE_FALLBACK__ = true;
    });
    await onAir(page);
    await dragAcross(page);
    expect(await page.evaluate(() => (window as unknown as Win).__tv.phase())).toBe('ON_AIR');
    expect(await stats(page)).toMatchObject({ enabled: false, active: false, broken: 0 });
  });
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Task 7: damage remembers (requirement 4), on real WebGL. Holes are measured by
 * painting everything behind the paper magenta, so these cannot pass on state.
 */

interface RoomSeam {
  strokes: () => number;
  broken: () => number;
  repaired: () => number;
  ripSeeded: () => void;
  showHoleMask: (on: boolean) => void;
}

const seam = <T,>(page: Page, fn: (r: RoomSeam) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__room)`) as Promise<T>;

const STROKE = (session: number, seed = 11) => ({
  seed,
  session,
  points: [[0.08, 0.2], [0.09, 0.32], [0.08, 0.44], [0.09, 0.56], [0.08, 0.68], [0.09, 0.8]],
});

function memory(extra: Record<string, unknown>): Record<string, unknown> {
  const ch = () => ({ visits: 1, watchMs: 0, lastVisitedAt: 1 });
  const now = Date.now();
  return {
    schemaVersion: 2,
    firstSeenAt: now - 3600000,
    // Recent, so loading does not count as another new session.
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
    room: { strokes: [], figureStep: 0, objectVariant: 0, ripBackDone: false },
    ...extra,
  };
}

async function open(page: Page, stored: Record<string, unknown> | null): Promise<void> {
  await page.addInitScript((m) => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    // Only the first load is seeded, so a reload reads what the app itself wrote.
    if (m && !sessionStorage.getItem('seeded')) {
      localStorage.setItem('deadair.memory.v1', JSON.stringify(m));
      sessionStorage.setItem('seeded', '1');
    }
  }, stored);
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __room?: unknown }).__room);
}

/** Pixels showing what is behind the wall right now. */
function holePixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const room = (window as unknown as { __room: RoomSeam }).__room;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="room-canvas"]')!;
    const gl = canvas.getContext('webgl2')!;
    room.showHoleMask(true);
    const px = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    room.showHoleMask(false);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! > 200 && px[i + 1]! < 60 && px[i + 2]! > 200) n += 1;
    return n;
  });
}

const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('deadair.memory.v1') ?? 'null') as { schemaVersion: number; room?: { strokes: unknown[] } } | null);

test.describe('damage remembers', () => {
  test('a tear is still there after a reload', async ({ page }) => {
    await open(page, memory({}));
    expect(await holePixels(page)).toBe(0);

    const chassis = await page.locator('[class*="chassis"]').first().boundingBox();
    const x = Math.round((chassis?.x ?? 200) / 2);
    await page.mouse.move(x, 220);
    await page.mouse.down();
    for (let i = 1; i <= 16; i += 1) {
      await page.mouse.move(x, 220 + i * 20);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
    const before = await holePixels(page);
    expect(before).toBeGreaterThan(500);
    expect((await stored(page))?.room?.strokes).toHaveLength(1);

    await page.reload();
    await page.waitForFunction(() => (window as unknown as { __room?: RoomSeam }).__room?.strokes() === 1);
    await page.waitForTimeout(1200);
    expect(await seam(page, (r) => r.broken())).toBeGreaterThan(0);
    expect(await holePixels(page)).toBeGreaterThan(before * 0.3);
  });

  test('earlier tears come back mended in a new session from Act 2, and the wall is whole', async ({ page }) => {
    await open(page, memory({ act: 2, sessionCount: 2, room: { strokes: [STROKE(1)], figureStep: 0, objectVariant: 0, ripBackDone: false } }));
    await page.waitForFunction(() => (window as unknown as { __room?: RoomSeam }).__room?.repaired() === 1);
    expect(await seam(page, (r) => r.broken())).toBe(0);
    expect(await holePixels(page)).toBe(0);
  });

  test('this session\'s tear stays open beside a mended one', async ({ page }) => {
    await open(page, memory({ act: 2, sessionCount: 2, room: { strokes: [STROKE(1), STROKE(2, 12)], figureStep: 0, objectVariant: 0, ripBackDone: false } }));
    await page.waitForFunction(() => (window as unknown as { __room?: RoomSeam }).__room?.repaired() === 1);
    expect(await seam(page, (r) => r.strokes())).toBe(1);
    expect(await seam(page, (r) => r.broken())).toBeGreaterThan(0);
  });

  test('before Act 2, an earlier tear is simply still open', async ({ page }) => {
    // One channel seen: a second session with two would reach Act 2 on load.
    const unseen = { visits: 0, watchMs: 0, lastVisitedAt: null };
    await open(page, memory({
      act: 1,
      sessionCount: 2,
      channels: { 2: { visits: 1, watchMs: 0, lastVisitedAt: 1 }, 4: unseen, 7: unseen, 13: unseen },
      room: { strokes: [STROKE(1)], figureStep: 0, objectVariant: 0, ripBackDone: false },
    }));
    await page.waitForFunction(() => (window as unknown as { __room?: RoomSeam }).__room?.strokes() === 1);
    expect(await seam(page, (r) => r.repaired())).toBe(0);
    await page.waitForTimeout(800);
    expect(await holePixels(page)).toBeGreaterThan(200);
  });

  test('a version 1 memory is migrated, and loses nothing', async ({ page }) => {
    const v1 = memory({ schemaVersion: 1, totalWatchMs: 4242, firedEvents: { E02: { count: 1, lastAt: 5 } } });
    delete v1.room;
    await open(page, v1);
    await expect.poll(async () => (await stored(page))?.schemaVersion, { timeout: 5000 }).toBe(2);
    const m = (await stored(page)) as unknown as { totalWatchMs: number; firedEvents: unknown; room: { strokes: unknown[] } };
    expect(m.totalWatchMs).toBeGreaterThanOrEqual(4242);
    expect(m.firedEvents).toEqual({ E02: { count: 1, lastAt: 5 } });
    expect(m.room.strokes).toEqual([]);
  });

  test('Forget me mends the wall and erases every tear', async ({ page }) => {
    await open(page, memory({ act: 1, room: { strokes: [STROKE(1)], figureStep: 0, objectVariant: 0, ripBackDone: false } }));
    await page.waitForFunction(() => (window as unknown as { __room?: RoomSeam }).__room?.strokes() === 1);
    await page.waitForTimeout(600);
    expect(await holePixels(page)).toBeGreaterThan(200);

    await page.getByRole('button', { name: /^forget me$/i }).click();
    await page.getByRole('button', { name: /confirm forget me/i }).click();
    await page.waitForFunction(() => (window as unknown as { __room?: RoomSeam }).__room?.strokes() === 0);
    expect(await seam(page, (r) => r.broken())).toBe(0);
    await page.waitForTimeout(300);
    expect(await holePixels(page)).toBe(0);
    expect(await stored(page)).toBeNull();
  });

  test('the T key tear is remembered too', async ({ page }) => {
    await open(page, memory({}));
    await page.keyboard.press('t');
    await expect.poll(async () => (await stored(page))?.room?.strokes.length, { timeout: 3000 }).toBe(1);
  });
});

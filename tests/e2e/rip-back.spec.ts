import { expect, test, type Page } from '@playwright/test';

/**
 * Task 10: E13, it rips back (requirement 6). The whole event runs in real time
 * on real WebGL, so each of these takes the event's own length.
 */

interface RoomSeam {
  strokes: () => number;
  broken: () => number;
  level: () => number;
  lift: () => number;
  pushing: () => boolean;
  repaired: () => number;
}
interface TvSeam {
  phase: () => string;
  channel: () => number | null;
  firedEvents: () => string[];
  roomEventRunning: () => boolean;
  lastEventText: () => string;
}
type Win = { __room: RoomSeam; __tv: TvSeam; __lowest?: number; __highestLift?: number };
type Stored = { firedEvents: Record<string, { count: number }>; room: { ripBackDone: boolean; strokes: Array<{ seed: number }> } };

const ROOM = (page: Page) => page.evaluate(() => {
  const r = (window as unknown as Win).__room;
  return { strokes: r.strokes(), broken: r.broken(), level: r.level(), lift: r.lift(), pushing: r.pushing(), repaired: r.repaired() };
});
const TV = (page: Page) => page.evaluate(() => {
  const t = (window as unknown as Win).__tv;
  return { phase: t.phase(), channel: t.channel(), fired: t.firedEvents(), running: t.roomEventRunning(), text: t.lastEventText() };
});
const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('deadair.memory.v1') ?? 'null') as Stored | null);

function memory(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const ch = () => ({ visits: 1, watchMs: 0, lastVisitedAt: 1 });
  const now = Date.now();
  return {
    schemaVersion: 2,
    firstSeenAt: now - 3600000,
    lastSeenAt: now - 1000,
    sessionCount: 1,
    totalWatchMs: 300000,
    channels: { 2: ch(), 4: ch(), 7: ch(), 13: ch() },
    visitOrder: [13, 2],
    lastChannel: 2,
    firedEvents: { E05: { count: 1, lastAt: 1 }, E07: { count: 1, lastAt: 1 } },
    act: 3,
    noticeSeen: true,
    settings: { volume: 1, muted: true, captions: true, reducedEffects: false },
    room: { strokes: [], figureStep: 0, objectVariant: 0, ripBackDone: false },
    ...extra,
  };
}

async function open(page: Page, seed: Record<string, unknown>): Promise<void> {
  await page.addInitScript((m) => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('deadair.memory.v1', JSON.stringify(m));
      sessionStorage.setItem('seeded', '1');
    }
  }, seed);
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as Win).__room && (window as unknown as Win).__tv);
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__lowest = 1;
    w.__highestLift = 0;
    setInterval(() => {
      w.__lowest = Math.min(w.__lowest!, w.__room.level());
      w.__highestLift = Math.max(w.__highestLift!, w.__room.lift());
    }, 20);
  });
}

const power = (page: Page) => page.getByRole('button', { name: /^power$/i }).click();
const up = (page: Page) => page.getByRole('button', { name: /channel up/i }).click();
const running = (page: Page) => page.waitForFunction(() => (window as unknown as Win).__tv.roomEventRunning(), undefined, { timeout: 15000 });
const finished = (page: Page) =>
  page.waitForFunction(() => !(window as unknown as Win).__tv.roomEventRunning(), undefined, { timeout: 20000 });
const pushing = (page: Page) => page.waitForFunction(() => (window as unknown as Win).__room.pushing(), undefined, { timeout: 10000 });

test.describe('it rips back', () => {
  test.setTimeout(60000);

  test('the wall is pushed and torn, the programme carries on, and it happens once', async ({ page }) => {
    await open(page, memory());
    await power(page);
    await running(page);
    // Nothing on the tube has been replaced by this.
    expect((await TV(page)).phase).toBe('ON_AIR');
    expect((await ROOM(page)).broken).toBe(0);

    await pushing(page);
    expect((await TV(page)).phase).toBe('ON_AIR');
    expect((await ROOM(page)).broken).toBe(0);
    await page.waitForFunction(() => (window as unknown as Win).__room.broken() > 0, undefined, { timeout: 10000 });
    await finished(page);

    const room = await ROOM(page);
    expect(room.strokes).toBe(1);
    expect(room.broken).toBeGreaterThan(20);
    const seen = await page.evaluate(() => ({ low: (window as unknown as Win).__lowest!, lift: (window as unknown as Win).__highestLift! }));
    expect(seen.low).toBeLessThan(0.15);
    expect(seen.lift).toBeGreaterThan(2);
    const tv = await TV(page);
    expect(tv.phase).toBe('ON_AIR');
    expect(tv.channel).toBe(2);
    expect(tv.text).toBe('');
    await expect.poll(async () => (await ROOM(page)).level).toBeGreaterThan(0.95);

    const m = await stored(page);
    expect(m?.firedEvents.E13?.count).toBe(1);
    expect(m?.room.ripBackDone).toBe(true);
    expect(m?.room.strokes.map((s) => s.seed)).toEqual([-1]);

    // Never again.
    await up(page);
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'ON_AIR', undefined, { timeout: 15000 });
    await page.waitForTimeout(500);
    expect((await TV(page)).running).toBe(false);
    expect((await stored(page))?.firedEvents.E13?.count).toBe(1);
  });

  test('changing channel before the rip stops it clean, and it comes again', async ({ page }) => {
    await open(page, memory());
    await power(page);
    await pushing(page);
    await up(page);
    await expect.poll(async () => (await ROOM(page)).pushing).toBe(false);
    expect((await ROOM(page)).broken).toBe(0);
    expect((await stored(page))?.room.ripBackDone).toBe(false);
    expect((await stored(page))?.firedEvents.E13).toBeUndefined();
    // It landed on another of its channels, so the new tune starts it over.
    await pushing(page);
    await page.waitForFunction(() => (window as unknown as Win).__room.broken() > 0, undefined, { timeout: 10000 });
    await finished(page);
    expect((await stored(page))?.firedEvents.E13?.count).toBe(1);
    expect((await ROOM(page)).strokes).toBe(1);
  });

  test('power off during the rip leaves the tear whole and the lights up', async ({ page }) => {
    await open(page, memory());
    await power(page);
    await page.waitForFunction(() => (window as unknown as Win).__room.broken() > 0, undefined, { timeout: 15000 });
    await power(page);
    await expect.poll(async () => (await stored(page))?.room.ripBackDone, { timeout: 3000 }).toBe(true);
    expect((await ROOM(page)).strokes).toBe(1);
    await expect.poll(async () => (await ROOM(page)).level, { timeout: 4000 }).toBeGreaterThan(0.95);
    expect((await TV(page)).phase).toBe('OFF');
  });

  test('reduced motion gets a blackout, then the wall already torn', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await open(page, memory());
    await power(page);
    await running(page);
    await page.waitForFunction(() => (window as unknown as Win).__room.broken() > 0, undefined, { timeout: 15000 });
    const at = await page.evaluate(() => ({ low: (window as unknown as Win).__lowest!, lift: (window as unknown as Win).__highestLift! }));
    expect(at.low).toBeLessThan(0.05);
    expect(at.lift).toBe(0);
    await finished(page);
    expect((await stored(page))?.room.ripBackDone).toBe(true);
    await context.close();
  });

  test('the sign-off is reachable without it', async ({ page }) => {
    await open(page, memory({ lastChannel: 7, firedEvents: {} }));
    await power(page);
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'ON_AIR', undefined, { timeout: 15000 });
    await up(page);
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'SIGN_OFF', undefined, { timeout: 15000 });
  });

  test('the tear is there after a reload, and a later session does not mend it', async ({ page, browser }) => {
    await open(page, memory());
    await power(page);
    await running(page);
    await page.waitForFunction(() => (window as unknown as Win).__room.broken() > 0, undefined, { timeout: 15000 });
    await finished(page);
    await page.reload();
    await page.waitForFunction(() => (window as unknown as Win).__room?.strokes() === 1);
    expect((await ROOM(page)).broken).toBeGreaterThan(0);
    expect((await TV(page)).running).toBe(false);

    const later = await browser.newContext();
    const next = await later.newPage();
    const m = await stored(page);
    await open(next, { ...memory(), ...m, sessionCount: 2, lastSeenAt: Date.now() - 1000 });
    await next.waitForFunction(() => (window as unknown as Win).__room.strokes() === 1);
    expect((await ROOM(next)).repaired).toBe(0);
    expect((await ROOM(next)).broken).toBeGreaterThan(0);
    await later.close();
  });

  test('after hours without it, the wall is torn anyway and nothing is pending', async ({ page }) => {
    await open(page, memory({ act: 4 }));
    await page.waitForFunction(() => (window as unknown as Win).__room.strokes() === 1);
    expect((await ROOM(page)).broken).toBeGreaterThan(0);
    await power(page);
    await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'ON_AIR', undefined, { timeout: 15000 });
    await page.waitForTimeout(500);
    expect((await TV(page)).running).toBe(false);
  });
});

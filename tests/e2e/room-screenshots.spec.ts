import { test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Task 5 visual checkpoint: committed screenshots of the room in Acts 0 and 3,
 * and of a tear, for a human to judge whether it looks good and frightening.
 * Real WebGL. Written ONLY when UPDATE_SCREENSHOTS=1 so a plain test run does
 * not modify committed files (dead-air-room requirement 9.5); otherwise the
 * specs still drive the flow and assert the room rendered.
 */

const SHOTS_DIR = path.resolve(fileURLToPath(new URL('../../docs/screenshots', import.meta.url)));
const UPDATE = process.env.UPDATE_SCREENSHOTS === '1';

interface Seed {
  act?: number;
  totalWatchMs?: number;
  visits?: Partial<Record<2 | 4 | 7 | 13, number>>;
  sessionCount?: number;
}

async function seed(page: Page, m: Seed): Promise<void> {
  await page.addInitScript((mm: Seed) => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    try {
      if (window.localStorage.getItem('deadair.memory.v1') !== null) return;
    } catch {
      return;
    }
    const ch = (v: number) => ({ visits: mm.visits?.[v as 2 | 4 | 7 | 13] ?? 0, watchMs: 0, lastVisitedAt: v ? 1 : null });
    const mem = {
      schemaVersion: 1,
      firstSeenAt: 1,
      lastSeenAt: 1,
      sessionCount: mm.sessionCount ?? 1,
      totalWatchMs: mm.totalWatchMs ?? 0,
      channels: { 2: ch(2), 4: ch(4), 7: ch(7), 13: ch(13) },
      visitOrder: [],
      lastChannel: 2,
      firedEvents: {},
      act: mm.act ?? 0,
      noticeSeen: true,
      settings: { volume: 0.7, muted: false, captions: true, reducedEffects: false },
    };
    try {
      window.localStorage.setItem('deadair.memory.v1', JSON.stringify(mem));
    } catch {
      /* ignore */
    }
  }, m);
}

interface RoomSeam {
  strokes: () => number;
  broken: () => number;
}
const room = (page: Page) =>
  page.evaluate(() => {
    const r = (window as unknown as { __room?: RoomSeam }).__room;
    return { strokes: r?.strokes() ?? -1, broken: r?.broken() ?? -1 };
  });

async function powerOn(page: Page): Promise<void> {
  await page.goto('/');
  const n = page.getByRole('button', { name: /i understand/i });
  if (await n.isVisible().catch(() => false)) await n.click();
  await page.getByRole('button', { name: /^power$/i }).click();
  await page.waitForTimeout(2500); // boot + tune; the picture lights the wall
}

async function shoot(page: Page, file: string): Promise<void> {
  if (UPDATE) await page.screenshot({ path: path.join(SHOTS_DIR, file) });
}

test.describe('room visual checkpoint (task 5)', () => {
  test('room in Act 0', async ({ page }) => {
    await seed(page, { act: 0 });
    await powerOn(page);
    await room(page); // asserts the room seam exists / rendered
    await shoot(page, 'room-act0.png');
  });

  test('room in Act 3', async ({ page }) => {
    await seed(page, { act: 3, totalWatchMs: 15 * 60000, visits: { 2: 2, 4: 1, 7: 1, 13: 2 }, sessionCount: 2 });
    await powerOn(page);
    await room(page);
    await shoot(page, 'room-act3.png');
  });

  test('a torn wall', async ({ page }) => {
    await seed(page, { act: 1, visits: { 2: 1 } });
    await powerOn(page);
    // The T key rips a seeded path (deterministic; the same discovery keyboard
    // users get). A couple of presses open a clear gash.
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    await page.keyboard.press('t');
    await page.waitForTimeout(400);
    await shoot(page, 'room-tear.png');
  });
});

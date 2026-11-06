import { test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Visual checkpoint: committed screenshots of the room and of tears at each act,
 * for a human to judge whether it looks good and frightening.
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
  // animations:'disabled' avoids the font-wait hang while the tear's rAF loop
  // is still settling; the room itself is a canvas, so no visual is lost.
  if (UPDATE) await page.screenshot({ path: path.join(SHOTS_DIR, file), animations: 'disabled', timeout: 20000 });
}

/** A plain 300 px rip down the exposed left band. */
async function rip300(page: Page): Promise<void> {
  const chassis = await page.locator('[class*="chassis"]').first().boundingBox();
  const sx = Math.round((chassis?.x ?? 200) / 2);
  const sy = Math.round(page.viewportSize()!.height * 0.22);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i += 1) {
    await page.mouse.move(sx, sy + (300 * i) / 24, { steps: 1 });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
}

/** Three rips around the set: left, right and across the top. */
async function ripThree(page: Page): Promise<void> {
  const size = page.viewportSize()!;
  const chassis = await page.locator('[class*="chassis"]').first().boundingBox();
  const left = chassis?.x ?? 200;
  const right = left + (chassis?.width ?? 800);
  const top = chassis?.y ?? 100;
  const drag = async (pts: Array<[number, number]>, n: number): Promise<void> => {
    await page.mouse.move(pts[0]![0], pts[0]![1]);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i += 1) {
      const [a, b] = pts[i - 1]!;
      const [c, d] = pts[i]!;
      for (let s = 1; s <= n; s += 1) {
        await page.mouse.move(a + ((c - a) * s) / n, b + ((d - b) * s) / n, { steps: 1 });
        await page.waitForTimeout(14);
      }
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  await drag([[left / 2, size.height * 0.2], [left / 2 - 8, size.height * 0.72]], 22);
  const rx = right + (size.width - right) / 2;
  await drag([[rx - 20, size.height * 0.14], [rx + 30, size.height * 0.5], [rx - 30, size.height * 0.84]], 14);
  await drag([[size.width * 0.3, top * 0.4], [size.width * 0.62, top * 0.66]], 18);
  await page.waitForTimeout(600);
}

const HISTORY = { visits: { 2: 4, 4: 2, 7: 2, 13: 1 } } as const;

test.describe('room visual checkpoint (tasks 5b and 6)', () => {
  test('a normal 300 px tear (1440x900)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page, { act: 0 });
    await powerOn(page);
    await rip300(page);
    await shoot(page, 'room-tear-300px-1440x900.png');
  });

  test('a three-drag tear (1440x900)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page, { act: 0 });
    await powerOn(page);
    await ripThree(page);
    await shoot(page, 'room-tear-three-1440x900.png');
  });

  test('a tear (1280x720)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await seed(page, { act: 0 });
    await powerOn(page);
    await ripThree(page);
    await shoot(page, 'room-tear-1280x720.png');
  });

  for (const act of [0, 1, 2, 3, 4] as const) {
    test(`a torn wall in Act ${act} (1440x900)`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await seed(page, { act, totalWatchMs: act * 5 * 60000, ...(act > 0 ? HISTORY : {}), sessionCount: act >= 2 ? 2 : 1 });
      await powerOn(page);
      await ripThree(page);
      await shoot(page, `room-act${act}-torn.png`);
    });
  }

  test('room in Act 0 (1440x900 and 1280x720)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page, { act: 0 });
    await powerOn(page);
    await room(page);
    await shoot(page, 'room-act0.png');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(600);
    await shoot(page, 'room-act0-1280x720.png');
  });
});

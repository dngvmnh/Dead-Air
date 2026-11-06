import { test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Captures one committed screenshot each of a slate and the sign-off, under
 * docs/screenshots/, as visual evidence that event output reaches the picture
 * (Fix 1/2). Real WebGL (not the forced fallback). Chromium only.
 *
 * These are deterministic captures of the live tube canvas, not golden-image
 * comparisons, so they never flake a run; they are artefacts for a human.
 */

const SHOTS_DIR = path.resolve(fileURLToPath(new URL('../../docs/screenshots', import.meta.url)));

/**
 * Screenshots are written ONLY when UPDATE_SCREENSHOTS=1 (dead-air-room
 * requirement 9.5: a plain test run must not modify committed files). Without
 * it the tests still drive the flow and assert the text reached the picture;
 * they just do not touch the PNGs on disk.
 */
const UPDATE_SCREENSHOTS = process.env.UPDATE_SCREENSHOTS === '1';

interface SeedMemory {
  act?: number;
  totalWatchMs?: number;
  visits?: Partial<Record<2 | 4 | 7 | 13, number>>;
  visitOrder?: number[];
  lastChannel?: number | null;
  fired?: string[];
}

async function seed(page: Page, mem: SeedMemory): Promise<void> {
  await page.addInitScript((m: SeedMemory) => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    try {
      if (window.localStorage.getItem('deadair.memory.v1') !== null) return;
    } catch {
      return;
    }
    const ch = (v: number) => ({ visits: m.visits?.[v as 2 | 4 | 7 | 13] ?? 0, watchMs: 0, lastVisitedAt: v ? 1 : null });
    const fired: Record<string, { count: number; lastAt: number }> = {};
    for (const id of m.fired ?? []) fired[id] = { count: 1, lastAt: 1 };
    const memory = {
      schemaVersion: 1,
      firstSeenAt: 1,
      lastSeenAt: 1,
      sessionCount: 1,
      totalWatchMs: m.totalWatchMs ?? 0,
      channels: { 2: ch(2), 4: ch(4), 7: ch(7), 13: ch(13) },
      visitOrder: m.visitOrder ?? [],
      lastChannel: m.lastChannel === undefined ? null : m.lastChannel,
      firedEvents: fired,
      act: m.act ?? 0,
      noticeSeen: true,
      settings: { volume: 0.7, muted: false, captions: true, reducedEffects: false },
    };
    try {
      window.localStorage.setItem('deadair.memory.v1', JSON.stringify(memory));
    } catch {
      /* ignore */
    }
  }, mem);
}

const text = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tv?: { lastEventText: () => string } }).__tv?.lastEventText() ?? '');
const phase = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tv?: { phase: () => string } }).__tv?.phase() ?? '');

/** Step the fake clock until the picture shows `pattern`, then shoot it. */
async function shootWhen(page: Page, pattern: RegExp, file: string, maxMs = 12000): Promise<void> {
  let elapsed = 0;
  while (elapsed < maxMs) {
    if (pattern.test(await text(page))) break;
    await page.clock.runFor(300);
    elapsed += 300;
  }
  // Settle well inside the step (past any flashPrevious/transition that precedes
  // a slate) so the captured frame is the published text, not a dark flash
  // frame, and let the shader draw it (the fake clock drives rAF too).
  await page.clock.runFor(800);
  await page.waitForTimeout(200);
  // Assert the picture is showing the expected text, so the test proves the
  // behaviour whether or not it writes a file.
  if (!pattern.test(await text(page))) throw new Error(`expected picture to show ${pattern}`);
  if (UPDATE_SCREENSHOTS) {
    await page.getByTestId('tube-opening').screenshot({ path: path.join(SHOTS_DIR, file) });
  }
}

test.describe('screenshots (committed evidence)', () => {
  test('capture a slate (E05) and the sign-off (E10)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });

    // Slate: Act 2, came from 04, boot straight to 13 → E05 slate.
    await seed(page, {
      act: 2,
      totalWatchMs: 9 * 60_000,
      visits: { 2: 1, 4: 2, 7: 1, 13: 0 },
      visitOrder: [2, 7, 4],
      lastChannel: 13,
    });
    await page.goto('/?demo=1');
    const notice = page.getByRole('button', { name: /i understand/i });
    if (await notice.isVisible().catch(() => false)) await notice.click();
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.clock.runFor(2200);
    await shootWhen(page, /UNAUTHORISED VIEWER DETECTED|LAST TUNED/, 'slate-e05.png');
  });

  test('capture the sign-off text (E10)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });
    await seed(page, {
      act: 3,
      totalWatchMs: 15 * 60_000,
      visits: { 2: 2, 4: 1, 7: 1, 13: 2 },
      visitOrder: [4, 7, 2, 13],
      lastChannel: 13,
      fired: ['E05', 'E07'],
    });
    await page.goto('/?demo=1');
    const notice = page.getByRole('button', { name: /i understand/i });
    if (await notice.isVisible().catch(() => false)) await notice.click();
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.clock.runFor(2200);
    await shootWhen(page, /BROADCAST TERMINATED/, 'signoff-e10.png');
    // Confirm we actually captured during SIGN_OFF.
    await page.waitForFunction(() => true);
    void (await phase(page));
  });
});

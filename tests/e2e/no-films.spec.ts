import { expect, test } from '@playwright/test';

/**
 * A host with no films, or a film that fails to load. The channels fall back to their
 * drawn programmes, and those run back to back. An item ending there once hung the
 * page for good: the listener that replaced itself during `ended` was handed the same
 * `ended`, forever.
 */

interface Win {
  __tv: { phase: () => string };
  __frames: number;
}

test('with every film missing the set keeps running across item boundaries', async ({ page }) => {
  test.setTimeout(90000);
  await page.route('**/film/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.addInitScript(() => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    const now = Date.now();
    const ch = () => ({ visits: 1, watchMs: 0, lastVisitedAt: 1 });
    localStorage.setItem(
      'deadair.memory.v1',
      JSON.stringify({
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
        settings: { volume: 0, muted: true, captions: true, reducedEffects: false },
        room: { strokes: [], figureStep: 0, objectVariant: 0, ripBackDone: false },
      }),
    );
    const w = window as unknown as Win;
    w.__frames = 0;
    const tick = (): void => {
      w.__frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as Win).__tv);
  await page.getByRole('button', { name: /^power$/i }).click();
  await page.waitForFunction(() => (window as unknown as Win).__tv.phase() === 'ON_AIR', undefined, { timeout: 30000 });

  // A hung page answers nothing, so every question has its own short deadline.
  const frames = (): Promise<number> =>
    Promise.race([
      page.evaluate(() => (window as unknown as Win).__frames),
      new Promise<number>((_, reject) => setTimeout(() => reject(new Error('the page has hung')), 8000)),
    ]);

  const up = page.getByRole('button', { name: /channel up/i });
  let last = await frames();
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(3000);
    const now = await frames();
    expect(now).toBeGreaterThan(last);
    last = now;
    if (i % 3 === 2) await Promise.race([up.click({ timeout: 5000 }), new Promise((r) => setTimeout(r, 5000))]);
  }
});

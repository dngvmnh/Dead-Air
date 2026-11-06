import { expect, test, type Page } from '@playwright/test';

/**
 * Milestone 2 checkpoint (task 11): leave channel 02, return 60 seconds later,
 * and the programme has advanced about 60 seconds. Chromium only
 * (`--project=chromium`); firefox/webkit are not installed or run.
 *
 * The broadcast clock is the source of truth for what is on (design §5), so
 * "advanced ~60s" means the channel's absolute looped position moved forward by
 * ~60s of wall-clock time while we were away — regardless of which item shows.
 * We control wall-clock time with Playwright's clock API (no real 60s wait) and
 * read the clock-resolved position through a test-only `window.__tv` seam that
 * production never exposes.
 */

async function setup(page: Page) {
  // Install a fake clock BEFORE any script runs, and set the test flag that
  // exposes the renderer/position seams.
  await page.clock.install({ time: new Date('2026-01-01T20:00:00Z') });
  await page.addInitScript(() => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean })
      .__CRT_PRESERVE_DRAWING_BUFFER__ = true;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /i understand/i }).click();
}

function phase(page: Page) {
  return page.getByTestId('tube-opening').getAttribute('data-phase');
}

function positionMs(page: Page): Promise<number | null> {
  return page.evaluate(
    () =>
      (window as unknown as { __tv?: { broadcastPositionMs: () => number | null } }).__tv
        ?.broadcastPositionMs() ?? null,
  );
}

function channel(page: Page): Promise<number | null> {
  return page.evaluate(
    () => (window as unknown as { __tv?: { channel: () => number | null } }).__tv?.channel() ?? null,
  );
}

test.describe('Milestone 2 checkpoint', () => {
  test('leaving channel 02 and returning 60s later advances the programme ~60s', async ({
    page,
  }) => {
    await setup(page);

    // POWER on. Boot (1400ms) then tune (500ms) run on timers the fake clock
    // drives, so advance time to let them fire and reach ON_AIR on channel 02.
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.clock.runFor(2500);
    await expect.poll(() => phase(page), { timeout: 10000 }).toBe('ON_AIR');
    await expect.poll(() => channel(page)).toBe(2);

    const position0 = await positionMs(page);
    expect(position0).not.toBeNull();

    // Leave channel 02: surf up to channel 04 (which has no content yet, so it
    // lands on stand-by — the point is only that we are off channel 02, with no
    // channel-02 timers running).
    await page.getByRole('button', { name: /channel up/i }).click();
    await page.clock.runFor(700);
    await expect.poll(() => channel(page)).not.toBe(2);

    // Sixty seconds pass while we are away. fastForward jumps the clock without
    // running 60s of real time (and fires any timers along the way).
    await page.clock.fastForward(60_000);

    // Return to channel 02.
    await page.getByRole('button', { name: /channel down/i }).click();
    await page.clock.runFor(700);
    await expect.poll(() => phase(page), { timeout: 10000 }).toBe('ON_AIR');
    await expect.poll(() => channel(page)).toBe(2);

    const position1 = await positionMs(page);
    expect(position1).not.toBeNull();

    // The programme advanced by ~60s (plus the ~1.4s of tune time spent on the
    // two hops). The position is an offset into channel 02's 92s rundown loop,
    // so compare the FORWARD delta modulo the period: a 60s advance from any
    // starting point reads as +60s forward, even when it wraps past the loop.
    const TOTAL_MS = 92_000;
    const advancedMs = (((position1 as number) - (position0 as number)) % TOTAL_MS + TOTAL_MS) % TOTAL_MS;
    expect(advancedMs).toBeGreaterThan(59_000);
    expect(advancedMs).toBeLessThan(63_000);
  });
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Milestone 3 / MVP checkpoint (task 16): with `/?demo=1`, active surfing
 * reaches the sign-off within about three minutes, using scenes only, proven
 * with a mocked clock. Chromium only (`--project=chromium`).
 *
 * Demo divides the escalation thresholds by six, so Act 3 — the sign-off gate —
 * needs ~2 min 20 s of watch time plus all four channels and E07 fired (which
 * needs Act 2 and E05). We advance the mocked clock while on air to bank watch
 * time, visit all four channels, revisit channel 13 so the director fires
 * E05 → E07, then tune 13 once more at Act 3 so E10 (the sign-off) fires, cuts
 * to the fixed sign-off text, and powers the TV into Act 4.
 *
 * The non-WebGL fallback renderer is forced here (a test-only flag production
 * never sets) because this checkpoint asserts the escalation FLOW via the
 * `window.__tv` seam, not pixels — the WebGL shader's per-frame loop makes a
 * mocked-clock run of this length needlessly slow, while the scene/clock/
 * director logic under test is identical on either renderer. Pixel rendering is
 * covered by the channel-02/04/07 specs.
 */

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T21:00:00Z') });
  await page.addInitScript(() => {
    const w = window as unknown as {
      __CRT_PRESERVE_DRAWING_BUFFER__?: boolean;
      __CRT_FORCE_FALLBACK__?: boolean;
    };
    w.__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    w.__CRT_FORCE_FALLBACK__ = true;
  });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /i understand/i }).click();
}

interface TvState {
  channel: number | null;
  act: number;
  phase: string;
  fired: string[];
}

const tvState = (page: Page): Promise<TvState> =>
  page.evaluate(() => {
    const tv = (
      window as unknown as {
        __tv?: { channel: () => number | null; act: () => number; phase: () => string; firedEvents: () => string[] };
      }
    ).__tv;
    return {
      channel: tv?.channel() ?? null,
      act: tv?.act() ?? -1,
      phase: tv?.phase() ?? '',
      fired: tv?.firedEvents() ?? [],
    };
  });

/** Tune to `target` by pressing CH+ until the LED matches, advancing the clock. */
async function tuneTo(page: Page, target: number): Promise<void> {
  const chUp = page.getByRole('button', { name: /channel up/i });
  for (let i = 0; i < 5; i += 1) {
    if ((await tvState(page)).channel === target) return;
    await chUp.click();
    await page.clock.runFor(1200); // tune + any brief tune-in event
  }
}

/** Bank watch time by advancing the clock while the current channel is on air. */
async function dwell(page: Page, ms: number): Promise<void> {
  let left = ms;
  while (left > 0) {
    const slice = Math.min(15_000, left);
    await page.clock.runFor(slice);
    left -= slice;
  }
}

test.describe('MVP checkpoint (task 16)', () => {
  test('`/?demo=1` reaches the sign-off within about three minutes of surfing', async ({ page }) => {
    // The mocked clock replays every frame, and each is a real draw on a real GPU.
    test.setTimeout(process.env.PW_GPU ? 900_000 : 300_000);
    await setup(page);

    await page.getByRole('button', { name: /^power$/i }).click();
    await page.clock.runFor(2500); // boot + tune to ch02
    await expect.poll(async () => (await tvState(page)).phase, { timeout: 10000 }).toMatch(/ON_AIR|EVENT/);

    // Visit all four channels (distinct = 4).
    for (const ch of [4, 7, 13, 2]) await tuneTo(page, ch);

    // Bank watch time to reach Act 2 (80s in demo), with margin.
    await dwell(page, 95_000);
    await expect.poll(async () => (await tvState(page)).act, { timeout: 8000 }).toBeGreaterThanOrEqual(2);

    // Fire E05 then E07 on channel 13. Each is gated by the global inter-event
    // gap (15s in demo) and tune-in only, so we surf back to 13 repeatedly,
    // dwelling on channel 02 in between to clear the gap and bank more watch.
    const fired = async () => (await tvState(page)).fired;
    for (let lap = 0; lap < 12 && !(await fired()).includes('E07'); lap += 1) {
      await tuneTo(page, 2);
      await dwell(page, 18_000); // clear the inter-event gap + bank watch
      await tuneTo(page, 13);
      await dwell(page, 4000); // let a tune-in event run
    }
    const afterLaps = await fired();
    expect(afterLaps).toContain('E05');
    expect(afterLaps).toContain('E07');

    // Top up watch time if Act 3 (140s total) is not yet reached.
    await tuneTo(page, 2);
    for (let i = 0; i < 6 && (await tvState(page)).act < 3; i += 1) {
      await dwell(page, 20_000);
    }
    await expect.poll(async () => (await tvState(page)).act, { timeout: 8000 }).toBeGreaterThanOrEqual(3);

    // Tune 13 at Act 3 so the sign-off (E10) fires. It is gated by the global
    // gap like any event, so surf 2 <-> 13 with gap-clearing dwells until E10
    // has fired; then its fixed text shows for 8s and powers off into Act 4
    // (requirement 11.1/11.2).
    for (let lap = 0; lap < 10 && !(await tvState(page)).fired.includes('E10'); lap += 1) {
      await tuneTo(page, 2);
      await dwell(page, 18_000); // clear the inter-event gap
      await tuneTo(page, 13);
      // Advance in SMALL steps so we STOP the instant SIGN_OFF is reached and do
      // not consume the 8s text window before we assert on it.
      for (let i = 0; i < 30 && (await tvState(page)).phase !== 'SIGN_OFF'; i += 1) {
        if ((await tvState(page)).phase === 'OFF') break; // already finished
        await page.clock.runFor(300);
      }
    }
    expect((await tvState(page)).fired).toContain('E10');

    // The sign-off cut shows the EXACT fixed text (media-bible §9), drawn onto
    // the picture, for the FULL 8 seconds before power-off. We arrived at the
    // start of the window above, so now: it is drawn now, still drawn ~7s in
    // (under 8s), and powered off into Act 4 past 8s.
    const readText = () =>
      page.evaluate(() => (window as unknown as { __tv?: { lastEventText: () => string } }).__tv?.lastEventText() ?? '');
    const signOffShowing = async () => {
      const t = await readText();
      return (
        t.includes('NO SIGNAL') &&
        t.includes('THANK YOU FOR WATCHING.') &&
        t.includes('BROADCAST TERMINATED · 00:00:13')
      );
    };
    expect((await tvState(page)).phase).toBe('SIGN_OFF');
    expect(await signOffShowing()).toBe(true);

    // Still showing at ~6s (comfortably under the 8s window).
    await page.clock.runFor(6000);
    expect(await signOffShowing()).toBe(true);
    expect((await tvState(page)).phase).toBe('SIGN_OFF');

    // Past 8s total: powered off into Act 4.
    await page.clock.runFor(2000);
    await expect.poll(async () => (await tvState(page)).act, { timeout: 10000 }).toBe(4);
    const end = await tvState(page);
    expect(end.phase).toBe('OFF'); // powered off after the sign-off text
  });
});

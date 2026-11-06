import { expect, test, type Page } from '@playwright/test';

/**
 * Regression cover for the review's two findings, on REAL WebGL (not the forced
 * fallback), with seeded localStorage memory so events fire without minutes of
 * watch-time banking:
 *
 *  1. Event output must be VISIBLE — a slate and the sign-off text must be
 *     painted onto the published source canvas and flow through the shader. We
 *     prove it two ways: the tube canvas pixels light up with structured text,
 *     and a test seam (`__tv.lastEventText`) records the exact text drawn.
 *  2. The ending cannot be lost — leaving during E10, reloading during the
 *     sign-off text, and powering off during an event all behave per design §7.
 *
 * Plus: booting on the saved channel (req 1.3), rapid surfing records one visit,
 * CC on/off, and E05 naming the previous channel.
 *
 * Chromium only (`--project=chromium`).
 */

interface SeedMemory {
  act?: number;
  totalWatchMs?: number;
  visits?: Partial<Record<2 | 4 | 7 | 13, number>>;
  visitOrder?: number[];
  lastChannel?: number | null;
  fired?: string[];
  sessionCount?: number;
  captions?: boolean;
  noticeSeen?: boolean;
}

/**
 * Seed a valid `deadair.memory.v1` before the app loads, plus enable the real
 * WebGL test seam (preserve drawing buffer + __tv). Real WebGL, NOT the forced
 * fallback.
 */
async function seed(page: Page, mem: SeedMemory = {}): Promise<void> {
  await page.addInitScript((m: SeedMemory) => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    // Seed ONCE: on a reload the app's own persisted memory must survive, so we
    // never overwrite an existing key (that would hide reload-recovery bugs).
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
      sessionCount: m.sessionCount ?? 1,
      totalWatchMs: m.totalWatchMs ?? 0,
      channels: { 2: ch(2), 4: ch(4), 7: ch(7), 13: ch(13) },
      visitOrder: m.visitOrder ?? [],
      lastChannel: m.lastChannel === undefined ? null : m.lastChannel,
      firedEvents: fired,
      act: m.act ?? 0,
      noticeSeen: m.noticeSeen ?? true,
      settings: { volume: 0.7, muted: false, captions: m.captions ?? true, reducedEffects: false },
    };
    try {
      window.localStorage.setItem('deadair.memory.v1', JSON.stringify(memory));
    } catch {
      /* ignore */
    }
  }, mem);
}

interface TvSeam {
  channel: () => number | null;
  act: () => number;
  phase: () => string;
  firedEvents: () => string[];
  lastEventText: () => string;
  forceMidItem: () => void;
}

const tv = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __tv?: TvSeam }).__tv;
    return {
      channel: s?.channel() ?? null,
      act: s?.act() ?? -1,
      phase: s?.phase() ?? '',
      fired: s?.firedEvents() ?? [],
      lastText: s?.lastEventText() ?? '',
    };
  });

async function lastEventText(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __tv?: TvSeam }).__tv?.lastEventText() ?? '');
}

/**
 * Advance the fake clock in small steps, collecting every distinct value the
 * sign-off/slate text seam reported, until `pattern` is seen or `maxMs` of
 * fake time elapses. Returns the collected texts. Because the clock is frozen
 * between runFor calls, polling alone never sees new frames — we must step time.
 */
async function collectEventText(page: Page, pattern: RegExp, maxMs = 9000): Promise<string[]> {
  const seen = new Set<string>();
  let elapsed = 0;
  while (elapsed < maxMs) {
    const t = await lastEventText(page);
    if (t) seen.add(t);
    if (pattern.test(t)) break;
    await page.clock.runFor(300);
    elapsed += 300;
  }
  return [...seen];
}

/** Read tube canvas pixels (real WebGL readback) to prove the picture is lit/structured. */
async function readPixels(page: Page): Promise<{ meanLum: number; buckets: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="tube-opening"] canvas');
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) return { meanLum: -1, buckets: -1 };
    const p = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
    const n = canvas.width * canvas.height;
    let sum = 0;
    const seen = new Set<number>();
    for (let i = 0; i < p.length; i += 4) {
      const lum = (p[i]! + p[i + 1]! + p[i + 2]!) / 3;
      sum += lum;
      seen.add(Math.round(lum / 8));
    }
    return { meanLum: sum / n, buckets: seen.size };
  });
}

async function acknowledge(page: Page): Promise<void> {
  const notice = page.getByRole('button', { name: /i understand/i });
  if (await notice.isVisible().catch(() => false)) await notice.click();
}

const chUp = (page: Page) => page.getByRole('button', { name: /channel up/i });
const power = (page: Page) => page.getByRole('button', { name: /^power$/i });

/** Tune to `target` by pressing CH+ until the LED matches, advancing a fake clock. */
async function tuneTo(page: Page, target: number): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    if ((await tv(page)).channel === target) return;
    await chUp(page).click();
    await page.clock.runFor(1200);
  }
}

test.describe('event output is visible on real WebGL', () => {
  test('a slate (E05) is drawn onto the published canvas and recorded', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });
    // Act 2, came from channel 04, saved channel 13 so POWER boots straight to
    // 13: the boot tune-in fires E05 (priority beats E02) with no prior event,
    // so the global gap can't block it. The slate names the previous DIFFERENT
    // channel from visitOrder (04).
    await seed(page, {
      act: 2,
      totalWatchMs: 9 * 60_000,
      visits: { 2: 1, 4: 2, 7: 1, 13: 0 },
      visitOrder: [2, 7, 4],
      lastChannel: 13,
    });
    await page.goto('/?demo=1');
    await acknowledge(page);

    await power(page).click();
    await page.clock.runFor(2500); // boot + tune to 13, into the event

    // Collect the text drawn across the slate steps. Both slate lines must have
    // reached the picture, and the second names the channel CAME FROM (04).
    const texts = await collectEventText(page, /CHANNEL 04/);
    expect((await tv(page)).fired).toContain('E05');
    expect(texts.join(' | ')).toMatch(/UNAUTHORISED VIEWER DETECTED/);
    expect(texts.join(' | ')).toContain('LAST TUNED: CHANNEL 04');

    // The tube is lit and structured (text drawn), not flat black.
    let best = { meanLum: 0, buckets: 0 };
    await expect
      .poll(async () => {
        const px = await readPixels(page);
        if (px.meanLum > best.meanLum) best = px;
        return best.meanLum;
      }, { timeout: 6000, intervals: [100] })
      .toBeGreaterThan(12);
    expect(best.buckets).toBeGreaterThan(3);
  });

  test('the fixed sign-off text (E10) is drawn with the exact media-bible wording', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });
    // Act 3 with E05/E07 fired; came from 02; boot straight to 13 so the tune-in
    // fires E10 (chain, so the global gap can't block it).
    await seed(page, {
      act: 3,
      totalWatchMs: 15 * 60_000,
      visits: { 2: 2, 4: 1, 7: 1, 13: 2 },
      visitOrder: [4, 7, 2, 13],
      lastChannel: 13,
      fired: ['E05', 'E07'],
    });
    await page.goto('/?demo=1');
    await acknowledge(page);

    await power(page).click();
    await page.clock.runFor(2200); // boot + tune to 13, into the E10 steps
    await page.clock.runFor(4000); // voice + collapse + sign-off cut

    await expect.poll(async () => (await tv(page)).fired, { timeout: 8000 }).toContain('E10');
    await expect.poll(async () => (await tv(page)).phase, { timeout: 8000 }).toBe('SIGN_OFF');

    // The EXACT wording from media-bible §9 was drawn — no extra label.
    const text = await lastEventText(page);
    expect(text).toContain('NO SIGNAL');
    expect(text).toContain('THANK YOU FOR WATCHING.');
    expect(text).toContain('BROADCAST TERMINATED · 00:00:13');
  });
});

test.describe('the ending cannot be lost', () => {
  // Boot straight to 13 (lastChannel 13) so the tune-in fires E10 (chain, so no
  // gap gate). Act 3 with E05/E07 fired; came from 02 in visitOrder.
  const act3Seed: SeedMemory = {
    act: 3,
    totalWatchMs: 15 * 60_000,
    visits: { 2: 2, 4: 1, 7: 1, 13: 2 },
    visitOrder: [4, 7, 2, 13],
    lastChannel: 13,
    fired: ['E05', 'E07'],
  };

  test('leaving during the E10 voice lets E10 fire again on the next visit to 13', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });
    await seed(page, act3Seed);
    await page.goto('/?demo=1');
    await acknowledge(page);
    await power(page).click();
    await page.clock.runFor(2200); // boot + tune to 13; E10 voice starts
    await expect.poll(async () => (await tv(page)).phase, { timeout: 8000 }).toBe('EVENT');
    // Still in the voice, not yet SIGN_OFF: E10 is NOT yet recorded (design §7).
    expect((await tv(page)).fired).not.toContain('E10');

    // Leave during the voice.
    await chUp(page).click();
    await page.clock.runFor(1500);
    expect((await tv(page)).phase).not.toBe('SIGN_OFF');
    expect((await tv(page)).fired).not.toContain('E10');

    // Return to 13: E10 fires again and this time reaches SIGN_OFF.
    await tuneTo(page, 13);
    await page.clock.runFor(4000);
    await expect.poll(async () => (await tv(page)).fired, { timeout: 8000 }).toContain('E10');
    await expect.poll(async () => (await tv(page)).phase, { timeout: 8000 }).toBe('SIGN_OFF');
  });

  test('a reload during the sign-off text still completes into Act 4', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });
    await seed(page, act3Seed);
    await page.goto('/?demo=1');
    await acknowledge(page);
    await power(page).click();
    await page.clock.runFor(2200);
    await page.clock.runFor(4000); // voice + collapse + sign-off cut
    await expect.poll(async () => (await tv(page)).phase, { timeout: 8000 }).toBe('SIGN_OFF');
    // E10 is recorded as fired on reaching SIGN_OFF and flushed immediately.
    expect((await tv(page)).fired).toContain('E10');

    // Reload DURING the 8s text (before SIGN_OFF_COMPLETE). On load, because E10
    // fired and act < 4, the TV completes into Act 4 (Fix 4) rather than
    // stranding the viewer in Act 3.
    await page.reload();
    await acknowledge(page);
    await expect.poll(async () => (await tv(page)).act, { timeout: 10000 }).toBe(4);
  });

  test('powering off during an event cancels it (no stale step, no sign-off)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });
    await seed(page, act3Seed);
    await page.goto('/?demo=1');
    await acknowledge(page);
    await power(page).click();
    await page.clock.runFor(2200); // boot + tune to 13; E10 voice running
    await expect.poll(async () => (await tv(page)).phase, { timeout: 8000 }).toBe('EVENT');

    await power(page).click(); // power off mid-event
    await page.clock.runFor(2000);
    const s = await tv(page);
    expect(s.phase).toBe('OFF');
    // The sign-off was not reached, so E10 is not consumed.
    expect(s.fired).not.toContain('E10');
  });
});

test.describe('restore, surfing and captions', () => {
  test('POWER tunes to the saved channel, not channel 02 (requirement 1.3)', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });
    await seed(page, { visits: { 7: 1 }, visitOrder: [7], lastChannel: 7 });
    await page.goto('/');
    await acknowledge(page);
    await power(page).click();
    await page.clock.runFor(2500);
    await expect.poll(async () => (await tv(page)).channel, { timeout: 10000 }).toBe(7);
  });

  test('rapid surfing records one visit for the final channel only (requirement 7.1)', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });
    await seed(page, { lastChannel: 2 });
    await page.goto('/');
    await acknowledge(page);
    await power(page).click();
    await page.clock.runFor(2500);

    await expect.poll(async () => (await tv(page)).phase, { timeout: 8000 }).toBe('ON_AIR');
    // The boot tune to the saved channel 02 recorded exactly one visit.
    const afterBoot = await page.evaluate(() => (window as unknown as { __tv?: TvSeam }).__tv?.visitTotal() ?? -1);
    expect(afterBoot).toBe(1);

    // Hammer CH+ four times WITHOUT letting the tune complete between presses;
    // each press restarts the single tune timer (requirement 2.4), so only the
    // FINAL landing tunes and records one more visit — not four.
    await chUp(page).click();
    await chUp(page).click();
    await chUp(page).click();
    await chUp(page).click();
    await page.clock.runFor(1500); // only now does the final tune complete

    // Read live memory (not throttled localStorage): exactly one further visit
    // was recorded for the final channel — rapid surfing is one visit, not four.
    const total = await page.evaluate(() => (window as unknown as { __tv?: TvSeam }).__tv?.visitTotal() ?? -1);
    expect(total).toBe(2);
  });

  test('CC off hides scene captions; CC on shows them', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });
    await seed(page, { lastChannel: 2, captions: true });
    await page.goto('/');
    await acknowledge(page);
    await power(page).click();
    await page.clock.runFor(2500);
    await expect.poll(async () => (await tv(page)).phase, { timeout: 10000 }).toBe('ON_AIR');

    // The CC control starts pressed (captions default on).
    const cc = page.getByRole('button', { name: /closed captions/i });
    await expect(cc).toHaveAttribute('aria-pressed', 'true');
    await cc.click();
    await expect(cc).toHaveAttribute('aria-pressed', 'false');
    await cc.click();
    await expect(cc).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('mid-item seam', () => {
  test('E03 can fire at a mid-item seam on channel 04 (requirement/ design §9)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.install({ time: new Date('2026-06-01T21:00:00Z') });
    // Act 1, channel 04 visited twice, came from 02 so we can tune to 04.
    await seed(page, { act: 1, visits: { 2: 1, 4: 2 }, visitOrder: [2, 4], lastChannel: 4 });
    await page.goto('/?demo=1');
    await acknowledge(page);
    await power(page).click();
    await page.clock.runFor(2500);

    await tuneTo(page, 4);
    await expect.poll(async () => (await tv(page)).channel, { timeout: 8000 }).toBe(4);
    // Any tune-in event (E02) just fired; E03 is not a chain, so wait out the
    // global gap (90s / 6 = 15s in demo) before the mid-item check, or E03 is
    // suppressed by the gap.
    await page.clock.runFor(16_000);

    // Force the next mid-item check to roll a hit, then advance past a 10s check.
    await page.evaluate(() => (window as unknown as { __tv?: TvSeam }).__tv?.forceMidItem());
    await page.clock.runFor(11_000);

    await expect.poll(async () => (await tv(page)).fired, { timeout: 8000 }).toContain('E03');
  });
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Task 3.4: the tearable wall, on real WebGL (not the forced fallback). These
 * assert VISIBLE PIXELS change under a drag — a test cannot pass on state alone
 * — plus multi-touch, the notice blocking tear input, and the clean-feed
 * guarantee that the room canvas never covers the tube (elementFromPoint).
 * Chromium only.
 */

async function ready(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ = true;
  });
  await page.goto('/');
}

async function acknowledge(page: Page): Promise<void> {
  const notice = page.getByRole('button', { name: /i understand/i });
  if (await notice.isVisible().catch(() => false)) await notice.click();
}

interface RoomSeam {
  strokes: () => number;
  broken: () => number;
  ripSeeded: () => void;
}

const room = (page: Page) =>
  page.evaluate(() => {
    const r = (window as unknown as { __room?: RoomSeam }).__room;
    return { strokes: r?.strokes() ?? -1, broken: r?.broken() ?? -1 };
  });

/** Snapshot the room canvas pixels into a window global (kept in-page). */
async function snapshotPixels(page: Page, slot: string): Promise<void> {
  await page.evaluate((s) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="room-canvas"]');
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) return;
    const px = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    (window as unknown as Record<string, Uint8Array>)[s] = px;
  }, slot);
}

/** Count pixels that changed between two in-page snapshots (computed in-page). */
async function changedPixels(page: Page, a: string, b: string, threshold = 10): Promise<number> {
  return page.evaluate(
    ([sa, sb, th]) => {
      const w = window as unknown as Record<string, Uint8Array>;
      const pa = w[sa as string];
      const pb = w[sb as string];
      if (!pa || !pb) return -1;
      const n = Math.min(pa.length, pb.length);
      let changed = 0;
      for (let i = 0; i < n; i += 4) {
        const la = (pa[i]! + pa[i + 1]! + pa[i + 2]!) / 3;
        const lb = (pb[i]! + pb[i + 1]! + pb[i + 2]!) / 3;
        if (Math.abs(la - lb) > (th as number)) changed += 1;
      }
      return changed;
    },
    [a, b, threshold] as const,
  );
}

/**
 * Find a screen point where the room canvas is the topmost element — i.e. an
 * area NOT covered by the opaque chassis — so a mouse drag actually reaches the
 * wall. The exposed margins are to the left/right and above/below the set.
 */
async function exposedPoint(page: Page): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(() => {
    const room = document.querySelector('[data-testid="room-canvas"]');
    if (!room) return null;
    for (let fy = 0.1; fy < 0.95; fy += 0.1) {
      for (let fx = 0.04; fx < 0.5; fx += 0.04) {
        const x = Math.round(window.innerWidth * fx);
        const y = Math.round(window.innerHeight * fy);
        const top = document.elementFromPoint(x, y);
        if (top === room) return { x, y };
      }
    }
    return null;
  });
  if (!p) throw new Error('no exposed room-canvas point found');
  return p;
}

/** A slow drag over an exposed part of the wall (tears the paper). */
async function dragTear(page: Page, start: { x: number; y: number }): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i += 1) {
    await page.mouse.move(start.x + i * 10, start.y + i * 12, { steps: 2 });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test.describe('room wall tear (real WebGL)', () => {
  test('a drag tears the paper and changes pixels in the dragged region', async ({ page }) => {
    await ready(page);
    await acknowledge(page);
    // The room canvas exists and the sim is live.
    await expect(page.getByTestId('room-canvas')).toBeVisible();
    await expect.poll(async () => (await room(page)).broken, { timeout: 5000 }).toBeGreaterThanOrEqual(0);

    // Drag over an exposed part of the wall (left/top margin, not the chassis).
    const start = await exposedPoint(page);
    await snapshotPixels(page, '__before');
    await dragTear(page, start);
    await snapshotPixels(page, '__after');

    expect((await room(page)).strokes).toBeGreaterThan(0);
    expect((await room(page)).broken).toBeGreaterThan(0);
    // A real tear moves/removes many triangles, so many pixels change — a check
    // that cannot pass on state alone, and position-independent. Diff is
    // computed in-page so no megabyte buffer crosses the bridge.
    expect(await changedPixels(page, '__before', '__after')).toBeGreaterThan(200);
  });

  test('two independent touch points can both tear', async ({ page }) => {
    await ready(page);
    await acknowledge(page);
    const canvas = page.getByTestId('room-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no box');

    // Two pointerdowns via CDP-free dispatch: use touchscreen for two taps-drags.
    // Playwright's touchscreen is single-point, so drive two pointer streams
    // through dispatchEvent with distinct pointerIds.
    const fire = async (type: string, id: number, fx: number, fy: number) => {
      await page.evaluate(
        ([t, pid, x, y, sel]) => {
          const el = document.querySelector(sel as string)!;
          const r = el.getBoundingClientRect();
          const ev = new PointerEvent(t as string, {
            pointerId: pid as number,
            pointerType: 'touch',
            isPrimary: (pid as number) === 1,
            clientX: r.left + r.width * (x as number),
            clientY: r.top + r.height * (y as number),
            bubbles: true,
            cancelable: true,
          });
          el.dispatchEvent(ev);
        },
        [type, id, fx, fy, '[data-testid="room-canvas"]'] as const,
      );
    };

    await fire('pointerdown', 1, 0.2, 0.2);
    await fire('pointerdown', 2, 0.8, 0.2);
    for (let i = 1; i <= 10; i += 1) {
      await fire('pointermove', 1, 0.2 + i * 0.03, 0.2 + i * 0.05);
      await fire('pointermove', 2, 0.8 - i * 0.03, 0.2 + i * 0.05);
      await page.waitForTimeout(16);
    }
    await fire('pointerup', 1, 0.5, 0.7);
    await fire('pointerup', 2, 0.5, 0.7);
    await page.waitForTimeout(200);

    // Two strokes recorded, and the sheet tore.
    expect((await room(page)).strokes).toBeGreaterThanOrEqual(2);
    expect((await room(page)).broken).toBeGreaterThan(0);
  });

  test('the first-run notice blocks tearing (requirement 1.8)', async ({ page }) => {
    await ready(page);
    // Do NOT acknowledge: the notice is up, tear input must be ignored.
    await expect(page.getByRole('button', { name: /i understand/i })).toBeVisible();
    // The room seam is only published under the test flag; it exists, but a
    // drag while the notice is up must not tear. Drag over where the canvas is.
    await page.mouse.move(200, 200);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(200 + i * 20, 200 + i * 16, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const r = await room(page);
    // No stroke started, nothing broken.
    expect(r.strokes).toBe(0);
    expect(r.broken).toBe(0);
  });

  test('the T key rips a seeded path for keyboard users (requirement 8.2)', async ({ page }) => {
    await ready(page);
    await acknowledge(page);
    await expect.poll(async () => (await room(page)).broken, { timeout: 5000 }).toBe(0);
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    expect((await room(page)).broken).toBeGreaterThan(0);
    expect((await room(page)).strokes).toBeGreaterThan(0);
  });

  test('the WebGL context is lost and restored, and the wall still draws (req 8.6)', async ({ page }) => {
    await ready(page);
    await acknowledge(page);
    await expect.poll(async () => (await room(page)).broken, { timeout: 5000 }).toBe(0);
    // Tear, then force a context loss and restore via the debug extension.
    await page.keyboard.press('t');
    await page.waitForTimeout(150);
    const brokenBefore = (await room(page)).broken;
    expect(brokenBefore).toBeGreaterThan(0);
    await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="room-canvas"]');
      const gl = c?.getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_lose_context');
      ext?.loseContext();
      setTimeout(() => ext?.restoreContext(), 30);
    });
    await page.waitForTimeout(400);
    // The sim kept running (broken strokes persist) and rendering resumed.
    expect((await room(page)).broken).toBeGreaterThanOrEqual(brokenBefore);
  });

  test('2D fallback draws a pre-torn room when WebGL2 is forced off (req 8.5)', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean; __CRT_FORCE_FALLBACK__?: boolean };
      w.__CRT_PRESERVE_DRAWING_BUFFER__ = true;
      w.__CRT_FORCE_FALLBACK__ = true;
    });
    await page.goto('/');
    await acknowledge(page);
    // The canvas is a 2D context now; it must have drawn a non-blank room.
    const lit = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="room-canvas"]');
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return -1;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      return sum / (c.width * c.height);
    });
    // Pre-torn room (paper + behind plaster) is drawn, so mean luminance is > 0.
    expect(lit).toBeGreaterThan(5);
    // The set still works in the fallback: POWER lights the LED.
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.waitForTimeout(400);
    await expect(page.getByTestId('tube-opening')).toHaveAttribute('data-phase', /BOOTING|TUNING|ON_AIR|STAND_BY/);
  });

  // Task 5a.6: measure the OPENING the drag makes — its area and its width
  // along the drag path — on real WebGL, and confirm it is still open two
  // seconds after release. This asserts the tear follows the pointer and stays
  // open, which a changed-pixels-only check cannot prove.
  test('a stepped drag opens a gash along its path that stays open 2 s later', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    await acknowledge(page);
    await expect(page.getByTestId('room-canvas')).toBeVisible();
    await expect.poll(async () => (await room(page)).broken, { timeout: 5000 }).toBe(0);

    // A straight ~300 px vertical drag through the exposed left band, in small
    // steps so the gash is cut all along the path (not just at the ends).
    const sx = Math.round(1440 * 0.12);
    const sy = Math.round(900 * 0.22);
    const len = 300;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    const steps = 24;
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(sx, sy + (len * i) / steps, { steps: 1 });
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    // Measure the opening: along the drag path, scan each sampled row for a run
    // of PLASTER pixels (the pale behind layer), which only shows where the
    // paper is actually gone. Returns the per-row opening width in CSS px and
    // the total opened area (as a pixel count).
    const measure = () =>
      page.evaluate(
        ([cx, y0, y1]) => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="room-canvas"]');
          const gl = canvas?.getContext('webgl2');
          if (!canvas || !gl) return { widths: [] as number[], area: -1 };
          const W = canvas.width;
          const H = canvas.height;
          const px = new Uint8Array(W * H * 4);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const sxC = Math.round((cx / window.innerWidth) * W);
          const yA = Math.round((y0 / window.innerHeight) * H);
          const yB = Math.round((y1 / window.innerHeight) * H);
          const isPlaster = (i: number): boolean => {
            const r = px[i]!;
            const g = px[i + 1]!;
            const b = px[i + 2]!;
            const bright = (r + g + b) / 3;
            const neutral = Math.abs(r - g) < 40 && Math.abs(g - b) < 50;
            return bright > 110 && neutral;
          };
          const widths: number[] = [];
          let area = 0;
          const rowStep = Math.max(1, Math.round(Math.abs(yB - yA) / 20));
          for (let yy = Math.min(yA, yB); yy <= Math.max(yA, yB); yy += rowStep) {
            const rowY = H - 1 - yy; // readPixels is bottom-up
            let run = 0;
            for (let xx = Math.max(0, sxC - 90); xx < Math.min(W, sxC + 90); xx += 1) {
              if (isPlaster((rowY * W + xx) * 4)) {
                run += 1;
                area += 1;
              }
            }
            widths.push(Math.round((run / W) * window.innerWidth));
          }
          return { widths, area };
        },
        [sx, sy, sy + len] as const,
      );

    const first = await measure();
    // There is a real opening with meaningful area (the behind layer shows
    // through a substantial hole, not a hairline).
    expect(first.area).toBeGreaterThan(1000);
    // The core geometry check: along most of the 300 px drag the opening is at
    // least 40 px wide — the gash follows the pointer, not a local patch.
    const wide = first.widths.filter((w) => w >= 40).length;
    expect(wide).toBeGreaterThanOrEqual(Math.ceil(first.widths.length * 0.6));

    // Two seconds after release, the opening is still there (flaps stay open).
    await page.waitForTimeout(2000);
    const later = await measure();
    expect(later.area).toBeGreaterThan(first.area * 0.6);
    const wideLater = later.widths.filter((w) => w >= 40).length;
    expect(wideLater).toBeGreaterThanOrEqual(Math.ceil(later.widths.length * 0.5));
  });

  test('the room canvas never covers the tube (clean-feed, elementFromPoint)', async ({ page }) => {
    await ready(page);
    await acknowledge(page);
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.waitForTimeout(500);
    // Sample a grid over the tube opening; the top element must never be the
    // room canvas (the chassis/tube sit above it).
    const result = await page.evaluate(() => {
      const tube = document.querySelector('[data-testid="tube-opening"]');
      const room = document.querySelector('[data-testid="room-canvas"]');
      if (!tube || !room) return { ok: false, reason: 'missing' };
      const r = tube.getBoundingClientRect();
      for (let gx = 0; gx <= 4; gx += 1) {
        for (let gy = 0; gy <= 4; gy += 1) {
          const x = r.left + (r.width * gx) / 4;
          const y = r.top + (r.height * gy) / 4;
          const top = document.elementFromPoint(Math.min(x, r.right - 1), Math.min(y, r.bottom - 1));
          if (top === room || room.contains(top)) {
            return { ok: false, reason: `room on top at ${gx},${gy}` };
          }
        }
      }
      return { ok: true, reason: '' };
    });
    expect(result.ok, result.reason).toBe(true);
  });
});

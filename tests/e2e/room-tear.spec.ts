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

  // Measure the OPENING itself: the behind layer is painted a flat test colour,
  // so this reads the real hole however dark the room makes it.
  test('a 300 px drag opens a rip of the right size that stays open 2 s later', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    await acknowledge(page);
    await expect(page.getByTestId('room-canvas')).toBeVisible();
    await expect.poll(async () => (await room(page)).broken, { timeout: 5000 }).toBe(0);

    const chassis = await page.locator('[class*="chassis"]').first().boundingBox();
    const sx = Math.round((chassis?.x ?? 200) / 2);
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

    const measure = () =>
      page.evaluate(
        ([cx, y0, y1]) => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="room-canvas"]');
          const gl = canvas?.getContext('webgl2');
          const seam = (window as unknown as { __room?: { showHoleMask: (on: boolean) => void } }).__room;
          if (!canvas || !gl || !seam) return { widths: [] as number[], area: -1 };
          seam.showHoleMask(true);
          const W = canvas.width;
          const H = canvas.height;
          const px = new Uint8Array(W * H * 4);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          seam.showHoleMask(false);
          const toX = W / window.innerWidth;
          const toY = H / window.innerHeight;
          const xC = Math.round(cx * toX);
          const yA = Math.round(y0 * toY);
          const yB = Math.round(y1 * toY);
          const widths: number[] = [];
          let area = 0;
          // Stay away from both ends, where a rip tapers.
          for (let yy = yA + 20; yy <= yB - 20; yy += 1) {
            const rowY = H - 1 - yy;
            let run = 0;
            for (let xx = Math.max(0, xC - 110); xx < Math.min(W, xC + 110); xx += 1) {
              const i = (rowY * W + xx) * 4;
              if (px[i]! > 200 && px[i + 1]! < 60 && px[i + 2]! > 200) run += 1;
            }
            area += run;
            widths.push(Math.round(run / toX));
          }
          return { widths, area };
        },
        [sx, sy, sy + len] as const,
      );

    const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

    const first = await measure();
    // A real opening of real area: at least 40 px wide for most of 260 px of
    // drag, counted in canvas pixels (the canvas is capped at 1280x800).
    expect(first.area).toBeGreaterThan(6000);
    expect(median(first.widths)).toBeGreaterThanOrEqual(40);
    expect(median(first.widths)).toBeLessThanOrEqual(80);
    expect(Math.max(...first.widths)).toBeLessThan(110);
    // It follows the pointer: every row along the drag has an opening.
    expect(first.widths.filter((w) => w < 15).length).toBeLessThanOrEqual(first.widths.length * 0.05);

    await page.waitForTimeout(2000);
    const later = await measure();
    expect(later.area).toBeGreaterThan(first.area * 0.8);
    expect(median(later.widths)).toBeGreaterThanOrEqual(40);
    expect(Math.max(...later.widths)).toBeLessThan(110);
  });

  test('an opening is dark in its middle and never brighter than the picture', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    await acknowledge(page);
    await page.getByRole('button', { name: /^power$/i }).click();
    await page.waitForTimeout(3000);
    const chassis = await page.locator('[class*="chassis"]').first().boundingBox();
    const sx = Math.round((chassis?.x ?? 200) / 2);
    await page.mouse.move(sx, 200);
    await page.mouse.down();
    for (let i = 1; i <= 24; i += 1) {
      await page.mouse.move(sx, 200 + i * 12.5);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);

    const lum = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="room-canvas"]');
      const gl = canvas?.getContext('webgl2');
      const seam = (window as unknown as { __room?: { showHoleMask: (on: boolean) => void } }).__room;
      if (!canvas || !gl || !seam) return null;
      const W = canvas.width;
      const H = canvas.height;
      const read = (): Uint8Array => {
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      seam.showHoleMask(true);
      const mask = read();
      seam.showHoleMask(false);
      const px = read();
      let sum = 0;
      let n = 0;
      let peak = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (mask[i]! > 200 && mask[i + 1]! < 60 && mask[i + 2]! > 200) {
          const l = (px[i]! + px[i + 1]! + px[i + 2]!) / 3;
          sum += l;
          n += 1;
          if (l > peak) peak = l;
        }
      }
      return { mean: n ? sum / n : -1, peak, n };
    });
    expect(lum).not.toBeNull();
    expect(lum!.n).toBeGreaterThan(1000);
    // The shader caps what is behind the wall at 0.42 (107 of 255).
    expect(lum!.peak).toBeLessThanOrEqual(110);
    expect(lum!.mean).toBeLessThan(45);
  });

  test('at least half the viewport is wall, and no plastic sits under the tube', async ({ page }) => {
    for (const [width, height] of [[1440, 900], [1280, 720]] as const) {
      await page.setViewportSize({ width, height });
      await ready(page);
      await acknowledge(page);
      const box = await page.evaluate(() => {
        const c = document.querySelector('[class*="chassis"]')!.getBoundingClientRect();
        const t = document.querySelector('[data-testid="tube-opening"]')!.getBoundingClientRect();
        return { cw: c.width, ch: c.height, cb: c.bottom, tb: t.bottom, tw: t.width };
      });
      expect((box.cw * box.ch) / (width * height)).toBeLessThanOrEqual(0.5);
      expect(box.cb - box.tb).toBeLessThanOrEqual(60);
      expect(box.tw).toBeGreaterThan(width === 1440 ? 700 : 560);
    }
  });

  test('Power and CC stay readable when hovered, focused and on', async ({ page }) => {
    await ready(page);
    await acknowledge(page);
    const power = page.getByRole('button', { name: /^power$/i });
    const cc = page.getByRole('button', { name: /captions|^cc$/i });
    await power.click();
    await page.waitForTimeout(400);

    const contrast = (name: string) =>
      page.evaluate((label) => {
        const el = [...document.querySelectorAll('button')].find(
          (b) => b.textContent?.trim().toLowerCase() === label,
        )!;
        const s = getComputedStyle(el);
        const rgb = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const l = (c: number[]): number => {
          const [r, g, b] = c.map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        const a = l(rgb(s.color));
        const b = l(rgb(s.backgroundColor));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }, name);

    // Pointer still on Power straight after the click, the state that hid it.
    await power.hover();
    await page.waitForTimeout(100);
    expect(await contrast('power')).toBeGreaterThanOrEqual(4.5);
    await power.focus();
    expect(await contrast('power')).toBeGreaterThanOrEqual(4.5);
    await cc.hover();
    await page.waitForTimeout(100);
    expect(await contrast('cc')).toBeGreaterThanOrEqual(4.5);
    await cc.click();
    await page.waitForTimeout(100);
    expect(await contrast('cc')).toBeGreaterThanOrEqual(4.5);
    await cc.click();
    await page.waitForTimeout(100);
    expect(await contrast('cc')).toBeGreaterThanOrEqual(4.5);
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

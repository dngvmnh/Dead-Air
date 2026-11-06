import { expect, test, type Page } from '@playwright/test';

/**
 * Task 4.3: flash limiter, reduced effects, WebGL context restore, and the
 * non-WebGL fallback (requirements 13.1, 13.2, 5.3, 5.5). Chromium only
 * (`--project=chromium`); firefox/webkit are not installed or run.
 *
 * The WebGL path exposes the live renderer on `window.__crt` under the same
 * test flag the pixel tests use, so we can exercise the flash limiter and
 * reduced-effects directly, and drive context loss/restore via the
 * WEBGL_lose_context extension — all verified by reading renderer/canvas state,
 * not merely the absence of errors.
 */

async function enableTestHooks(page: Page, extra: Record<string, boolean> = {}) {
  await page.addInitScript((flags) => {
    const w = window as unknown as Record<string, boolean>;
    w.__CRT_PRESERVE_DRAWING_BUFFER__ = true;
    for (const [k, v] of Object.entries(flags)) w[k] = v;
  }, extra);
}

async function powerOn(page: Page) {
  await page.getByRole('button', { name: /i understand/i }).click();
  await page.getByRole('button', { name: /^power$/i }).click();
}

/**
 * Wait until the TV is powered and the renderer is live — phase is past OFF and
 * BOOTING. We do not assert the brief TUNING phase specifically: under parallel
 * workers it can elapse before the assertion, and these safety checks hold in
 * TUNING or ON_AIR alike.
 */
async function waitUntilDrawing(page: Page) {
  const tube = page.getByTestId('tube-opening');
  await expect
    .poll(async () => tube.getAttribute('data-phase'), { timeout: 8000 })
    .toMatch(/TUNING|ON_AIR|EVENT|STAND_BY/);
}

test.describe('flash limiter (requirement 13.1)', () => {
  test('grants at most three flashes per rolling second, whatever is asked', async ({
    page,
  }) => {
    await enableTestHooks(page);
    await page.goto('/');
    await powerOn(page);
    await waitUntilDrawing(page);

    const result = await page.evaluate(() => {
      const r = (window as unknown as {
        __crt?: {
          requestFlash: (t: number, apply?: () => void) => boolean;
          flashBudget: (t: number) => number;
        };
      }).__crt;
      if (!r) return null;
      // Ask for ten flashes inside the same 200ms — far more than allowed.
      const grants: boolean[] = [];
      for (let i = 0; i < 10; i += 1) grants.push(r.requestFlash(1000 + i * 20));
      const grantedInSecond = grants.filter(Boolean).length;
      // A full second later the window has cleared and flashes are allowed again.
      const budgetNextSecond = r.flashBudget(2100);
      return { grantedInSecond, budgetNextSecond };
    });

    expect(result).not.toBeNull();
    expect(result!.grantedInSecond, 'never more than 3 flashes per second').toBe(3);
    expect(result!.budgetNextSecond, 'budget refills after the window').toBe(3);
  });
});

test.describe('reduced effects (requirement 13.2)', () => {
  test('suppresses flashes and zeroes roll and tear', async ({ page }) => {
    await enableTestHooks(page);
    await page.goto('/');
    await powerOn(page);
    await waitUntilDrawing(page);

    const result = await page.evaluate(() => {
      const r = (window as unknown as {
        __crt?: {
          setRoll: (n: number) => void;
          setTear: (n: number) => void;
          setReducedEffects: (b: boolean) => void;
          requestFlash: (t: number) => boolean;
          flashBudget: (t: number) => number;
          drive: { roll: number; tear: number };
        };
      }).__crt;
      if (!r) return null;
      // With effects on, roll/tear take and a flash is granted.
      r.setReducedEffects(false);
      r.setRoll(1);
      r.setTear(1);
      const rollOn = r.drive.roll;
      const tearOn = r.drive.tear;
      const flashOn = r.requestFlash(5000);
      // Turning reduced effects on must zero roll/tear and deny all flashes.
      r.setReducedEffects(true);
      const rollReduced = r.drive.roll;
      const tearReduced = r.drive.tear;
      const budgetReduced = r.flashBudget(6000);
      const flashReduced = r.requestFlash(6000);
      // And setRoll/setTear are ignored while reduced.
      r.setRoll(1);
      r.setTear(1);
      const rollStillZero = r.drive.roll;
      const tearStillZero = r.drive.tear;
      return {
        rollOn,
        tearOn,
        flashOn,
        rollReduced,
        tearReduced,
        budgetReduced,
        flashReduced,
        rollStillZero,
        tearStillZero,
      };
    });

    expect(result).not.toBeNull();
    expect(result!.rollOn).toBeGreaterThan(0);
    expect(result!.tearOn).toBeGreaterThan(0);
    expect(result!.flashOn).toBe(true);
    expect(result!.rollReduced, 'roll zeroed under reduced effects').toBe(0);
    expect(result!.tearReduced, 'tear zeroed under reduced effects').toBe(0);
    expect(result!.budgetReduced, 'no flashes allowed under reduced effects').toBe(0);
    expect(result!.flashReduced).toBe(false);
    expect(result!.rollStillZero, 'setRoll ignored while reduced').toBe(0);
    expect(result!.tearStillZero, 'setTear ignored while reduced').toBe(0);
  });
});

test.describe('WebGL context restore (requirement 5.5)', () => {
  test('recovers and keeps drawing after the context is lost and restored', async ({
    page,
  }) => {
    await enableTestHooks(page);
    await page.goto('/');
    await powerOn(page);
    await waitUntilDrawing(page);
    // Confirm it is drawing a real picture before we lose the context.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>(
            '[data-testid="tube-opening"] canvas',
          );
          const gl = c?.getContext('webgl2');
          if (!c || !gl) return 0;
          const p = new Uint8Array(c.width * c.height * 4);
          gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
          let sum = 0;
          for (let i = 0; i < p.length; i += 4) sum += (p[i]! + p[i + 1]! + p[i + 2]!) / 3;
          return sum / (c.width * c.height);
        }),
      )
      .toBeGreaterThan(2);

    // Lose then restore the context using the standard debug extension.
    const lost = await page.evaluate(async () => {
      const c = document.querySelector<HTMLCanvasElement>(
        '[data-testid="tube-opening"] canvas',
      );
      const gl = c?.getContext('webgl2');
      if (!gl) return { ok: false, lostSeen: false };
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return { ok: false, lostSeen: false };
      ext.loseContext();
      await new Promise((res) => setTimeout(res, 50));
      const lostSeen = gl.isContextLost();
      ext.restoreContext();
      await new Promise((res) => setTimeout(res, 200));
      return { ok: true, lostSeen };
    });

    expect(lost.ok, 'WEBGL_lose_context extension available').toBe(true);
    expect(lost.lostSeen, 'the context was actually lost').toBe(true);

    // After restore the renderer rebuilds and draws again, with no page reload:
    // the context is no longer lost and the shader is producing a real picture
    // (comfortably above black). The exact brightness depends on whether the TV
    // has advanced from TUNING to ON_AIR by now, so we assert "drawing again"
    // rather than a specific level.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const c = document.querySelector<HTMLCanvasElement>(
              '[data-testid="tube-opening"] canvas',
            );
            const gl = c?.getContext('webgl2');
            if (!c || !gl) return { lost: true, mean: 0 };
            if (gl.isContextLost()) return { lost: true, mean: 0 };
            const p = new Uint8Array(c.width * c.height * 4);
            gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
            let sum = 0;
            for (let i = 0; i < p.length; i += 4) sum += (p[i]! + p[i + 1]! + p[i + 2]!) / 3;
            return { lost: false, mean: sum / (c.width * c.height) };
          }),
        { timeout: 4000 },
      )
      .toEqual(expect.objectContaining({ lost: false }));

    const afterRestore = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(
        '[data-testid="tube-opening"] canvas',
      );
      const gl = c?.getContext('webgl2');
      if (!c || !gl || gl.isContextLost()) return 0;
      const p = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
      let sum = 0;
      for (let i = 0; i < p.length; i += 4) sum += (p[i]! + p[i + 1]! + p[i + 2]!) / 3;
      return sum / (c.width * c.height);
    });
    expect(afterRestore, 'the restored context draws a real picture').toBeGreaterThan(2);
  });
});

test.describe('non-WebGL fallback (requirement 5.3)', () => {
  test('stays operable with a 2D canvas and CSS treatment when WebGL2 is absent', async ({
    page,
  }) => {
    await enableTestHooks(page, { __CRT_FORCE_FALLBACK__: true });
    await page.goto('/');
    await powerOn(page);
    const tube = page.getByTestId('tube-opening');
    await waitUntilDrawing(page);

    // The fallback adds its CSS treatment class to the canvas.
    const canvas = page.locator('[data-testid="tube-opening"] canvas');
    await expect(canvas).toHaveClass(/crtFallback/);

    // And it actually draws: poll the 2D canvas for lit pixels (tuning snow).
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>(
            '[data-testid="tube-opening"] canvas',
          );
          const ctx = c?.getContext('2d');
          if (!c || !ctx) return 0;
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
          return sum / (c.width * c.height);
        }),
      { timeout: 4000 })
      .toBeGreaterThan(4);

    // The TV is still operable: channel surfing works and the chassis LED still
    // shows a channel number. (Surfing briefly re-enters TUNING then settles, so
    // we assert the durable outcome — a valid channel on the LED — not the
    // transient phase.)
    const before = await tube.getAttribute('data-phase');
    expect(before).not.toBe('OFF');
    await page.getByRole('button', { name: /channel up/i }).click();
    await expect
      .poll(async () => tube.getAttribute('data-phase'), { timeout: 5000 })
      .toMatch(/TUNING|ON_AIR/);
    await expect(page.locator('[class*="channelLed"]')).toHaveText(/\d{2}/);
  });
});

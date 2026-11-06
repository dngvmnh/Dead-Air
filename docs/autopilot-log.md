# Autopilot Log

Running record of autonomous work on DEAD AIR (tasks 4–16). Each entry: what was
done, how it was checked, and anything left unverified.

## Task 4.1 — CRT renderer: WebGL2 pipeline, uniforms, look presets, procedural static

- Done: Added `src/render/crtShader.ts` (GLSL ES 3.00 vertex+fragment source,
  `UNIFORM_NAMES`, `CrtUniforms`, pure `packUniforms`), `src/render/looks.ts`
  (`broadcast`/`vhs`/`deadair` presets, `uniformsFor`, 960x720 `cappedResolution`),
  and `src/render/CrtRenderer.ts` (WebGL2 pipeline: full-screen triangle, per-frame
  source upload, rAF loop, capped-resolution resize, look/static/power/source knobs).
  Wired the renderer onto the existing tube `<canvas>` in `Screen.tsx`, driven by
  TV phase. All CRT effects (curvature, scanlines, shadow mask, bloom, chromatic
  aberration, noise, vignette, rolling interference) are uniform-driven in the
  shader; procedural static is a time-seeded hash in-shader (no texture). No DOM/CSS
  effects on the tube or ancestors. `CrtRenderer.create()` returns null when WebGL2
  is unavailable, leaving the fallback seam for task 4.3.
- Checked: `npm test` 63 passed (incl. 13 looks + 8 shader unit tests, fast-check
  property on the resolution cap). `npm run lint` clean. `npm run build` clean,
  JS 76.39 KB gzip / CSS 2.38 KB gzip (within 300 KB budget). Browser:
  `npx playwright test --project=chromium` 2 passed — reads tube canvas pixels via
  its own WebGL2 context and asserts the shader actually drew static (lit fraction
  > 0.3, mean luminance > 16, many distinct luminance buckets), internal size
  <= 960x720, and a black canvas while OFF. Chromium only; firefox/webkit not run.
- Decisions made alone: set `preserveDrawingBuffer: true` on the WebGL2 context so
  the e2e pixel readback is deterministic (standard for canvas readback, negligible
  cost; reversible). Per-phase power/static in `Screen.tsx` are steady placeholders
  pending task 4.2's animated envelopes.
- Unverified: 60 fps at 960x720 on integrated graphics (belongs to task 22.1,
  performance); `setSource` path is wired but unused until owned sources arrive in
  Milestone 2.

## Task 4.2 — CRT renderer: boot/shutdown via uPower, tuning transitions

- Mode: implemented directly in chat. The `spec-task-execution` subagent was
  tried once and returned "Agent not found in registry"; per the resume
  instructions I proceeded directly with the same quality rules.
- Done: Added `src/render/envelope.ts` (pure, no DOM/GL): `progress`,
  `smoothstep`, `rampValue`, and `bootDrive`/`shutdownDrive`/`isComplete`.
  Boot warms up uPower 0->1 and uncollapses uCollapse 1->0 (<=1500ms, req 1.3);
  shutdown collapses uCollapse 0->1 and darkens uPower 1->0 (<=800ms, req 1.4);
  tuning pins uStatic=1 (350-700ms, req 2.3). Extended `CrtRenderer` with
  `startBoot`/`startShutdown`/`setTuning` advanced each frame by the existing rAF
  loop, plus a `currentEnvelope`/`drive` read-back for tests. Added
  `src/app/timing.ts` as the single source of truth for BOOT_MS/SHUTDOWN_MS/
  TUNE_MS (mirrors tokens.css) and pointed `useTelevision` at it. `Screen.tsx`
  now drives the renderer from phase transitions (boot on BOOTING, shutdown on
  OFF-from-powered, tuning hold during TUNING) instead of steady per-phase
  values. All transitions are shader-driven; no DOM/CSS effects on the tube.
- preserveDrawingBuffer: removed from the production WebGL2 context. The renderer
  now defaults it to false and exposes it only through `CrtRenderer.create(canvas,
  { preserveDrawingBuffer })`. Tests opt in via a `window.__CRT_PRESERVE_DRAWING_
  BUFFER__` flag set in a Playwright init script; production never sets it.
- Checked: `npm test` 78 passed (15 new envelope unit tests incl. fast-check
  properties: progress in [0,1], smoothstep monotonic, rampValue clamps at
  endpoints and is monotonic, boot/shutdown endpoints and direction). `npm run
  lint` clean. `npm run build` clean, JS 76.90 KB gzip (within budget). Browser:
  `npx playwright test crt-renderer --project=chromium` 4 passed via canvas
  pixel readback (not just no-errors) — static draws (meanLum > 16, litFraction
  > 0.3, many luminance buckets, size <= 960x720); OFF stays black; BOOTING
  brightens over time; power-off dims below on-air and the collapse keeps the
  centre line at least as lit as the top before going black. Chromium only;
  firefox/webkit not installed or run. Used expect.poll so the pixel proofs are
  deterministic under parallel workers.
- Decisions made alone: (1) Added `src/app/timing.ts` to avoid a third divergent
  copy of the boot/tune durations; SHUTDOWN_MS=700 matches the --shutdown-ms
  token (reversible). (2) Smoothstep easing for the envelopes (cosmetic, within
  spec; reversible). (3) Exposed the renderer on `window.__crt` only under the
  test flag as a test seam; production never sets the flag. (4) Diagnosed an
  initial e2e flake as a parallel-worker sampling race (meanLum 7.9 vs 95 when
  isolated) and fixed it with polling rather than loosening thresholds; removed
  the temporary diagnostic spec.
- Unverified: 60 fps at 960x720 on integrated graphics (task 22.1). Real owned
  source textures arrive in Milestone 2; shutdown/boot were exercised over a
  black source only.

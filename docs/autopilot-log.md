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

## Task 4.3 — flashLimiter, reduced effects, context restore, non-WebGL fallback

- Mode: implemented directly in chat (the spec-task-execution subagent was tried
  once and is still unavailable in the registry).
- Done:
  - `src/render/flashLimiter.ts` + tests: a pure rolling-window limiter capping
    luminance flashes at 3 per second (requirement 13.1), with a `setSuppressed`
    for reduced effects. Every flashing effect must call it; nothing can bypass.
  - `CrtRenderer`: added `setReducedEffects` (zeroes roll/tear, suppresses the
    limiter — req 13.2), `requestFlash`/`flashBudget` (the single flash gate),
    and gated `setRoll`/`setTear` that no-op under reduced effects. Added
    WebGL context-loss handling: `webglcontextlost` calls preventDefault and
    pauses drawing; `webglcontextrestored` rebuilds program/VAO/texture/uniform
    locations (requirement 5.5, no page reload). GL objects are no longer
    readonly so they can be rebuilt.
  - `src/render/Renderer.ts`: shared interface implemented by both renderers.
  - `src/render/FallbackRenderer.ts`: 2D-canvas fallback used when WebGL2 is
    unavailable (requirement 5.3). Draws the source/snow dimmed by the same pure
    boot/shutdown envelopes, and adds a `crtFallback` CSS treatment class
    (scanline gradient + inset vignette in global.css — a surface treatment on
    the picture element, applied only on the owned-source fallback path, never
    over a YouTube player). `Screen` now selects CrtRenderer, else FallbackRenderer,
    and keeps reduced-effects in sync; `Chassis` passes the reducedEffects setting.
- Checked: `npm test` 86 passed (8 new flashLimiter tests incl. a fast-check
  property that NO rolling 1s window ever exceeds 3 grants). `npm run lint`
  clean. `npm run build` clean, JS 77.91 KB gzip (within budget). Browser:
  `npx playwright test --project=chromium` 8 passed (all specs), including a new
  `crt-safety.spec.ts` that drives the live renderer via a test-only window hook:
  flash limiter grants exactly 3/second and refills after the window; reduced
  effects zeroes roll/tear and denies all flashes and ignores setRoll/setTear;
  WEBGL_lose_context loses then restores the context and the canvas draws again
  without reload; and forcing the fallback shows the crtFallback class, draws 2D
  pixels, and the TV stays operable (surf still updates the LED). Chromium only;
  firefox/webkit not installed or run.
- Decisions made alone: (1) Added `src/render/Renderer.ts` interface and a
  `window.__CRT_FORCE_FALLBACK__` test flag so the fallback path is exercisable
  in-browser; production never sets the flag (reversible). (2) Fallback CSS
  treatment is a global `.crtFallback` class (the renderer applies a literal
  class name, which CSS Modules would otherwise hash); scoped to the fallback
  canvas only. (3) Relaxed the safety e2e to wait for "powered and drawing"
  rather than the brief TUNING phase, after seeing parallel-worker flakiness;
  this does not weaken the assertions (the checks hold in TUNING or ON_AIR).
- Unverified: real GPU driver context-loss (as opposed to the debug extension)
  is not exercised; actual cross-browser fallback on a device genuinely lacking
  WebGL2 (only simulated via the force flag); 60 fps budget (task 22.1).

## Task 5.1 — Procedural AudioEngine (gesture unlock, buses, limiter, cues)

- Mode: implemented directly in chat (spec-task-execution subagent still
  unavailable in the registry).
- Done: Added `src/audio/AudioEngine.ts`. Web Audio graph: a looping white-noise
  source → static gain → SFX bus → master gain → DynamicsCompressor limiter →
  destination (design §11). The AudioContext is created and resumed on the POWER
  gesture (`unlock()`), with an injectable context factory so the graph is
  unit-testable. Procedural cues synthesised in code — tuning click, boot thunk,
  power-off collapse (requirement 12.1, no audio files). `setStatic` mirrors the
  renderer's uStatic so the snow heard matches the snow seen. Volume/mute apply
  to the master gain (requirement 12.3). `createAnalogChain()` builds the
  band-pass + saturation chain (≈200 Hz–8 kHz) ready for Milestone-4 file audio.
  Wired into `useTelevision`: unlock+boot on the POWER effect, tuning click +
  full static on startTuning, faint bed on startSource, hiss on standBy,
  power-off cue + context suspend on powerOff, snow cleared on stopAll; a
  settings effect keeps volume/mute in sync; the context is closed on unmount.
  Audio is non-critical — if Web Audio is unavailable (jsdom or a locked-down
  browser) the unlock rejection is caught and the TV runs silently.
- Checked: `npm test` 98 passed (12 new AudioEngine tests using a fake
  AudioContext: gesture unlock→running, idempotent re-unlock, graph topology
  master→limiter→destination with static source looping, volume/mute math and
  clamping, one-shot cues create+start+stop oscillators, no-throw before unlock,
  static gain raises/falls, analog chain = 2 biquads + shaper, suspend/close
  lifecycle). `npm run lint` clean. `npm run build` clean, JS 79.31 KB gzip
  (within the 300 KB budget). Browser: `npx playwright test --project=chromium`
  10 passed, incl. a new `audio.spec.ts` proving real-browser behaviour jsdom
  cannot — the AudioContext actually reaches 'running' after the POWER gesture,
  and mute drops the effective master gain to zero. Chromium only.
- Decisions made alone: (1) Exposed the engine on `window.__tvAudio` under the
  existing test flag as a test seam (production never sets the flag; reversible).
  (2) Capped Playwright workers (1 on CI, 2 locally) and added one local retry.
  Running ~10 WebGL+AudioContext tests across 8 tabs on a single dev server
  starved backgrounded tabs' rAF loops, stalling canvas rendering and causing
  pixel-sample flakes/timeouts; limiting workers fixed it deterministically
  without weakening any assertion. This is a test-infra change, not a product
  change, and is reversible. (3) Hardened the CRT-renderer e2e to track the
  brightest static frame via polling rather than catching the brief TUNING/
  BOOTING phase label.
- Unverified: actual audibility/mix quality (no automated assertion possible —
  belongs to the manual checklist, task 22.2). The analog chain and voice stems
  are built but not yet driven by real sources (Milestone 4 / task 15).

## Task 6 — Milestone 1 checkpoint

- Mode: implemented directly in chat.
- Done: Added `tests/e2e/milestone1-checkpoint.spec.ts`, the end-to-end proof
  that the television, CRT renderer and audio work together: POWER on → boot →
  default channel 02; the AudioContext reaches 'running' (sound is produced);
  surf the full cycle 02→04→07→13→02, each hop showing static on the canvas
  (verified via pixel readback, brightest-frame polling) with the chassis LED
  tracking the channel; POWER off collapses the picture to black and the audio
  context is no longer running.
- Checked: `npm test` 98 passed (the checkpoint's explicit requirement).
  `npm run lint` clean. `npm run build` clean (79.31 KB gzip, within budget).
  Browser: `npx playwright test --project=chromium` 11 passed including the new
  checkpoint. Chromium only; firefox/webkit not installed or run.
- Decisions made alone: none beyond reusing the existing window test hooks.
- Unverified: audible sound quality (manual checklist, task 22.2).

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
## Task 7.1 — Content schema and types (Zod, design §4 and §6)

- Mode: direct implementation. The `spec-task-execution` subagent was tried
  once and is not in the registry (`agent 'spec-task-execution' not found`);
  per the resume instructions I proceeded directly with the same quality rules.
  This work was already present uncommitted in `src/content/`; this entry
  reconciles and verifies it.
- Done: `src/content/schema.ts` defines the Zod schemas for the catalogue and
  scene content (requirement 14, design §4/§6): channel id, look, rights basis,
  strict `rightsSchema`, the discriminated `itemSchema` (scene/file/youtube) with
  positive integer `durationMs`, `channelSchema`, and the scene layer union
  (image/text/ticker/rect/noise) plus keyframes, captions, audio cues and
  `LayerWhen` (visit/act bounds). Inferred `*Input` types are exported, plus the
  `toChannel`/`toItem`/`toRights` bridges that normalise Zod's `T | undefined`
  to the exact-optional core types in `src/core/types.ts`, so any schema/core
  drift fails to compile at the bridge rather than at a call site. Zod lives in
  `content`, keeping `core` dependency-free. `schema.test.ts` has 20 tests.
- Checked: `npm test` 118 passed (incl. 20 schema tests). `npm run lint` clean.
  `npm run build` clean, JS 79.31 KB gzip (within the 300 KB budget).
- Decisions made alone: none (verification/reconciliation of pre-existing work).
- Unverified: the validator that consumes these schemas and the depth/release
  rules are task 7.2 (next).
## Task 7.2 — Catalogue validator (`validate-catalog.ts`, `--release`, rule tests)

- Mode: direct implementation (the `spec-task-execution` subagent was tried once
  and is still absent from the registry: `agent 'spec-task-execution' not found`).
- Done:
  - `src/content/validateCatalog.ts`: a pure `validateCatalog(input, {release})`
    returning `{ ok, errors[] }`, so every rule is unit-testable with in-memory
    fixtures and no filesystem (design §13 "each failing rule"). It parses the
    authored JSON through the Zod schemas (rule 14.1 schema validity), then
    applies the cross-cutting rules: unique item/scene/event ids, durations > 0,
    references resolve (scene items → scenes, event `scene` steps → scenes, file
    urls / captions / station cards / scene image layers / audio cues / voice
    urls → local assets when a local-asset set is supplied), rights present
    (14.2), no `mid-item` event eligible on a channel carrying a YouTube item
    (14.3, "any" channels included), channel 13 only `original`/`ai-generated`
    and no YouTube (14.4). Under `--release` it also rejects `placeholder` items
    (14.5) and enforces requirement 4 depth: ≥30 min per channel (4.1) and ≥4
    interstitials on channels 02/04/07 (4.2). Exported the thresholds
    (`MIN_CHANNEL_MS`, `MIN_INTERSTITIALS`, `INTERSTITIAL_CHANNELS`).
  - `src/content/schema.ts`: added the event schemas the validator needs —
    `seamSchema`, a recursive `conditionSchema` (z.lazy for all/any/not),
    `eventStepSchema` (discriminated on `do`), and `horrorEventSchema`, plus
    inferred types (design §9).
  - `scripts/validate-catalog.ts`: the `npm run validate:catalog` CLI. Reads
    `src/content/catalog/*.json`, `src/content/scenes/*.json`,
    `src/content/events/*.json` (array or `{events:[...]}`), and the real asset
    set under `public/media`; runs the validator; prints a summary and every
    failing `[rule] where: message`; exits non-zero on failure. Content is
    authored in later tasks, so missing dirs are warned-and-treated-as-empty,
    not fatal. Local-asset resolution is only enforced once `public/media`
    exists (before then an empty set would false-fail every reference).
- Checked: `npm test` 148 passed (24 new validator tests covering every failing
  rule + the release depth rules, 6 new event-schema tests). `npm run lint`
  clean. `npm run build` clean (JS unchanged at 79.31 KB gzip; `tsc -b`
  type-checks `scripts/**` via tsconfig.node.json under
  exactOptionalPropertyTypes, so the script + its import are covered). CLI:
  `npm run validate:catalog` and `-- --release` both run and exit 0 on the
  current (empty) tree; a temporary bad-channel fixture was used to prove the
  CLI exits 1 and prints the failing rule, then removed.
- Decisions made alone: (1) npm 10 strips `--release` before the script sees it
  (confirmed: a positional arg forwards, `--release` does not), so the script
  accepts the flag from argv OR npm's `npm_config_release` env var — both
  `tsx … --release` and `npm run validate:catalog -- --release` now select
  release mode (reversible; it only widens detection). (2) Asset-reference
  checking is skipped while `public/media` is absent, to avoid false failures
  before art lands; it switches on automatically once the dir exists. (3) Added
  a channel-13 "no YouTube item" check under 14.4 (ch13 is owned-media only;
  a YouTube item there also can't be original/ai-generated). All reversible.
- Unverified: the validator has no real catalogue to run against yet (channels,
  scenes, events are authored in tasks 10/13/14/15); it is exercised only by
  fixtures and the temporary probe. End-to-end release gating over real content
  is proven when that content exists.
## Task 8 — Broadcast clock (`resolveBroadcast`, design §5, requirement 3)

- Mode: direct implementation (the `spec-task-execution` subagent is still
  absent from the registry; also recovered mid-task from a lost backend
  connection — clock.ts and the Resolved type had landed, the test had not,
  so I verified the tree then wrote the test and ran the gate).
- Done:
  - `src/core/types.ts`: added the `Resolved` interface (item, filtered index,
    `0 <= offsetMs < durationMs`, `remainingMs`).
  - `src/core/clock.ts`: pure `resolveBroadcast(channel, nowMs, isPlayable)`.
    Filters the rundown with `isPlayable` (dead-item drop, req 3.4); returns
    null when nothing is playable; `position = floorMod(nowMs - epochMs, total)`
    (floored modulo so pre-epoch times still land inside the loop); linear scan
    over cumulative durations. No Date.now / Math.random — time is an argument
    (tech.md core purity).
- Checked: `npm test` 163 passed (15 new clock tests: 9 example-based incl.
  boundary crossing, period wrap, pre-epoch, shifting epoch, dead-item drop with
  filtered index; 6 fast-check properties — offset in [0,dur) with
  remaining=dur-offset>0, one-for-one advance inside an item, boundary
  continuity (next starts at 0 at now+remaining), periodicity resolve(now) ==
  resolve(now+total), determinism/req 3.4, and null iff nothing playable).
  `npm run lint` clean. `npm run build` clean (JS unchanged, 79.31 KB gzip —
  core is already imported by the app graph; the clock is tree-shaken until
  wired in task 10).
- Decisions made alone: none of consequence; `index` is deliberately the index
  into the FILTERED (playable) rundown, matching design §5's Resolved and the
  dead-item semantics, and asserted as such in the tests.
- Unverified: real continuity end-to-end (leave a channel, return 60s later)
  is task 11's mocked-clock e2e; here the clock is proven in isolation.
## Task 9 — Scene system (renderScene, LayerWhen, PlaybackAdapter, SceneAdapter)

- Mode: direct implementation (the `spec-task-execution` subagent is still
  absent from the registry).
- Done:
  - `src/core/scene.ts` (pure, no DOM): `layerVisible` (LayerWhen visit/act
    inclusive bounds, requirement 8.3), `sampleKeyframes` (lerp numeric fields,
    hold a one-sided field, step `text`, hold first/last outside the track), and
    `activeCaptions` (half-open `[atMs, endMs)` windows, requirement 13.3).
    `Keyframe`/caption types are aliased to the schema's inferred types so the
    renderer passes parsed scene data straight in under exactOptionalPropertyTypes.
  - `src/render/sceneRenderer.ts`: `renderScene(ctx2d, program, tMs, vars, opts)`
    — the thin drawing shell over the pure helpers (design §6/§10 step 1,
    requirement 3.3). Opaque black base, then each visible layer
    (image/text/ticker/rect/noise) in order, then a caption band. Time-
    addressable: a pure function of `tMs` with no retained state (ticker and
    noise are periodic/seeded in `tMs`). A missing image draws a labelled
    `[src]` placeholder so missing media never crashes the TV (tech.md). No
    glow/curvature/scanlines here — all screen effects stay in the shader; this
    only paints the flat picture that becomes the shader's source texture.
  - `src/playback/PlaybackAdapter.ts`: the `PlaybackAdapter` interface and
    `AdapterEvent` union from design §6, plus a `SceneContext` (scene lookup,
    preloaded images, visit/act vars, `setSource`, injected `now()`).
  - `src/playback/SceneAdapter.ts`: plays a scene item onto an offscreen canvas
    and publishes it via `ctx.setSource`. rAF and the canvas factory are
    injectable so it runs under jsdom. Starts at the clock-given offset
    (continuity, req 3.2), advances one-for-one with the injected clock, loops a
    short scene within the item, emits playing/ended (once)/paused/error, and a
    missing scene emits a non-fatal error and clears the source (degrade to
    static).
- Checked: `npm test` 192 passed (29 new: 13 scene-core incl. a fast-check
  opacity-bounds property, 8 renderer tests via a recording fake 2D context —
  jsdom has no real 2D ctx — asserting the primitive/skip/placeholder/caption
  behaviour and determinism, 8 SceneAdapter tests via a controllable clock+frame
  pump). `npm run lint` clean. `npm run build` clean (JS unchanged, 79.31 KB
  gzip; the scene code is tree-shaken until wired in task 10). Fixed one
  exactOptionalPropertyTypes build error by aliasing the core keyframe/caption
  types to the schema's inferred types (caught by `tsc -b`, then green).
- Decisions made alone: (1) scene coordinates are in the internal 960×720 space
  (reuses the render cap constants). (2) `renderScene` takes preloaded bitmaps
  by `src`; the SceneAdapter will own preloading when channel 02 is authored
  (task 10). (3) Ticker/noise are deterministic functions of `tMs` to keep
  scenes seekable. All reversible.
- Unverified: real on-screen pixels (the scene canvas feeding the shader and
  showing on the tube) land in task 10 with the first committed Playwright pixel
  test; here the scene path is proven by fake-context and injected-clock unit
  tests only.
## Task 10 — Channel 02 rundown + useTelevision wiring (first on-screen programme)

- Mode: direct implementation (the `spec-task-execution` subagent is still
  absent from the registry).
- Done:
  - Content (10.1): `src/content/catalog/ch02.json` (KDA Nightly News) with six
    scene items — station ID, Bulletin A, council notice, forecast, stay-tuned
    bumper, late station ID — every item `placeholder: true`, `rights.basis`
    `original`, from `docs/media-bible.md` (fictional Hollow Creek / KDA-TV).
    Five scene programmes under `src/content/scenes/` (bulletin uses a
    `when`-gated anchor swap: neutral at `maxVisits:1`, staring at `minVisits:2`,
    per the revisit variant). All art is labelled-placeholder (no real images
    yet), captions carry the scripted lines. `src/content/catalog.ts` eagerly
    imports + Zod-validates the JSON at load (throws on malformed content) and
    exposes `getChannel`/`getScene`.
  - Wiring (10.2): `useTelevision` now owns a `SceneAdapter` and a `SceneContext`
    (scene lookup, visit/act vars, `setSource`/`setLook` to the renderer,
    injected `now()`). `startTuning` resolves the clock to decide playable and
    counts the visit; `startSource`/`reResolve` resolve `resolveBroadcast(now)`,
    load+play the scene at its offset, and schedule `ITEM_ENDED` from the clock's
    `remainingMs` so the programme advances with no user action (requirement
    3.3). `stopAll`/`powerOff`/unmount stop playback and clear the timer.
    `Screen` gained an `onRendererReady` seam (threaded through `Chassis`) so the
    orchestrator can publish the scene canvas to the renderer; all screen effects
    stay in the shader (the scene paints a flat picture that becomes the shader's
    source texture — no DOM styling on the tube).
- Checked: `npm test` 192 passed. `npm run lint` clean. `npm run build` clean
  (JS 110.31 KB gzip — up from 79.31 because the catalogue loader pulls Zod into
  the app bundle for load-time validation; well within the 300 KB budget).
  `npm run validate:catalog` passes (1 channel, 5 scenes). Browser: a new
  committed `tests/e2e/channel02.spec.ts` (Chromium only, 2 tests) reads the
  tube canvas via WebGL2 pixel readback and asserts the scene actually drew
  through the shader — lit (meanLum > 14, litFraction > 0.3), structured (> 4
  luminance buckets, not flat), and carrying the navy palette's blue — and that
  the programme advances past the 8s first item without input. Full e2e suite
  13/13 green on chromium (no regression). Chromium only; firefox/webkit not run.
- Decisions made alone: (1) item-end is driven by a clock-derived `setTimeout`
  (not only the adapter's rAF `ended`) so continuity holds if a background tab
  throttles rAF; the adapter's `ended` also dispatches, both token-guarded so a
  stale session can't advance the current one. (2) Dispatch (`sendRef`) is kept
  local to `runEffects`; `startResolvedSource` is dispatch-free and returns
  `remainingMs`, which was required to satisfy the new `react-hooks/immutability`
  lint rule (a `useCallback` reading `sendRef` plus the effect writing it
  tripped it). (3) A minimal per-channel visit map stands in for viewer memory
  until task 12; act is 0 until escalation (Milestone 3). All reversible.
- Unverified: real scene art (placeholders only), audio mix, and the full
  leave-and-return continuity assertion (that is task 11's mocked-clock e2e,
  next). Non-scene (file/YouTube) items are treated as unplayable for now
  (Milestone 4).
## Task 11 — Milestone 2 checkpoint (leave/return continuity, mocked clock)

- Mode: direct implementation (the `spec-task-execution` subagent is still
  absent from the registry).
- Done:
  - `src/core/clock.ts`: added `broadcastPosition(channel, nowMs, isPlayable)`
    returning the absolute looped position (`0 <= pos < total`), the
    item-boundary-independent measure of "how far the programme has run".
  - `src/app/useTelevision.ts`: a test-only `window.__tv` seam
    (`channel()`, `broadcastPositionMs()`), published only under the existing
    preserve-drawing-buffer flag; production never exposes it.
  - `tests/e2e/milestone2-checkpoint.spec.ts` (Chromium only): installs
    Playwright's fake clock, powers on to ON_AIR on channel 02, records the
    broadcast position, surfs away to channel 04 (stand-by, no ch02 timers),
    `fastForward`s 60s of wall-clock time, returns to channel 02, and asserts
    the position advanced ~60s. Because the position is an offset into the 92s
    rundown loop, the assertion compares the FORWARD delta modulo the period, so
    a 60s advance reads correctly even when it wraps.
- Checked: `npm test` 195 passed (3 new `broadcastPosition` tests incl. a
  fast-check continuity property: forward delta mod period == dt mod period).
  `npm run lint` clean. `npm run build` clean (JS 110.38 KB gzip, within budget).
  Browser: the new checkpoint passes on chromium, and the full e2e suite is
  14/14 green on chromium. Chromium only; firefox/webkit not run.
- Decisions made alone: the continuity assertion is forward-delta-mod-period,
  not a raw subtraction — the fake clock's absolute time does not start the loop
  at 0, so a raw delta wraps and reads negative. The mod-period form is the
  correct, not weakened, continuity check (it is exactly what the clock
  guarantees). Reversible.
- Unverified: nothing new for this checkpoint; it proves the clock → adapter →
  re-resolve continuity directly. Milestone 3 (viewer memory, director, channels
  04/07/13, sign-off) is next, ending at the task 16 MVP checkpoint.

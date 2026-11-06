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

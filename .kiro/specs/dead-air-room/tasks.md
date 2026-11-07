# Implementation Plan: DEAD AIR Room

Work in order. Run after each numbered task: `npm test`, `npm run lint`, `npm run build`, `npm run validate:catalog`, `npx playwright test --project=chromium`. Commit and push each task with Conventional Commits and no AI trailer. Log each in `docs/autopilot-log.md`. Do not start `dead-air-tv` task 17 from this plan.

Tick a task only when the behaviour has been seen in a real browser, not because state or a mock changed.

## Phase A: Corrections

- [x] 1. MVP corrections
  - [x] 1.1 Sign-off static at 0.05 or less, for the full 8 seconds.
  - [x] 1.2 E02 cooldown, so it can't repeat within minutes.
  - [x] 1.3 `DEMO_DIVISOR` = 8. Remove the hard-coded 6 in `core/director.ts`, and update tests and comments.
  - [x] 1.4 Stop test runs modifying committed files. Write screenshots only when `UPDATE_SCREENSHOTS=1`.
  - _Requirements: 9.1–9.3, 9.5_

## Phase B: Tear the wall

- [x] 2. Sheet simulation
  - [x] 2.1 Implement `core/tearSheet.ts`, with unit tests and the fast-check properties in design section 2.
  - [x] 2.2 Measure step cost and record the chosen grid size.
  - _Requirements: 1.1, 1.2, 1.4, 10.2_
- [x] 3. Room canvas and wall tear
  - [x] 3.1 Add the room canvas behind the chassis, plus `tearRenderer`: mesh, lighting, fibre edge, flap shadow.
  - [x] 3.2 Add pointer input with multi-touch, idle corner, edge lift, and grab cursor.
  - [x] 3.3 Add rip audio, the `T` key, context restore, and the 2D fallback.
  - [x] 3.4 Real-WebGL Playwright tests: a drag changes pixels in the region, two pointers work, notice blocks tearing, and a check that the room canvas cannot cover the tube (`elementFromPoint`).
  - _Requirements: 1.1–1.9, 8.2, 8.5–8.7_
- [x] 4. Room look
  - [x] 4.1 Bake wallpaper and room objects, and record authorship in `docs/room-assets.md`.
  - [x] 4.2 Implement `core/roomState.ts` with tests, light from picture, and ambient by act.
  - _Requirements: 5.1–5.4, 5.7, 10.3_
- [x] 5. **STOP: Visual checkpoint.** Commit screenshots of the room in Acts 0 and 3, and of a tear, plus a short screen recording if possible. Stop and report. A person must judge whether it looks good and frightening before more is built on it.

- [x] 5a. **Make the room and tear read.** Task 5 passed tests but failed human review: the room is not good-looking or frightening. Keep every YouTube, clean-feed and chassis rule.
  - [x] 5a.1 Composition: at 1280×720 and 1440×900, at least 50% of the viewport is exposed wall. Constrain the chassis by viewport height as well as width, and compact the control column so it does not set the height. Controls stay fully operable. Keep the phone layout working.
  - [x] 5a.2 Room light: the TV casts a visible pool of light on the wall. Near the set, wallpaper, bats, pumpkins, garland and objects are clearly readable, falling to darkness at the viewport edges. Move the clock, frame, bowl and window into exposed bands so they are not hidden behind the chassis.
  - [x] 5a.3 Tear mechanics: the gash follows the pointer. Break constraints along the pointer's path, within one cell of it, at normal and fast drag speeds — not only by pulling one grabbed node. Flaps peel open and stay open after release. On 1440×900, a 300 px drag leaves an opening at least 40 px wide along most of its length.
  - [x] 5a.4 Tear look: implement design §3 in full — noise-eroded edges, a pale fibre band, flap lighting, and a drop shadow onto the behind layer. Edges must not look polygonal at the current grid. Keep the simulation under 3 ms, using render-side subdivision or a tear mask if needed.
  - [x] 5a.5 Behind contrast: the behind layer contrasts clearly with the wallpaper — lighter plaster and lath in Act 0 make a tear obvious at a glance.
  - [x] 5a.6 Tests: add a real-WebGL Playwright test using stepped pointer moves. It measures the opening's area and shape along the drag path, and confirms the opening is still there 2 s after release. A changed-pixels-only test is not enough.
  - _Requirements: 1.1–1.9, 5.1–5.4, 5.7, 8.2, 10.2, 10.3_

- [x] 5b. **Make the tear dark and proportionate.** Task 5a got the mechanics right, but holes were panel-sized and brighter than the room.
  - [x] 5b.1 Opening size: a 300 px drag at normal speed leaves about 40 to 80 px on 1440×900, widest part under 110 px. Flaps stay open.
  - [x] 5b.2 The behind layer uses the same ambient, TV pool and falloff as the wall, is never brighter than the picture, and is darkest in the middle of a hole.
  - [x] 5b.3 Lath is narrow, irregular strips with dark gaps; plaster is patchy.
  - [x] 5b.4 No spikes in openings. The cause was one node being hauled across the wall and shoves accumulating on freed nodes; both are fixed in the geometry.
  - [x] 5b.5 Tube as large as 50% exposed wall allows at 1440×900 and 1280×720, with no empty plastic below it.
  - [x] 5b.6 Power and CC stay readable on hover, on focus and when pressed.
  - [x] 5b.7 Opening test measures the real hole with both width limits and a tighter area floor.
  - _Requirements: 1.1–1.3, 3.3, 5.2, 5.4, 10.2_

## Phase C: Depth

- [x] 6. Behind layer per act, using real viewer values.
  - _Requirements: 3.1–3.4_
- [x] 7. Memory v2
  - [x] 7.1 Add schema version 2 and migration, with tests.
  - [x] 7.2 Store and rebuild strokes. Show repaired tears. Forget me erases everything.
  - _Requirements: 4.1–4.4_
- [x] 8. Figure and objects, moving only in unobserved moments, with tests.
  - _Requirements: 5.5, 5.6_
- [ ] 9. Tube tear
  - [ ] 9.1 Add the tear pass to `CrtRenderer`, and Renderer API with no-op fallback.
  - [ ] 9.2 Enable only on `canvas` surfaces. Disable on sign-off and text steps. Reset at tune and boundary.
  - [ ] 9.3 Add a Playwright test with stub YouTube state proving the tube sheet is disabled and no pointer handler is attached for that source.
  - _Requirements: 2.1–2.5_

## Phase D: The turn

- [ ] 10. E13
  - [ ] 10.1 Add event steps, schema, validator rules, and paths.
  - [ ] 10.2 Add E13 and media bible entry. Room-only steps must not replace the picture.
  - [ ] 10.3 Tests: fires once, chain, cancels on CH and POWER, reduced-motion path, sign-off reachable without it, reload after it.
  - _Requirements: 6.1–6.5, 8.1, 8.3, 8.4_
- [ ] 11. **STOP: Scare checkpoint.** Run a real-clock `/?demo=1` session from fresh memory, surfing CH+ every 15 s. Sign-off must begin within 3 min 30 s, with E13 seen on the way. Commit a recording or screenshots of E13. Stop and report.
  - _Requirements: 9.4_

## Phase E: Reflection

- [ ] 12. Reflection
  - [ ] 12.1 Add the rear-panel control and copy, `REFL` lamp, and controller. No camera request before the click.
  - [ ] 12.2 Add the shader path and visibility rules.
  - [ ] 12.3 Fake-camera tests: no request on load, denied path, tracks stop on off, Forget me, and hidden tab, nothing shown on stubbed YouTube or sign-off, choice not persisted.
  - [ ] 12.4 Add the guard against frame read-back.
  - _Requirements: 7.1–7.11_

## Phase F: Ready to deploy

- [ ] 13. Release check
  - [ ] 13.1 Check budgets: bundle, measured frame time on this machine.
  - [ ] 13.2 Confirm full gate from a clean clone: `npm ci`, then all commands.
  - [ ] 13.3 Do not deploy. Report final hash, results, and everything unverified. Hosting is set up by a person.
  - _Requirements: 10.1–10.4_

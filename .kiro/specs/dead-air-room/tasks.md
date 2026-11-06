# Implementation Plan: DEAD AIR Room

Work in order. Run after each numbered task: `npm test`, `npm run lint`, `npm run build`, `npm run validate:catalog`, `npx playwright test --project=chromium`. Commit and push each task with Conventional Commits and no AI trailer. Log each in `docs/autopilot-log.md`. Do not start `dead-air-tv` task 17 from this plan.

Tick a task only when the behaviour has been seen in a real browser, not because state or a mock changed.

## Phase A: Corrections

- [ ] 1. MVP corrections
  - [ ] 1.1 Sign-off static at 0.05 or less, for the full 8 seconds.
  - [ ] 1.2 E02 cooldown, so it can't repeat within minutes.
  - [ ] 1.3 `DEMO_DIVISOR` = 8. Remove the hard-coded 6 in `core/director.ts`, and update tests and comments.
  - [ ] 1.4 Stop test runs modifying committed files. Write screenshots only when `UPDATE_SCREENSHOTS=1`.
  - _Requirements: 9.1–9.3, 9.5_

## Phase B: Tear the wall

- [ ] 2. Sheet simulation
  - [ ] 2.1 Implement `core/tearSheet.ts`, with unit tests and the fast-check properties in design section 2.
  - [ ] 2.2 Measure step cost and record the chosen grid size.
  - _Requirements: 1.1, 1.2, 1.4, 10.2_
- [ ] 3. Room canvas and wall tear
  - [ ] 3.1 Add the room canvas behind the chassis, plus `tearRenderer`: mesh, lighting, fibre edge, flap shadow.
  - [ ] 3.2 Add pointer input with multi-touch, idle corner, edge lift, and grab cursor.
  - [ ] 3.3 Add rip audio, the `T` key, context restore, and the 2D fallback.
  - [ ] 3.4 Real-WebGL Playwright tests: a drag changes pixels in the region, two pointers work, notice blocks tearing, and a check that the room canvas cannot cover the tube (`elementFromPoint`).
  - _Requirements: 1.1–1.9, 8.2, 8.5–8.7_
- [ ] 4. Room look
  - [ ] 4.1 Bake wallpaper and room objects, and record authorship in `docs/room-assets.md`.
  - [ ] 4.2 Implement `core/roomState.ts` with tests, light from picture, and ambient by act.
  - _Requirements: 5.1–5.4, 5.7, 10.3_
- [ ] 5. **STOP: Visual checkpoint.** Commit screenshots of the room in Acts 0 and 3, and of a tear, plus a short screen recording if possible. Stop and report. A person must judge whether it looks good and frightening before more is built on it.

## Phase C: Depth

- [ ] 6. Behind layer per act, using real viewer values.
  - _Requirements: 3.1–3.4_
- [ ] 7. Memory v2
  - [ ] 7.1 Add schema version 2 and migration, with tests.
  - [ ] 7.2 Store and rebuild strokes. Show repaired tears. Forget me erases everything.
  - _Requirements: 4.1–4.4_
- [ ] 8. Figure and objects, moving only in unobserved moments, with tests.
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

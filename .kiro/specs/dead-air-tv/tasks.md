# Implementation Plan: DEAD AIR Television

Work in order. Each milestone ends in something runnable. Commit after each completed task, using Conventional Commits with no AI trailer or attribution. Never invent YouTube IDs, durations, or source URLs.

## Milestone 1: The television (no media, no YouTube)

- [x] 1. Scaffold the project
  - [x] 1.1 Create the Vite + React + TypeScript app with strict settings, ESLint, Vitest, Playwright, Zod, and fast-check. Add the npm scripts from `tech.md`.
  - [x] 1.2 Create the directory layout from `structure.md`, design tokens, and an import rule stopping `src/core` importing React or using `Date.now`/`Math.random`.
  - _Requirements: 16.1_
- [x] 2. TV state machine
  - [x] 2.1 Implement `core/tvMachine.ts` reducer, effects, and tune tokens as in design section 7.
  - [x] 2.2 Test all transitions, including rapid surfing and POWER from every state.
  - _Requirements: 1.3, 1.4, 2.1–2.4_
- [x] 3. Chassis and controls
  - [x] 3.1 Build Room, Chassis, TubeOpening, LED, POWER, CH+/-, volume, mute, and CC, with accessible names and an ARIA live region.
  - [x] 3.2 Add keyboard shortcuts and the first-run StartNotice.
  - [x] 3.3 Add the rear panel: Reduced Effects, Forget me.
  - _Requirements: 1.1, 1.2, 2.5, 2.6, 13.3–13.5, 15.2_
- [x] 4. CRT renderer
  - [x] 4.1 Implement the WebGL2 pipeline, uniforms, look presets, and procedural static.
  - [x] 4.2 Implement boot and shutdown via `uPower`, plus tuning transitions.
  - [x] 4.3 Implement `flashLimiter` with tests, reduced-effects handling, context restore, and non-WebGL fallback.
  - _Requirements: 5.1–5.5, 13.1, 13.2, 1.4_
- [x] 5. Procedural audio
  - [x] 5.1 Implement AudioEngine: gesture unlock, buses, limiter, static, tuning click, boot and power-off sounds.
  - _Requirements: 12.1, 12.3_
- [x] 6. Checkpoint: POWER on, surf through static across four empty channels with correct LED and sound, POWER off. `npm test` passes.

## Milestone 2: Always-on broadcast (one complete channel)

- [x] 7. Content schema and validator
  - [x] 7.1 Define Zod schemas and types from design sections 4 and 6.
  - [x] 7.2 Implement `scripts/validate-catalog.ts` with `--release`, and tests for each rule.
  - _Requirements: 14.1–14.5_
- [x] 8. Broadcast clock
  - [x] 8.1 Implement `resolveBroadcast` with fast-check properties.
  - _Requirements: 3.1, 3.2, 3.4, 3.5_
- [x] 9. Scene system
  - [x] 9.1 Implement pure `renderScene` and keyframes with image, text, ticker, rect, and noise layers.
  - [x] 9.2 Implement `LayerWhen` for visit and act variants, and captions.
  - [x] 9.3 Implement `PlaybackAdapter` and `SceneAdapter`.
  - _Requirements: 3.3, 8.3, 13.3_
- [x] 10. Channel 02 with placeholder art
  - [x] 10.1 Author the channel 02 rundown from `docs/media-bible.md` using scenes, marked `placeholder: true` where art is temporary.
  - [x] 10.2 Wire `useTelevision`: tune, resolve, play, re-resolve at item end.
  - _Requirements: 3.1–3.3, 4.4_
- [x] 11. Checkpoint: leave channel 02, return 60 s later, and the programme has advanced about 60 s. Add this as an end-to-end test using a mocked clock.

## Milestone 3: Memory and horror

- [x] 12. Viewer memory
  - [x] 12.1 Implement the reducer, act computation, and demo divisor with tests.
  - [x] 12.2 Implement `memoryStore` with versioning, throttling, fallback, session detection, `?reset=1`, and Forget me.
  - [x] 12.3 Track watch time only while visible, on air, and playing.
  - _Requirements: 7.1–7.7, 8.1, 8.2_
- [x] 13. Director
  - [x] 13.1 Implement conditions and templates with tests.
  - [x] 13.2 Implement `decideEvent` with tests and property tests, including the YouTube rule and global gap.
  - [x] 13.3 Implement the event step runner, including captions-only degradation.
  - _Requirements: 9.1–9.7_
- [ ] 14. Channels 04 and 07
  - [ ] 14.1 Author scene rundowns and revisit variants, including moving set objects on 07.
  - _Requirements: 8.3, 8.4_
- [ ] 15. Channel 13 and the ending
  - [ ] 15.1 Build Dead Air programming, history read-back, and voice stem stitching.
  - [ ] 15.2 Implement `flashPrevious` frame capture, with the station card fallback.
  - [ ] 15.3 Implement sign-off, fixed text, power-off, Act 4, and after-hours variants.
  - [ ] 15.4 Add all events from `docs/media-bible.md` to `events.json`.
  - _Requirements: 10.1–10.4, 11.1–11.4, 12.4_
- [ ] 16. Checkpoint: `/?demo=1` reaches sign-off in about three minutes using scenes only, with an end-to-end test using a mocked clock.
  - _Requirements: 16.4_

## Milestone 4: File and YouTube sources

- [ ] 17. FileAdapter
  - [ ] 17.1 Implement video texture input, seek, CORS failure handling, captions, and the analog audio chain.
  - [ ] 17.2 Implement muted-retry autoplay fallback.
  - _Requirements: 4.3, 5.1, 12.2, 12.5_
- [ ] 18. YouTubeAdapter
  - [ ] 18.1 Implement an injectable API loader and a stub `window.YT` for tests.
  - [ ] 18.2 Implement the adapter per `youtube-compliance.md`, with the clean-feed surface and source-switch hide logic.
  - [ ] 18.3 Implement error handling, dead-item tracking, API-unavailable mode, stand-by slate, and autoplay-blocked prompt.
  - [ ] 18.4 Implement pausing on hidden tab, and leaving viewer-initiated pauses alone.
  - _Requirements: 6.1–6.11, 15.3, 15.4_
- [ ] 19. Policy tests
  - [ ] 19.1 Write the `youtube-clean-feed` end-to-end test and the hidden-tab test.
  - [ ] 19.2 Set up `Referrer-Policy` and `Permissions-Policy` headers in hosting configuration.
  - [ ] 19.3 Implement `scripts/check-youtube.ts` (oEmbed; Data API if a key is present).
  - _Requirements: 6.1, 6.2, 6.4, 6.12, 13.6, 14.6_
- [ ] 20. Checkpoint: one channel mixes scene, file, and stubbed YouTube items, and transitions work in every direction.

## Milestone 5: Content and release (needs human input)

- [ ] 21. Real media (team)
  - [ ] 21.1 Produce and replace art and voice per `docs/media-bible.md`. Record `rights`.
  - [ ] 21.2 Curate at least 30 minutes per channel. Humans provide and verify every ID, URL, and rights record.
  - [ ] 21.3 Upload long video to object storage, and confirm CORS and range requests.
  - _Requirements: 4.1, 4.2_
- [ ] 22. Performance and polish
  - [ ] 22.1 Check budgets from `tech.md` and fix regressions.
  - [ ] 22.2 Run the manual cross-browser checklist and a 30-minute soak test.
  - _Requirements: 15.1_
- [ ] 23. Submission
  - [ ] 23.1 Add the agreed open-source licence.
  - [ ] 23.2 Update the README with the live URL, run instructions, and how Kiro was used.
  - [ ] 23.3 Confirm `npm run validate:catalog -- --release` passes and the demo path has no third-party music or footage without clearance.
  - [ ] 23.4 Check the official rules, then record the demo video.
  - _Requirements: 16.1–16.5_

## Stretch (only after task 23)

- [ ] 24. VHS look preset with a tracking-noise playback indicator.
- [ ] 25. A hidden channel reachable only in Act 4.

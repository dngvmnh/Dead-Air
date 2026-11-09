# DEAD AIR and Kiro Crew

DEAD AIR is a haunted television network that runs in the browser. This file explains how
it was built with Kiro Crew, what Kiro Crew did, and where the evidence is in this repo.

- Play it: https://dngvmnh.github.io/Dead-Air/
- Code: https://github.com/dngvmnh/Dead-Air
- Video: https://youtu.be/5ahST7N6Edg

## What the project is

A static web app (React, TypeScript, Vite, a hand-written WebGL2 CRT shader, Web Audio).
You press POWER and surf four always-on channels. The network slowly starts to answer what
you really did. The wallpaper and the picture on the tube can be torn. Jump scares answer
your clicks. At the end the station signs off. No backend, no accounts, nothing leaves the
browser. See `README.md` for the full pitch.

## What Kiro Crew is, and how it was used

Kiro Crew is an agent management layer on top of Kiro. It adds persistent memory, a session
ledger, scheduled jobs, background sub-agents, a browser, and skills. One Kiro Crew session
did the long-running build of this project, working through the Kiro specs in
`.kiro/specs/` one task at a time, with a person reviewing at stop points.

### What the Kiro Crew session did

| Feature | How it was used here |
|---|---|
| Spec-driven task loop | Read steering, then the requirements, design and tasks of `dead-air-tv` and `dead-air-room`. Did the tasks in order. Wrote a failing test first for behaviour changes. Ticked a task only after the behaviour was seen in a real browser. |
| Session ledger | Recorded the goal, the current phase, the next step and the commit hashes. When the context was compacted or the session was resumed, the ledger said exactly where work stood: for example "stopped at task 5, waiting for review". |
| Human checkpoints | The plan has two STOP tasks (the visual checkpoint and the scare checkpoint). The session stopped there, reported hashes, test results, screenshots and anything unverified, and waited. When review failed ("the room is not good-looking or frightening"), it added task 5a to the spec and fixed it. |
| Resource check | Checked memory and CPU headroom before running the full Playwright suite. |
| Real-browser verification | Drove Chromium with real WebGL through Playwright, read pixels back, and looked at screenshots before ticking anything visual. |
| Git and GitHub through the shell | Small Conventional Commits, one per task, pushed to `main`. It checked that the GitHub Pages deploy went green and that the live site and a film range request answered. It followed the repo rename to `Dead-Air`. |
| Run log | Wrote `docs/autopilot-log.md`: for every task, what was done, how it was checked, decisions made alone, and what was left unverified. |
| Upkeep tasks | Removed a feature on request (forced fullscreen), cleaned the docs, wrote `.kiro/missing.md` listing what is still needed, made the Devpost gallery, and drafted the submission text. |

### What it did not use

Be exact: no scheduled jobs, no background sub-agents, and no custom MCP servers were used
for this project. An early attempt to hand a task to a sub-agent named `spec-task-execution`
failed because the agent was not in the registry. The session then did the work directly,
with the same rules, and recorded that in `docs/autopilot-log.md`.

## The Kiro pieces Kiro Crew worked inside

- Specs: `.kiro/specs/dead-air-tv` and `.kiro/specs/dead-air-room` (requirements, design, tasks).
- Steering: `.kiro/steering/` (`product`, `tech`, `structure`, `safety-and-rights`,
  `youtube-compliance`). The session obeyed them: no effect over the YouTube player, no
  camera except the optional switch, no AI trailer in commits.
- Hook: `.kiro/hooks/validate-catalog.json` runs `npm run validate:catalog` when channel or
  event data is saved.
- Property-based tests: 19 `fast-check` properties over the clock, director, memory, startle
  pacer, tear simulation, flash limiter and envelopes.

## Results

- 427 unit tests, over 100 Playwright tests on real WebGL, lint and build clean.
- JavaScript about 162 KB gzip, under the 300 KB budget.
- Tear simulation about 2.2 ms a frame, under the 3 ms budget.
- Deployed to GitHub Pages by `.github/workflows/pages.yml`.

## Where to look

| What | Where |
|---|---|
| The plan the session followed | `.kiro/specs/*/tasks.md` |
| What it did, task by task | `docs/autopilot-log.md` |
| What is still missing | `.kiro/missing.md` |
| Screenshots of the room and tears | `docs/screenshots/`, `docs/devpost-gallery/` |
| Rights for every film | `docs/rights-log.md` |
| Hosting | `docs/hosting.md` |

## Honest limits

The release catalogue check (`--release`) still fails: all programme items are placeholders
and the rundowns are short. YouTube channels have no IDs yet, on purpose. The five public
domain films need a person to watch them in full. All of this is listed in `.kiro/missing.md`.

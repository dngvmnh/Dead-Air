---
inclusion: always
---

# Tech

## Stack

- React + TypeScript (`strict`, `noUncheckedIndexedAccess`) + Vite. Use current stable versions at scaffold time.
- Rendering: hand-written WebGL2 fragment shader. Do not add three.js or a shader framework.
- Audio: Web Audio API. Procedural noise, no audio library.
- State: React `useReducer` for the TV state machine. No Redux. No state library unless a task proves the need.
- Styling: CSS Modules plus design tokens in `src/styles/tokens.css`.
- Tests: Vitest, fast-check (property tests for clock and director), Playwright (end to end).
- Validation: Zod for catalogue and persisted-memory schemas.
- Package manager: npm.
- Hosting: static hosting only. No server, database, or serverless function.

## Architecture rules

- `src/core/` is pure TypeScript. It must not import React, touch the DOM, read `Date.now()`, or call `Math.random()`. Time and randomness are passed in as arguments.
- The broadcast clock is the single source of truth for what is on. Never store "current position" as authoritative state. After any disturbance, re-resolve from the clock.
- All playback goes through the `PlaybackAdapter` interface. No component calls `YT.Player` or `HTMLVideoElement` directly except its adapter.
- Horror events are data in `src/content/events/`, not branching code. Adding an event must not require changing engine code.
- Missing media must never crash the TV. Degrade to static, a slate, or captions.
- Catalogue changes must pass `npm run validate:catalog`.

## Engineering conventions

- Prefer small functions and explicit types. No `any`. No default exports except where a tool requires one.
- Reuse existing modules before adding new ones. Add dependencies only when a task needs them, and justify it in the commit body.
- Comments explain why, not what.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- **Commit messages and pull requests must not contain any AI co-author trailer, "generated with" footer, or AI attribution.**
- Remote: `https://github.com/dngvmnh/Kiroween`. Keep `.kiro/` committed. Never commit media binaries; see `safety-and-rights.md`.

## Environment

- Work in WSL at `~/projects/Kiroween`. Never run the project from `/mnt/c`: it is much slower and has caused test runs to stall.
- Use the Node version in `.nvmrc`, through nvm. Non-interactive shells do not load nvm and fall back to `/usr/bin/node` (v12), so start every command like this:

```bash
source ~/.nvm/nvm.sh && nvm use --silent && npm test
```

- If a command fails strangely, check `node -v` and `command -v npm` first. `npm` must come from `~/.nvm`, not `/mnt/c`.

## Commands

```bash
npm run dev               # Vite dev server
npm run build             # Type-check and build
npm test                  # Vitest
npm run test:e2e          # Playwright
npm run validate:catalog  # Schema, rights and duration checks
npm run check:youtube     # Optional online check of YouTube IDs
npm run lint
```

## Budgets

- JS and CSS under 300 KB gzipped, excluding media.
- Shader holds 60 fps at 960×720 internal resolution on integrated graphics. Internal resolution is capped; it never follows device pixels.
- Time from POWER click to first picture under 1.5 s on a good connection, excluding YouTube load.

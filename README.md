# DEAD AIR

**The haunted television network that never goes off the air — until it notices you.**

DEAD AIR resurrects linear analog television in the browser. You sit in front of a CRT, press POWER, and surf four always-running channels. There is no search, no feed, no pause-and-pick: you tune in to whatever is on, exactly as people did for fifty years. Then, slowly, the network starts responding to what you watched.

**Play it:** https://dngvmnh.github.io/Dead-Air/ (desktop Chrome or Edge, sound on). Add `?demo=1` to reach the ending in about three minutes.

**Watch it:** https://youtu.be/5ahST7N6Edg

**Built with Kiro and Kiro Crew:** see [docs/KIRO_CREW.md](docs/KIRO_CREW.md).

- **Kiroween category:** Resurrection (primary).
- **Interaction:** POWER, CH+, CH-, volume. Understood in three seconds.
- **Backend:** none. Static site, deterministic broadcast clock, local memory.

## What happens around the set

- **The room is part of it.** The wallpaper tears under your pointer, and something is behind it. So is the picture: drag across the tube and it rips.
- **It remembers.** Tears come back next visit, badly mended by someone else. A shadow on the wall moves a step closer whenever you are not looking.
- **Startles answer you.** A jump that comes due waits a few seconds for you to click, change channel or tear something, and lands on that. Keeping still does not help. A pacer keeps them at least 8 seconds apart and at most 4 a minute.
- **The back of the set** has one optional switch. Its camera image never leaves your device and is never recorded.
- Procedural art and sound, public-domain films, no backend.

## Why it is not a five-minute horror game

| Original concept | This project |
|---|---|
| Four 30–60 second clips | Four looping channel rundowns of 30+ minutes each |
| Story ends after a few minutes | Sign-off is a checkpoint; the network returns "after hours" |
| Every second is bespoke horror | Long ordinary programming; horror is scarce and well placed |
| Channel restarts when you return | Channels keep "broadcasting" while you are away |

## The channels

| Ch | Name | Ordinary programming | How it turns |
|---|---|---|---|
| 02 | Nightly News | Bulletins, weather, local reports | Anchor stops reading and looks at the lens |
| 04 | Pumpkin Hour | Cartoons, children's shorts | Characters mention the viewer outside the screen |
| 07 | Midnight Shopping | Infomercials, vintage ads | Set objects move between your visits |
| 13 | Dead Air | Static, test cards, emergency slates | Reads your viewing history back to you |

## Read this in order

| File | Purpose |
|---|---|
| [.kiro/steering/product.md](.kiro/steering/product.md) | Product vision, principles, scope |
| [.kiro/steering/tech.md](.kiro/steering/tech.md) | Stack and engineering rules |
| [.kiro/steering/structure.md](.kiro/steering/structure.md) | Repository layout |
| [.kiro/steering/youtube-compliance.md](.kiro/steering/youtube-compliance.md) | Non-negotiable YouTube embed rules |
| [.kiro/steering/safety-and-rights.md](.kiro/steering/safety-and-rights.md) | Photosensitivity, privacy, media rights |
| [.kiro/specs/dead-air-tv/requirements.md](.kiro/specs/dead-air-tv/requirements.md) | EARS requirements |
| [.kiro/specs/dead-air-tv/design.md](.kiro/specs/dead-air-tv/design.md) | System design |
| [.kiro/specs/dead-air-tv/tasks.md](.kiro/specs/dead-air-tv/tasks.md) | Ordered implementation plan |
| [.kiro/specs/dead-air-room/requirements.md](.kiro/specs/dead-air-room/requirements.md) | The room, tears, startles, reflection (second spec) |
| [docs/media-bible.md](docs/media-bible.md) | Scripts, event copy, asset list, generation prompts |
| [docs/research-notes.md](docs/research-notes.md) | What was verified, with sources, and what still needs checking |

## Run it

```bash
npm ci
npm run fetch:media   # public-domain films from archive.org; needs ffmpeg
npm run dev
```

Checks: `npx tsc --noEmit -p .`, `npx vitest run`, `npm run lint`, `npm run validate:catalog`, `npm run build`, and `npx playwright test --project=chromium` (browser tests on real WebGL). Pushing to `main` deploys to GitHub Pages through `.github/workflows/pages.yml`. Hosting notes: [docs/hosting.md](docs/hosting.md). Build log: [docs/autopilot-log.md](docs/autopilot-log.md).

## Implementing with Kiro

1. Open **this folder** in Kiro as the workspace root, so `.kiro/` is picked up.
2. Confirm the steering files appear under Agent Steering and the spec `dead-air-tv` appears under Specs.
3. Open `tasks.md` and run tasks in order. Milestone 1 needs no media and no YouTube IDs.
4. Do not regenerate `requirements.md` or `design.md` from scratch. Refine them if something proves wrong.

## Team decisions still open

See "Open items" in [docs/research-notes.md](docs/research-notes.md). The most urgent: confirm the deadline and rules on the official Devpost page, and choose an open-source licence.

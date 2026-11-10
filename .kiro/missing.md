# Missing necessities

What the project still needs before a public release or a judged demo. Written
2026-11-08. Standard build and the full test gate are green; everything here is
work a person must finish or decide, or a known limit of the host.

## 1. Content is all placeholder (blocks a release build)

`npm run validate:catalog` passes in standard mode, but `--release` fails with
19 problems. Every catalogue item is `placeholder: true`, and the channels are
far shorter than a real rundown.

- All items on channels 02, 04, 07 and 13 carry `placeholder: true`
  (rule 14.5 rejects these under `--release`).
- Channel lengths are nowhere near the 30-minute floor (rule 4.1): ch02 212 s,
  ch04 331 s, ch07 272 s, ch13 35 s.
- Not enough interstitials (rule 4.2): ch04 has 2, ch07 has 1; four are needed.

Needed: real scene art and longer rundowns, each item's `placeholder` flag
removed once its art is final, and more interstitials on 04 and 07. Re-run
`npm run validate:catalog -- --release` until it passes.

## 2. No YouTube items yet

`youtube-embed` slots are intentionally empty. The project rule is to never
invent a YouTube ID, duration or source URL (`safety-and-rights.md`), so a human
must supply each one. `npm run check:youtube` only checks IDs that already exist.

Needed: a person adds real, embeddable YouTube IDs (if the team wants YouTube
channels at all) and fills their durations and rights, then runs
`npm run check:youtube`.

## 3. Prelinger films need a human watch-through before release

`docs/rights-log.md` lists five public-domain Prelinger clips. They show real
people and may show real shop signs or products. The rights log says a person
must watch each clip in full before the public release or the demo video and
replace any that reads as targeting a real person or product.

Needed: a teammate watches all five clips end to end and signs off or swaps
them.

## 4. No LICENSE file

The repository has no `LICENSE`. A public hackathon submission should state its
licence (code, and how the procedural art and sound are licensed). `.kiro/` and
the specs are part of the submission and should be covered too.

Needed: the team picks a licence and adds a `LICENSE` file.

## 5. Devpost and video (SUBMITTED 2026-11-10)

The Devpost entry was submitted on 2026-11-10.

- Video: uploaded 2026-11-09, https://youtu.be/5ahST7N6Edg. The link is in
  `README.md` and `docs/devpost.md`. Done.
- Gallery images: `docs/devpost-gallery`. Done.
- Kiro usage text and Kiro Crew bonus text: `docs/KIRO_CREW.md`. Done.

Needed: nothing. Any leftover `[Team]` markers in `docs/devpost.md` are history.

## 6. Host header the deploy cannot set

GitHub Pages cannot send response headers, so the recommended
`Permissions-Policy: camera=(self), microphone=(), geolocation=()` is not sent
on the live site (`docs/hosting.md`). The camera still works because browsers
default it to the page's own origin, and the app never asks for microphone or
location. A host that can set headers (or a small proxy) would send it.

Needed: nothing blocking. If the team moves off Pages, set the header there.

## 7. Repo rename (done 2026-11-08)

The GitHub repository was renamed from `Kiroween` to `Dead-Air`. Updated: the git
remote, the Pages base in `.github/workflows/pages.yml` (`/Dead-Air/`), the
comments in `vite.config.ts` and `FileAdapter.ts`, the `mediaUrl` test, the links
in `README.md`, `docs/devpost.md`, `docs/hosting.md`, `docs/video-plan.md`, and
the remote line in `.kiro/steering/tech.md`. The live site is now
https://dngvmnh.github.io/Dead-Air/. `docs/autopilot-log.md` keeps the old name in
its history on purpose.

Needed: check the first deploy under the new base (see the report).

## 8. Removed: forced fullscreen

The first-click `requestFullscreen` was removed on 2026-11-08 because it caused a
laggy screen freeze. The set no longer goes fullscreen. Requirement 12 and the
design's fullscreen section were withdrawn. No action needed; noted so the
change is not reintroduced by mistake.

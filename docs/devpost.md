# Devpost draft

A draft for the team to edit. Check with the teammate in charge of the rules for required
sections and limits before pasting. Lines marked **[Team]** need a decision.

---

## Name

DEAD AIR

## Tagline

The haunted television network that never goes off the air, until it notices you.

## Category

Resurrection: analog broadcast television, brought back as behaviour, not just a look.

## Links

- Live: https://dngvmnh.github.io/Kiroween/ (desktop Chrome or Edge, sound on; `?demo=1` for
  a three-minute run)
- Code: https://github.com/dngvmnh/Kiroween
- Video: **[Team]** link once uploaded

## Inspiration

Broadcast television was something you tuned into, not something you chose from a menu.
Channels were always mid-programme, you surfed past things, and late at night the station
signed off and left static. We wanted to bring that back: not a TV-shaped video player,
but a television that behaves like one. Then we asked what it would be like if that
television slowly realised someone was watching.

## What it does

You sit in a dim room in front of a CRT. Press POWER and the set warms up onto one of four
always-on channels: the nightly news, a children's hour, a shopping channel, and channel 13,
which is mostly static. The programmes run on a broadcast clock, so if you leave a channel
and come back, it has moved on without you.

At first it is ordinary, slightly boring television. Then the network starts to respond to
what you really did: which channels you visited, in what order, for how long, and the
real time on your clock. Presenters say things they should not know. The room changes
between visits. A shadow on the wall moves a step closer whenever you are not looking.

The room is physical. The wallpaper tears under your pointer, and something is behind it.
So does the picture on the tube. Tears come back on your next visit, badly mended by
someone who is not you. Later, the wall tears itself, from the other side.

Short jump scares keep you on edge, and they answer you. When a scare comes due, it waits a
few seconds for you to click, change channel or tear something, and lands on that. Keeping
still does not help: it comes anyway. A pacer keeps them at least eight seconds apart and
at most four a minute, so the dread never turns into noise.

On the back of the set there is one optional switch, "Let it see you". It uses your camera.
The image never leaves your device, nothing is recorded, and nothing in the story depends
on it. What it does is for you to find out.

Eventually the station signs off. It comes back after hours.

## How we built it

- React 19 and strict TypeScript, built with Vite, as a static site with no backend.
- A hand-written WebGL2 CRT shader: curvature, scanlines, phosphor bloom, warm-up and
  collapse, and procedural static.
- A cloth-like tear simulation for the wall and the picture, sized to stay under about
  3 ms a frame on integrated graphics, at 60 fps with both canvases running.
- All art and sound are procedural: the room, the wallpaper, the faces and figures are drawn
  in code, and the sound is synthesised with Web Audio. Films are public-domain Prelinger
  Archive footage, fetched and cut at build time, never stored in git.
- A pure, tested core: the broadcast clock, the story director, viewer memory and the
  startle pacer have no DOM or clock access, so they are tested with Vitest and fast-check
  property tests. More than 100 Playwright tests run on real WebGL in Chromium.
- Viewer memory lives only in the browser's local storage. "Forget me" on the rear panel
  erases it.
- Deployed to GitHub Pages by a GitHub Actions workflow.

**[Team] How we used Kiro.** The project was planned spec-first in Kiro: steering files for
product, tech, structure, safety and rights, and YouTube compliance; two specs
(`dead-air-tv`, `dead-air-room`) with requirements, design and ordered tasks; and an agent
hook that validates the content catalogue on save. Write here, in your own words, which
parts were built with Kiro and which with other tools. Later tasks in `dead-air-room` were
implemented with Claude Code, recorded in `docs/autopilot-log.md`. Describe this
accurately.

## Challenges we ran into

- **Making it scary without making it cheap.** The first version was too rare and too
  polite. We added real jump scares, then had to stop them becoming background noise. The
  pacer that lands scares on the viewer's own actions came out of that.
- **Tearing a picture that keeps moving.** The tear has to follow the pointer on a
  programme that is still playing, behind a curved CRT shader, at 60 fps.
- **A hang that only appeared without the films.** A clean checkout has no films, and in
  that state the page could freeze for good: an event handler replaced itself while the
  same event was still being delivered. We caught it by pausing the hung page in a
  debugger, and added a test that serves every film as missing.
- **The camera.** We wanted the most personal scare possible without the project ever
  becoming surveillance. The camera is off until the viewer switches it on, says what it
  uses before the browser asks, and a source-code test makes sure no camera frame can be
  read back, saved or sent.

## Accomplishments that we're proud of

- It feels like a television, not a game: no score, no map, no objective, no tutorial.
- Everything the network "knows" is real, and nothing leaves the browser.
- Jump scares that answer what you do, with a measurable balance behind them.
- Original procedural art and sound throughout, public-domain films, and a rights log for
  every item that is not original.
- Accessibility and safety designed in: a first-run warning, the three-flashes-a-second
  limit, no saturated red flashes, a sound limiter, and reduced motion respected.

## What we learned

- Horror lives in pacing more than in assets. Scarce, well-placed moments beat constant ones.
- Writing specs before code made a large, strange project hold together.
- Testing pure logic separately from the rendering made it possible to change the story
  without breaking the television.

## What's next for DEAD AIR

- Licensed YouTube channels alongside our own films, inside YouTube's embed rules.
- More channels and longer rundowns, so a visitor can leave it running all evening.
- A mobile layout that keeps the room tearable by touch.

## Built with

react, typescript, vite, webgl2, glsl, web-audio-api, web-speech-api, zod, vitest,
fast-check, playwright, github-actions, github-pages, kiro

**[Team]** Add any other tools you used.

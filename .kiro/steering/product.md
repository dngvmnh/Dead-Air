---
inclusion: always
---

# Product: DEAD AIR

DEAD AIR is a browser-based haunted television network. It resurrects linear analog TV: channels that are always mid-broadcast, surfed with POWER and CH+/CH-. Over time the network behaves as though it knows it is being watched.

## Experience principles

1. **It is a television, not a game.** No score, map, inventory, objectives, puzzles, passwords, or tutorial. Never add them.
2. **Always on.** A channel is never "finished". Tuning in lands mid-programme, and channels progress while you are elsewhere.
3. **Ordinary first.** Most airtime is believable, slightly boring television. Horror works because it is scarce. Default to fewer, better events.
4. **Earned awareness.** The TV only ever references what the viewer really did: channels visited, order, time watched, local clock time.
5. **Implied, not graphic.** Dread through wrongness: a stare, a moved object, a line of dialogue. No gore. Between the slow dread, brief real jump scares: a few seconds, then back to normal.
6. **Fiction, not surveillance.** The creepiness is theatre. Never request microphone, location, or notification permissions, and never transmit viewing data. The single exception is the optional Reflection control: the viewer switches on the camera themselves, frames stay on the device, and nothing in the story depends on it. See `.kiro/specs/dead-air-room/`.
7. **The world can be torn.** The room and owned pictures are physical and tearable, with no explanation. Tearing is never an objective and is never needed to progress.

## Audience and context

Hackathon judges (about three minutes of attention, likely on a laptop with speakers) and curious visitors who may leave it running. `?demo=1` compresses the arc to fit a judging session.

## Kiroween category argument

Resurrection: we revive the *behaviour* of analog television, not just its look: linear scheduling, channel surfing, station identity, interstitials, signal tuning, sign-off.

## Scope

**In:** four channels, broadcast clock, CRT shader, tuning, procedural audio, viewer memory, horror director, sign-off and after-hours state, three source types (scene, file, YouTube), tearable room and picture, haunted room, optional camera reflection.

**Out:** accounts, backend, comments, recommendations, search, user uploads, multiplayer, native apps, generative AI at runtime.

**Stretch only after Milestone 5:** VHS look preset, fifth hidden channel, shared "network-wide" clock events.

## Fixed copy

The sign-off screen reads exactly:

```
NO SIGNAL

THANK YOU FOR WATCHING.

BROADCAST TERMINATED · 00:00:13
```

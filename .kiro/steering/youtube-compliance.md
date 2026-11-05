---
inclusion: fileMatch
fileMatchPattern: ["src/playback/**", "src/components/YouTubeSurface/**", "src/components/Screen/**", "src/content/catalog/**", "src/core/director.ts", "tests/e2e/**"]
---

# YouTube embed rules (non-negotiable)

Source: YouTube API Services Required Minimum Functionality and Developer Policies. These override any visual idea, including instructions elsewhere in this project.

## Hard rules

1. **Nothing in front of the player.** No overlay, frame, scanline layer, static canvas, vignette, gloss, or transparent click-blocker may sit above any part of the iframe, even with `pointer-events: none`.
2. **No altering the player.** No CSS `filter`, `mix-blend-mode`, `opacity`, `clip-path`, `border-radius`, `mask`, or `transform` on the iframe or its ancestors.
3. **Controls stay.** `controls: 1`. Do not set `disablekb: 1`. Do not intercept clicks on the player. Do not attach mouseover or touch actions to it.
4. **Never extract the media.** No downloading, caching, or re-hosting YouTube content. Do not attempt to read frames or audio from it; it cannot be passed through the CRT shader or Web Audio.
5. **No background playback.** When the iframe is not on screen, or the tab is hidden, the video must be paused or stopped.
6. **Send a Referer.** Serve with `Referrer-Policy: strict-origin-when-cross-origin`. Otherwise the player can fail with error 153.
7. **Keep attribution and ads.** Do not hide YouTube branding, links, or ads.

## The NMTV warning

NMTV's public front-end places a static canvas and a transparent "interaction-blocker" over the player and sets `controls: 0, disablekb: 1`. Those are the parts we must not copy. It also has no licence file, so copy none of its code at all; only the general idea of a queued, per-channel embed.

## How YouTube items look in DEAD AIR: "clean feed"

- The player is a plain rectangle in the tube opening. The tube, bezel, and chassis surround it without touching it.
- Channel number and signal state appear on the physical LED display on the chassis, never over the picture.
- Tuning static plays only while the player is paused and hidden with `visibility: hidden`.
- All CRT shader effects apply to scene and file sources only.

## How horror interacts with YouTube items

- Horror events never interrupt a playing YouTube video. They fire only at `tune-in` or `item-boundary` seams.
- `mid-item` events are allowed on scene and file items only. The director and the catalogue validator both enforce this.

## Error codes

| Code | Meaning | Action |
|---|---|---|
| 2 | Invalid parameter or ID | Mark dead for session; log catalogue error |
| 5 | HTML5 player error | Retry once, then mark dead |
| 100 | Removed or private | Mark dead for session |
| 101, 150 | Embedding disabled | Mark dead for session |
| 153 | Missing Referer | Fix hosting configuration; treat all YouTube items as unavailable |

## Test that guards this

The end-to-end test `youtube-clean-feed` samples a grid across the iframe rectangle, forces `pointer-events: auto` on every element, and asserts `document.elementFromPoint` returns the iframe at each point. It also asserts the forbidden CSS properties are unset on the iframe and its ancestors.

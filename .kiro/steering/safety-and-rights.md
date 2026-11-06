---
inclusion: always
---

# Safety, privacy, and media rights

## Photosensitivity and sound

- First-run notice before POWER: flashing lights, sudden sound, horror themes.
- Never exceed three flashes in any one-second window. A central `flashLimiter` in the renderer enforces this for every effect and event, whatever the content asks for.
- Avoid saturated red flashes and full-field high-contrast strobing.
- `prefers-reduced-motion` or the Reduced Effects switch disables flashes, roll, and jitter; static becomes a slow grain.
- Stingers peak no more than 6 dB above programme level, and master output passes through a limiter.

## Privacy

- Viewer memory is stored only in the viewer's browser. No analytics, no fingerprinting, no network transmission.
- Never request microphone, location, or notifications.
- The camera may be requested only by the optional Reflection control, after the viewer's own click and plain disclosure. Never on load or from an event. Frames are never analysed, saved, read back, or transmitted. Tracks stop when it is switched off, on Forget me, and when the tab is hidden. The choice is not persisted, and no content depends on it.
- Local clock time may be read and quoted. Never infer or display a location or IP address, even as a joke.
- Provide a real way to erase memory: `?reset=1` and a "Forget me" control on the rear panel.
- The fiction must never suggest real harm or tell the viewer to do anything in the real world. No self-harm themes. No real people, organisations, emergency services, or real-world locations. Emergency-style content must be visibly fictional and name the fictional network, and never imitate a real emergency alert tone.

## Media rights

Every catalogue item has a required `rights` object. The validator fails without it.

| `rights.basis` | Meaning | Use |
|---|---|---|
| `original` | Made by the team | Anything |
| `ai-generated` | Team-generated with a tool whose terms allow it; record the tool | Self-host |
| `public-domain` | Verified for this exact work; record source URL and why | Self-host |
| `cc` | Licence that permits this use; record URL, licence, attribution | Self-host; show credit |
| `permission` | Written permission from the owner; record reference | As agreed |
| `youtube-embed` | Embedded through the official player, not re-hosted | Embed only |

Rules:

- `youtube-embed` is not a licence to the content. Do not download it, and do not assume it is cleared for the hackathon. Do not use commercial music or mainstream TV programming.
- No real broadcasters' logos, or recognisable characters, shows, presenters, or products. All station identities and characters are original.
- Never pretend an item is public domain because it is old. Check the specific work and record the evidence.
- The demo video must use only `original`, `ai-generated`, `public-domain`, or properly licensed `cc` material.
- Never invent YouTube IDs, durations, or source URLs. Leave a catalogue slot empty until a human supplies it.

Exception (owner, 2026-11-07): five public-domain Prelinger films may show real people and products, as recorded in `docs/rights-log.md`, pending the review noted there. Everything made for the project still follows the rules above.

## Media storage

No media binaries in git. GitHub rejects blobs over 100 MB, and history cannot be easily cleaned. `public/media` is for small images and short audio, each under 5 MB. Long video goes to object storage with HTTP range support and CORS allowing the site's origin; WebGL cannot sample a cross-origin video without CORS.

The public-domain clips are cut by `npm run fetch:media` into `public/film` (gitignored) and served from the site's own origin, which avoids the CORS requirement. Run it before a deploy. A deploy without it still works: a missing clip is skipped.

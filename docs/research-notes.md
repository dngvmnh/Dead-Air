# Research Notes

Checked on 2026-11-05. Separates what was confirmed from what was not.

## Verified against primary sources

**YouTube Required Minimum Functionality**
- Must not display overlays, frames, or other visual elements in front of any part of an embedded player, including its controls.
- Must not change the player beyond what the API documents. Mouseovers or touch events must not trigger actions on the viewer's behalf.
- Embeds must identify themselves using the HTTP Referer; `strict-origin-when-cross-origin` is recommended.

**YouTube Developer Policies**
- No downloading, caching, or storing audiovisual content without written approval.
- No background player: content must not play from a player not displayed on the page, tab, or screen being viewed.
- Must not remove, obscure, or disable player links or attribution.

**IFrame Player API reference**
- `onError` codes: 2 (invalid parameter), 5 (HTML5 error), 100 (not found or private), 101 and 150 (embedding disabled), 153 (missing Referer).
- `onAutoplayBlocked` exists. For 16:9 players with controls, at least 480×270 is recommended.

**NMTV front-end source (`AlonHmdt/nmtv-frontend`)**
- Confirmed: Angular/TypeScript; `YT.Player` with `host: youtube-nocookie.com`, `autoplay: 1`, `controls: 0`, `disablekb: 1`; `loadVideoById` on `ENDED`; per-channel saved queue and position; last channel in localStorage.
- Confirmed: its template puts a static canvas and a transparent `interaction-blocker` div over the player.
- A separate `AlonHmdt/nmtv-backend` repository also appears in GitHub search; it wasn't inspected. The earlier statement that the backend is not public may be out of date.
- GitHub reports **no licence** for the front-end, so its code can't be reused. Only ideas were taken.
- Not independently re-checked here: the "queue of 10, refill at 6" figures, the hosting stack, and Supabase.

**Kiro docs** (kiro.dev/docs: steering, specs, hooks)
- Steering files in `.kiro/steering/` with `inclusion` front matter (`always`, `fileMatch`, `manual`, `auto`).
- Specs in `.kiro/specs/<name>/` as `requirements.md`, `design.md`, `tasks.md`; EARS format.
- Hooks in `.kiro/hooks/*.json`, `version: "v1"`. The exact checkbox syntax for `tasks.md` wasn't documented on the pages read; the format used follows common Kiro output. If the Kiro version in use shows the hook or tasks differently, let Kiro convert them.

## Not verified: check by hand

**Kiroween rules and deadline.** The official page (kiroween.devpost.com) showed a bot-verification screen and could not be read.
- The only 2026 listing found (Internshala) gives a submission deadline of 4 Dec 2026, a credit request deadline of 1 Dec 2026, up to 3 team members, and categories Resurrection, Frankenstein, Skeleton Crew, and Costume Contest.
- That listing is inconsistent: it is marked closed with the date 29 Jan 2026. **It may be the 2025 event with changed years. Do not rely on these dates.**
- From recollection of the 2025 event, not confirmed for this one: a public repo with `.kiro/` committed at the root, an open-source licence, a roughly three-minute demo video, and a write-up of Kiro usage. The earlier team notes also said copyrighted music and other material can't be used without permission.

**Interpretation calls in this spec.** These are conservative readings, not quotes from YouTube:
- Using `visibility: hidden` on a paused player while static plays.
- Never interrupting a YouTube video for a horror event.
- Treating `transform` and similar CSS on ancestors as "altering the player".

**Unknown until tested:** real YouTube autoplay behaviour on a deployed URL in each browser. The test stub can't prove this.

## Open items

| Item | Owner | Blocks |
|---|---|---|
| Confirm deadline and rules on Devpost | Team | Scheduling; task 23 |
| Choose a licence (MIT is the usual choice, if allowed) | Team | Task 23.1 |
| Pick media host for long video | Team | Task 21.3 |
| Curate programming; supply all IDs and rights | Team | Task 21.2 |
| Choose image, voice, and music tools; check their terms | Team | Task 21.1 |

## Sources

- https://developers.google.com/youtube/terms/required-minimum-functionality
- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/iframe_api_reference
- https://developers.google.com/youtube/iframe_api_revision_history
- https://github.com/AlonHmdt/nmtv-frontend
- https://kiro.dev/docs/steering/
- https://kiro.dev/docs/specs/
- https://kiro.dev/docs/hooks/
- https://internshala.com/competitions/kiroween-2026-kiro-hackathon/ (unreliable; see above)

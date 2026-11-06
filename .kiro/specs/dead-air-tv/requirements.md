# Requirements: DEAD AIR Television

## Introduction

DEAD AIR is a static web application that simulates a four-channel analog television network. Channels follow a deterministic broadcast clock, so they appear to run continuously. A horror director uses viewing history stored in the browser to alter programming over time. Programmes come from three source types: time-addressable scenes, self-hosted files, and YouTube embeds.

## Glossary

- **Rundown:** the ordered, looping list of items on a channel.
- **Broadcast clock:** pure function mapping a channel and wall-clock time to an item and offset.
- **Seam:** a point where an event may fire: `tune-in`, `item-boundary`, or `mid-item`.
- **Owned source:** a scene or file item. These can pass through the CRT shader.
- **Clean feed:** presentation of a YouTube item with nothing in front of the player.
- **Act:** escalation stage, 0 to 4, stored in viewer memory.

## Requirement 1: Power

**User Story:** As a viewer, I want a power button, so that using it feels like turning on a real TV.

#### Acceptance Criteria

1. WHEN the page first loads THE SYSTEM SHALL show the room and an unlit television with no picture and no sound.
2. WHEN the viewer has not seen the first-run notice THE SYSTEM SHALL display the content warning before POWER can start the television.
3. WHEN the viewer presses POWER while off THE SYSTEM SHALL unlock audio, play a boot sequence of at most 1500 ms, and tune to the last channel watched, or channel 02 if none.
4. WHEN the viewer presses POWER while on THE SYSTEM SHALL stop all playback, collapse the picture to a line and dot, and silence audio within 800 ms.
5. WHEN the television is off THE SYSTEM SHALL NOT play any video or audio from any source.

## Requirement 2: Channel surfing

**User Story:** As a viewer, I want to surf channels, so that I can wander the network freely.

#### Acceptance Criteria

1. WHEN the viewer presses CH+ THE SYSTEM SHALL tune to the next channel in the cycle 02, 04, 07, 13, wrapping to 02.
2. WHEN the viewer presses CH- THE SYSTEM SHALL tune to the previous channel in the same cycle, wrapping to 13.
3. WHEN tuning begins THE SYSTEM SHALL stop the previous source, play static and a tuning sound for 350 to 700 ms, then show the resolved programme.
4. WHEN the viewer presses channel buttons repeatedly during tuning THE SYSTEM SHALL keep static playing and load only the final channel.
5. THE SYSTEM SHALL show the current channel number on the chassis LED display at all times while powered on.
6. THE SYSTEM SHALL support keyboard control: ArrowUp for CH+, ArrowDown for CH-, P for power, M for mute, and `-` and `=` for volume, except while keyboard focus is inside the YouTube iframe.

## Requirement 3: Broadcast continuity

**User Story:** As a viewer, I want channels to keep running when I leave, so that it feels like live television.

#### Acceptance Criteria

1. WHEN a channel is tuned THE SYSTEM SHALL start the item and offset given by the broadcast clock for the current time.
2. WHEN the viewer leaves a channel and returns after N seconds THE SYSTEM SHALL show the position N seconds further along, within 2 seconds for owned sources and 5 seconds for YouTube sources, excluding any ad playback.
3. WHEN an item ends THE SYSTEM SHALL resolve the clock again and play the result without user action.
4. WHEN two browsers open the same channel at the same time THE SYSTEM SHALL resolve to the same item and offset, ignoring items marked dead in either session and events in progress.
5. WHEN the rundown reaches its end THE SYSTEM SHALL loop it with no visible seam other than normal item transitions.
6. THE SYSTEM SHALL function with no backend service.

## Requirement 4: Programming depth

**User Story:** As a viewer, I want plenty of programming, so that the network does not feel used up within minutes.

#### Acceptance Criteria

1. WHEN building for release THE validator SHALL fail if any channel rundown totals less than 30 minutes.
2. WHEN building for release THE validator SHALL fail if channel 02, 04, or 07 lacks at least four interstitial items.
3. THE SYSTEM SHALL allow rundowns to mix scene, file, and YouTube items on one channel.
4. WHILE no external media is configured THE SYSTEM SHALL remain fully usable using scene items alone.

## Requirement 5: CRT presentation

**User Story:** As a viewer, I want a convincing CRT, so that the television feels physically real.

#### Acceptance Criteria

1. WHILE an owned source is on screen THE SYSTEM SHALL render it through a WebGL2 shader with barrel curvature, scanlines, shadow mask, bloom, chromatic aberration, noise, vignette, and rolling interference.
2. THE SYSTEM SHALL support per-item look presets, including at least `broadcast` and `deadair`.
3. IF WebGL2 is unavailable THEN THE SYSTEM SHALL fall back to an unfiltered canvas with a CSS treatment and remain operable.
4. THE SYSTEM SHALL cap internal render resolution at 960×720.
5. WHEN the WebGL context is lost THE SYSTEM SHALL restore rendering without reloading the page.

## Requirement 6: YouTube clean feed

**User Story:** As the team, we want YouTube playback within policy, so that the embed works and stays permitted.

#### Acceptance Criteria

1. WHILE a YouTube item is on screen THE SYSTEM SHALL NOT render any element in front of any part of the player, including elements with `pointer-events: none`.
2. THE SYSTEM SHALL NOT apply filter, blend, opacity, clip, mask, radius, or transform styling to the iframe or its ancestors.
3. THE SYSTEM SHALL create the player through the official IFrame Player API with visible controls and without `disablekb`.
4. WHEN the document becomes hidden THE SYSTEM SHALL pause a playing YouTube video.
5. WHEN the iframe is not visible THE SYSTEM SHALL ensure its video is paused or stopped.
6. WHEN the player reports error 2, 100, 101, or 150 THE SYSTEM SHALL mark the item dead for the session, drop it from rundown resolution, and re-resolve the channel.
7. WHEN the player reports error 5 THE SYSTEM SHALL retry once, then treat the item as dead.
8. IF the IFrame API fails to load or error 153 occurs THEN THE SYSTEM SHALL treat every YouTube item as unavailable for the session and continue with owned sources.
9. IF a channel has no playable items THEN THE SYSTEM SHALL show a PLEASE STAND BY slate rather than an error.
10. WHEN the player reports `onAutoplayBlocked` THE SYSTEM SHALL prompt on the chassis, outside the player, and leave the player's own controls available.
11. WHEN the viewer pauses using YouTube's controls THE SYSTEM SHALL NOT force playback to resume.
12. THE SYSTEM SHALL serve pages with `Referrer-Policy: strict-origin-when-cross-origin`.

## Requirement 7: Viewer memory

**User Story:** As a viewer, I want the TV to remember me, so that returning feels unsettling.

#### Acceptance Criteria

1. WHEN a tune completes THE SYSTEM SHALL record the channel's visit count, last visited time, last channel, and visit order, keeping the 50 latest entries.
2. WHILE the TV is on, the document is visible, and a programme is actually playing, THE SYSTEM SHALL accumulate total and per-channel watch time.
3. THE SYSTEM SHALL persist memory to versioned localStorage at most every 5 seconds and whenever the document becomes hidden.
4. IF storage is unavailable or memory fails validation THEN THE SYSTEM SHALL continue with in-memory state and not crash.
5. WHEN a new session starts more than 30 minutes after the last activity THE SYSTEM SHALL increment the session count.
6. WHEN `?reset=1` is used or "Forget me" is confirmed THE SYSTEM SHALL erase all memory.
7. THE SYSTEM SHALL NOT transmit viewer memory or viewing behaviour anywhere.

## Requirement 8: Escalation

**User Story:** As a viewer, I want the network to change gradually, so that the dread builds.

#### Acceptance Criteria

1. THE SYSTEM SHALL compute the act from memory using the thresholds in the design, and the act SHALL never decrease except after a memory reset.
2. WHEN `?demo=1` is present THE SYSTEM SHALL divide time thresholds and event cooldowns by 8 without persisting them.
3. WHEN a channel with a revisit variant is tuned with enough visits THE SYSTEM SHALL present that variant.
4. WHEN channel 07 is revisited THE SYSTEM SHALL change at least one set object relative to the previous visit.

## Requirement 9: Horror director

**User Story:** As the team, we want horror events defined as data, so that writers can add them without engine changes.

#### Acceptance Criteria

1. WHEN a seam occurs THE director SHALL select at most one eligible event by act, channel, seam, condition, limit, and cooldown, with ties broken by priority then seeded random.
2. THE director SHALL be a pure function of memory, context, event definitions, time, and random seed.
3. WHILE a YouTube item is playing THE director SHALL NOT fire an event.
4. WHEN an event completes or fails THE SYSTEM SHALL re-resolve the broadcast clock and resume the current programme.
5. WHEN an event references template variables THE SYSTEM SHALL fill them only from real viewer memory, and SHALL use its fallback line if a value is missing.
6. WHEN an event's media cannot load THE SYSTEM SHALL present its captions over static and SHALL NOT crash.
7. THE SYSTEM SHALL enforce a global minimum gap of 45 seconds between events, except events marked `chain`.

## Requirement 10: Channel 13

**User Story:** As a viewer, I want Dead Air to know what I watched, so that the concept lands.

#### Acceptance Criteria

1. WHEN channel 13 is tuned THE SYSTEM SHALL read back real viewing history once the viewer has visited at least one other channel.
2. WHEN channel 13 is tuned after an owned source was on screen THE SYSTEM SHALL briefly flash the last captured frame of that source.
3. IF the previous source was YouTube THEN THE SYSTEM SHALL flash that channel's station card instead, and SHALL NOT attempt to capture from the player.
4. THE SYSTEM SHALL use only original or `ai-generated` media on channel 13.

## Requirement 11: Sign-off and after hours

**User Story:** As a viewer, I want a chilling ending that doesn't kill the network, so that there is a reason to return.

#### Acceptance Criteria

1. WHEN channel 13 is tuned in Act 3 THE SYSTEM SHALL play the sign-off event and then cut to the exact fixed sign-off text.
2. WHEN the sign-off text has displayed for 8 seconds THE SYSTEM SHALL power the television off and set Act 4.
3. WHEN the viewer next presses POWER in Act 4 THE SYSTEM SHALL resume all channels in the after-hours state with Act 4 variants and events.
4. THE SYSTEM SHALL fire the sign-off at most once per viewer memory.

## Requirement 12: Audio

**User Story:** As a viewer, I want analog-sounding audio, so that the illusion holds with my eyes closed.

#### Acceptance Criteria

1. THE SYSTEM SHALL generate static, tuning, boot, and power-off sound procedurally through Web Audio, with no audio files needed for them.
2. WHILE an owned source is playing THE SYSTEM SHALL route it through an analog filter chain and a master limiter.
3. THE SYSTEM SHALL apply volume and mute to all sources, using the player API for YouTube.
4. WHEN a template requires a spoken channel number THE SYSTEM SHALL stitch prerecorded stems, and SHALL show captions alone if a stem is missing.
5. WHEN `play()` with sound is rejected THE SYSTEM SHALL retry muted and flash the mute LED on the chassis.

## Requirement 13: Accessibility and safety

**User Story:** As a viewer with sensitivities or different abilities, I want to use the experience safely.

#### Acceptance Criteria

1. THE SYSTEM SHALL NOT exceed three flashes in any one-second window, regardless of event content.
2. WHEN `prefers-reduced-motion` is set or Reduced Effects is on THE SYSTEM SHALL disable flashes, roll, and jitter.
3. THE SYSTEM SHALL provide captions for all owned speech and event voice, with a CC control on the chassis.
4. THE SYSTEM SHALL make all controls keyboard-operable with visible focus and accessible names.
5. WHEN the channel changes THE SYSTEM SHALL announce it through an ARIA live region.
6. THE SYSTEM SHALL NOT request microphone, location, or notification permissions, and SHALL request the camera only as defined by the optional Reflection control in `.kiro/specs/dead-air-room/` requirement 7.

## Requirement 14: Catalogue validation

**User Story:** As a developer, I want bad content caught before deployment, so that the broadcast doesn't break.

#### Acceptance Criteria

1. WHEN `npm run validate:catalog` runs THE validator SHALL check schemas, unique ids, durations greater than zero, and references to scenes, events, and local assets.
2. IF an item has no `rights` record THEN THE validator SHALL fail.
3. IF an event can fire at `mid-item` on a YouTube item THEN THE validator SHALL fail.
4. IF channel 13 contains anything other than `original` or `ai-generated` THEN THE validator SHALL fail.
5. WHEN run with `--release` THE validator SHALL also fail on placeholder items and the depth rules in Requirement 4.
6. WHEN `npm run check:youtube` runs THE script SHALL report unavailable or non-embeddable IDs without failing an offline build.

## Requirement 15: Layout and support

**User Story:** As a viewer, I want it to work on my device.

#### Acceptance Criteria

1. THE SYSTEM SHALL support current desktop Chrome, Edge, Firefox, and Safari.
2. WHEN the viewport is below 768 px THE SYSTEM SHALL stack controls below a full-width screen with no horizontal scrolling.
3. THE SYSTEM SHOULD size the YouTube player to at least 480×270 where the viewport allows it.
4. THE SYSTEM SHALL fully hide the chassis decorations from any region occupied by the YouTube player.

## Requirement 16: Submission readiness

**User Story:** As the team, we want the repository to be judge-ready.

#### Acceptance Criteria

1. THE repository SHALL keep `.kiro/` at its root, committed and not ignored.
2. THE repository SHALL contain an open-source licence file visible on GitHub.
3. THE repository SHALL include a README with a live URL, run instructions, and a section on how Kiro was used.
4. WHEN a judge opens `/?demo=1` THE SYSTEM SHALL reach the sign-off within about three minutes of active surfing.
5. THE demo path SHALL use only owned, public-domain, or properly licensed media.

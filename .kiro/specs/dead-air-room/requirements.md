# Requirements: DEAD AIR Room

## Introduction

DEAD AIR's television now works, but the experience is not frightening. Horror stays inside the tube as text, and the empty room around the set never reacts to the viewer.

This feature makes the room part of the broadcast. The viewer can rip a Halloween-decorated wall and the picture on the tube like paper. Behind them is something that changes with the viewer's real history. The room reacts to the television, and at the end of Act 3 something rips through the wall from the other side. An optional camera reflection appears in the dark glass.

The goal for a judge: within 30 seconds they have discovered the tear without being told, and within about three minutes it has turned on them.

## Glossary

- **Wall sheet:** the tearable wallpaper layer on the room canvas behind the chassis.
- **Tube sheet:** the tearable picture layer inside the CRT pipeline, for owned sources only.
- **Behind layer:** what a tear reveals. It depends on act and viewer memory.
- **Unobserved moment:** tuning static, TV off, a hidden tab, or a scripted blackout.
- **Reflection:** the viewer's darkened camera image in the tube glass. Opt-in.

## Requirement 1: Tear interaction

**User Story:** As a viewer, I want to grab the room and picture and tear them like paper, so that the interface itself feels physical and wrong.

#### Acceptance Criteria

1. WHEN the viewer drags on the wall THE SYSTEM SHALL pull, deform, and tear the wall sheet along the drag, driven by a constraint simulation rather than a pre-made animation.
2. WHEN a constraint stretches past its limit THE SYSTEM SHALL break it permanently, and a broken connection SHALL never rejoin.
3. THE torn edge SHALL show paper thickness, irregular fibre, and a shadow onto the layer behind.
4. WHEN a piece is fully detached THE SYSTEM SHALL let it fall and settle, then remove it from the simulation.
5. THE tear SHALL work with mouse and touch, including two independent touch points. Touch dragging on the room canvas SHALL NOT scroll the page.
6. WHEN the pointer is near an existing edge or the idle corner THE SYSTEM SHALL lift that edge slightly and show a grab cursor. No text, hint, or tutorial SHALL explain the tear.
7. WHEN tearing occurs THE SYSTEM SHALL play a procedural paper-rip sound through the SFX bus, scaled to drag speed and subject to the existing limiter.
8. WHILE the first-run notice is showing THE SYSTEM SHALL ignore tear input.
9. THE tear SHALL work with the TV on or off.

## Requirement 2: Tube tear

**User Story:** As a viewer, I want the programme itself to rip, so that the broadcast feels as fragile as the room.

#### Acceptance Criteria

1. WHILE an owned source is on screen THE SYSTEM SHALL allow the viewer to tear the picture. The tear SHALL pass through the CRT shader, inheriting curvature, scanlines, and bloom.
2. WHILE a YouTube item is on screen, or the YouTube surface is visible, THE SYSTEM SHALL disable the tube sheet, attach no pointer action to the player, and draw no tear over it.
3. WHEN a tune or item boundary occurs THE SYSTEM SHALL reset the tube sheet through static. The broadcast clock SHALL be unaffected at all times.
4. WHEN the fixed sign-off text is showing THE SYSTEM SHALL disable the tube sheet, so the text cannot be damaged.
5. WHEN an event slate or event caption is showing THE SYSTEM SHALL keep its text legible by disabling new tube tears until the step ends.

## Requirement 3: What is behind

**User Story:** As a viewer, I want what I uncover to change and to know about me, so that I keep tearing and feel watched.

#### Acceptance Criteria

1. THE behind layer SHALL depend on the current act, as listed in the design.
2. WHEN memory contains viewing history THE behind layer SHALL show it as marks on the plaster, using only real values with a fallback. It SHALL never invent facts about the viewer.
3. THE imagery SHALL imply rather than show. No gore, no real people, and no real locations.
4. WHILE the viewer is not looking at a behind element, it MAY change. It SHALL NOT be seen to teleport.

## Requirement 4: Damage remembers

**User Story:** As a returning viewer, I want my damage to still be there, so that the room feels continuous and aware.

#### Acceptance Criteria

1. THE SYSTEM SHALL store tear strokes in viewer memory in normalised coordinates, up to a capped count, and SHALL rebuild the wall sheet from them on load.
2. WHEN a new session starts in Act 2 or later THE SYSTEM SHALL show earlier tears as badly repaired, for example taped back with a piece in the wrong place.
3. WHEN memory is loaded from schema version 1 THE SYSTEM SHALL migrate it to version 2 without losing any existing field.
4. WHEN the viewer uses Forget me or `?reset=1` THE SYSTEM SHALL erase all tear and room memory.

## Requirement 5: Haunted room

**User Story:** As a viewer, I want the room around the set to feel inhabited, so that dread extends beyond the screen.

#### Acceptance Criteria

1. THE room SHALL be a composed, dim Halloween living room behind the set, with at least: decorated wallpaper, a paper garland, a shelf or frame, a window onto darkness, and a clock showing the viewer's real local time.
2. WHILE an owned source plays THE SYSTEM SHALL light the room from the picture's sampled average colour, no more than 8 times per second, smoothed so it cannot flash.
3. WHILE a YouTube item plays THE SYSTEM SHALL use a soft neutral light and SHALL NOT sample the player.
4. THE room's ambient light SHALL decrease by act.
5. THE room SHALL show a shadow figure on the wall from Act 1, which moves closer in steps tied to act and sessions, and only during an unobserved moment.
6. WHEN a viewer returns after an unobserved moment THE SYSTEM MAY have moved one room object, using only state stable within that visit.
7. THE room SHALL sit entirely behind the chassis. No room layer SHALL overlap the tube opening or any YouTube surface.

## Requirement 6: It rips back

**User Story:** As a viewer who has been tearing the room, I want it to do the same back, so that the toy turns into the scare.

#### Acceptance Criteria

1. THE director SHALL have a data-defined event E13 at Act 3 that dims the room, makes something push the wall from behind, and rips the wall from the other side.
2. E13 SHALL fire at most once per viewer, SHALL be exempt from the global gap, and SHALL NOT fire on channel 13. Sign-off SHALL still be reachable if it never fires.
3. WHEN E13 finishes THE broadcast SHALL continue as though nothing happened, and the tear SHALL persist.
4. WHEN Reduced Effects or reduced motion is on THE SYSTEM SHALL replace E13's motion with a blackout followed by the wall already torn.
5. WHEN the viewer changes channel or powers off during E13 THE SYSTEM SHALL cancel its remaining steps and leave a consistent room.

## Requirement 7: Optional reflection

**User Story:** As a viewer who wants more, I want to choose to see myself in the glass, so that the dark screen becomes personal, and I stay in control of my camera.

#### Acceptance Criteria

1. THE SYSTEM SHALL request the camera only after the viewer switches on the Reflection control on the rear panel, never on load, and never from an event.
2. BEFORE the browser prompt THE control SHALL state plainly that it uses the camera, that the image stays on this device, and that nothing is recorded or sent. It need not say what the glass will show (the owner, 2026-11-07).
3. THE SYSTEM SHALL show the reflection only as a darkened, low-contrast image in the tube glass while the tube is dark: when the TV is off, and during scripted silence on owned sources.
4. WHILE a YouTube item is on screen or the sign-off text is showing THE SYSTEM SHALL NOT draw the reflection.
5. THE SYSTEM SHALL NOT analyse, detect, save, upload, or read back camera frames, and SHALL NOT mention what the camera sees.
6. WHEN the viewer switches off, Forget me is used, or the tab is hidden THE SYSTEM SHALL stop every camera track. On a hidden tab it SHALL re-request only when the viewer switches on again.
7. THE camera choice SHALL NOT persist across page loads.
8. IF permission is denied or no camera exists THE control SHALL return to off with a short plain message. Nothing else SHALL change.
9. No story content, act progress, or ending SHALL depend on the reflection.
10. A visible chassis indicator SHALL be lit while the camera is active.
11. FROM Act 3, THE reflection MAY include a fixed shadow shape behind the viewer's position. It SHALL be scripted, and SHALL NOT claim anything about the viewer's real surroundings.

## Requirement 8: Access, safety, and fallback

**User Story:** As any viewer, I want this to be safe and never block the experience.

#### Acceptance Criteria

1. THE sign-off and all acts SHALL be reachable with no tearing at all.
2. THE key `T` SHALL rip a seeded path on the wall, giving keyboard users the same discovery. All existing controls stay operable.
3. Room lighting, ripping, and E13 SHALL respect the existing flash limit of three per rolling second.
4. WHEN Reduced Effects or reduced motion is on THE SYSTEM SHALL disable automatic room motion, shake, and flicker. Viewer-driven tearing stays available.
5. IF WebGL2 is unavailable THE SYSTEM SHALL draw a static pre-torn 2D room with light changes, with no simulation and no reflection.
6. WHEN the room WebGL context is lost THE SYSTEM SHALL restore it and rebuild the sheet from stored strokes.
7. THE new layers SHALL be `aria-hidden`. Meaningful room events SHALL be announced in the existing live region.

## Requirement 9: Corrections from the MVP review

**User Story:** As a judge, I want the existing horror to land.

#### Acceptance Criteria

1. THE sign-off text SHALL appear on a near-clean picture, with static at 0.05 or less, for its full 8 seconds.
2. E02 SHALL have a cooldown so it cannot repeat within one demo run's first few minutes.
3. WHEN `?demo=1` is present THE SYSTEM SHALL divide time thresholds and cooldowns by 8. All code SHALL use the single `DEMO_DIVISOR` constant.
4. A real-clock demo run, surfing CH+ every 15 s from a fresh memory, SHALL begin the sign-off within 3 min 30 s, including E13.
5. Running the test suite SHALL NOT modify committed files. Screenshots SHALL update only when `UPDATE_SCREENSHOTS=1` is set.

## Requirement 10: Budgets

1. Total JS and CSS SHALL stay under 300 KB gzipped, with no three.js or physics library.
2. The tear simulation SHALL take under 3 ms per frame on integrated graphics, and the page SHALL hold 60 fps with both canvases active.
3. Art SHALL be procedural or under 5 MB per file, with original authorship recorded in `docs/room-assets.md`.
4. No code or art SHALL be copied from Tearable UI or any other reference. Its source licence is unknown.

## Requirement 11: Startles

Short, frequent scares that keep the viewer on edge and then return to normal. The owner asked for this after finding the first version too rare and not frightening (2026-11-07).

1. A startle SHALL last no more than 6 seconds and SHALL return to the programme at its clock position. The catalogue validator enforces the length.
2. The first startle SHALL come 6 to 12 seconds after the first picture, and later checks SHALL be 10 to 22 seconds apart (4 to 8, then 6 to 14, under demo mode). Two channel changes SHALL bring the next one forward to about 0.7 seconds after landing, but no sooner than 8 seconds after the last. The same jump SHALL NOT repeat within 20 seconds. Every startle SHALL still have a per-session or per-viewer limit.
3. A startle SHALL NOT fire on a YouTube item, and nothing SHALL draw in front of a YouTube item. A tear MAY answer over YouTube only by staying in the room.
4. Startles SHALL NOT use or reset the story events' global gap, so they cannot delay the sign-off path.
5. The first tear of a session SHALL answer. About 60 percent of later tears MAY answer, subject to the same limits.
6. Channel change and power off SHALL stop a running startle, cut its sounds and restore the room's lights.
7. A jump SHALL rise in brightness once and cut to black once. It SHALL NOT strobe, go full-field white or use saturated red, and startles stay within the three-flashes-per-second limit. Every cue SHALL pass through a limiter, and none imitates a real alert tone. Scares imply and SHALL NOT show gore or real people.
10. A jump SHALL arrive with no warning: nothing on the tube leads into it, and it SHALL fill the window from its first visible frame, with hard cuts and no zoom. No scare SHALL appear on the tube first. There SHALL be at least ten kinds besides the face, each with its own picture and sound.
11. The programme SHALL be louder than the set's own noises and cues. A jump SHALL be louder than the programme, SHALL cut the programme and those noises while it sounds, and SHALL still obey mute and the volume control.
8. The system's reduced-motion setting SHALL halve startle sound levels and remove the full-window picture. The set has no button of its own for this, at the owner's request (2026-11-07). The first-run notice SHALL warn of jump scares.
9. The room SHALL carry an in-world hint that the wall can be torn. It SHALL NOT become a tutorial or an objective.
12. A startle that comes due SHALL wait a few seconds for the viewer to press, tune or tear, and land on that action; if the viewer does nothing it SHALL come anyway. Startles SHALL be at least 8 seconds apart (6 under demo), at most 4 in any minute (5 under demo), and after two in a row set off by the viewer the next SHALL come on the clock (the owner, 2026-11-07).

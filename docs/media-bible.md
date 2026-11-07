# Media Bible

How DEAD AIR's programmes get made. All names, characters, and scripts here are original and fictional. The town is the fictional **Hollow Creek**. The network is the fictional **KDA-TV**.

## 1. Production model

Do not make four finished videos. Make reusable parts and let the scene engine assemble them.

| Media | Method | Where it goes |
|---|---|---|
| Characters, sets, products, cards | AI image generation or hand-made art | `public/media/img` |
| Subtle movement, stares | Scene layer keyframes; optional short AI video | Scene, or file source |
| Voices | Team recording or text-to-speech whose terms allow this use | `public/media/vo` |
| Jingles | Team-composed, or music generator whose terms allow it | `public/media/audio` |
| Static, tuning, boot sounds, CRT look | Code | Nothing to produce |
| Long programming | Verified public-domain or licensed film; permitted YouTube embeds | `public/film`, cut by `npm run fetch:media` (see `docs/rights-log.md`) |

Before using any generator publicly, check its current terms, then record the tool in `rights.source`.

## 2. Asset budget

| Asset | Target |
|---|---|
| Original visual scenes | 12 (about 3 per channel) |
| Primary voice tracks | 4, plus event lines and number stems |
| Station identities | 4 |
| Station IDs and bumpers | 4–6 |
| Original commercials | 3–4 |
| Curated long items | 8–12 per channel, to reach 30+ minutes per channel |
| SFX beyond procedural | 3–5 |

## 3. Look and identity

| Ch | Identity | Palette | Type | Look preset |
|---|---|---|---|---|
| 02 | KDA Nightly News | Navy, off-white, signal red | Condensed sans | `broadcast` |
| 04 | Pumpkin Hour | Saturated orange, purple, cream | Rounded display | `broadcast` |
| 07 | Midnight Shopping Network | Gold, magenta, teal gradients | Bold italic | `broadcast` |
| 13 | Dead Air | Black, phosphor white, amber | Monospace | `deadair` |

## 4. Channel 02: Nightly News

**Cast:** Anchor *Martin Vale*, 50s, grey suit. Generate as a fictional person; do not resemble any real newsreader.

**Layers:** newsroom background; anchor in three states (neutral, lips parted, staring); lower third; ticker; KDA logo.

**Bulletin A, normal (40 s)**

| Time | Picture | Voice |
|---|---|---|
| 0–5 | News intro sting | "This is KDA Nightly News." |
| 5–15 | Anchor, ticker | "Good evening. Hollow Creek police say trick-or-treating will end at nine o'clock tonight, following a request from the town council." |
| 15–25 | Anchor | "The council gave no reason for the change. Residents on Alder Road report that their television sets have been switching on overnight." |
| 25–35 | Anchor | "Engineers at this station describe the fault as minor, and say there is no reason to check." |
| 35–40 | Anchor | "We'll have more after the weather." |

**Bulletin A, revisit variant (`minVisits: 2`, line 25–35 replaced)**

> "Engineers at this station have asked me to tell you the fault is minor. They've asked me to say that twice."

Anchor uses the staring state for the last 8 seconds. Ticker: `ALDER RD · ALDER RD · ALDER RD`.

**Weather and interstitials:** fictional forecast ("Clear. Clear. Clear. Overcast by morning, for those who see it."), a council notice, and a "stay tuned" bumper.

## 5. Channel 04: Pumpkin Hour

**Cast:** *Mister Gourd*, a cheerful felt-puppet-style pumpkin; *Dot*, a small paper ghost. Original designs only: no resemblance to any existing children's characters.

**Scene A, normal (45 s)**

> **GOURD:** Hello, hello, boys and ghouls! It's the Pumpkin Hour!
> **DOT:** What are we making today, Mister Gourd?
> **GOURD:** Today we are counting! How many friends are watching at home?
> **DOT:** One!
> **GOURD:** That's right, Dot. Just one.

**Scene A, revisit variant (`minVisits: 2`)**

Dot no longer moves. Mister Gourd's face is turned a few degrees further towards the lens.

> **GOURD:** Welcome back. Dot is resting. We can count without her.
> **GOURD:** *(whispered)* You went away for a while. We kept the show going.

**Jingle:** eight bars, toy piano and hand claps, team-composed. Variant: same melody, one semitone flat, slower.

## 6. Channel 07: Midnight Shopping

**Cast:** Host *Candy Marlowe*, bright smile, 1980s styling, fictional.

**Product:** the **Ever-Lasting Night Light**.

> "Introducing the Ever-Lasting Night Light. It keeps your room bright, even when the lights are off. Especially when the lights are off!"
> "Order now for just nineteen ninety-five. Our operators are watching. Our operators are *waiting*."

**The set:** one background and a shelf with four object slots. Each visit deterministically changes a slot using `LayerWhen`:

| Visit | Change |
|---|---|
| 2 | The clock now reads the viewer's local time |
| 3 | A small CRT TV has appeared on the shelf |
| 4 | That TV is on and shows a tiny version of this set |
| 5+ | Host is gone; the product stays; the voice continues |

**Price card by act:** `$19.95` → `$19.95` → `$13.00` → `YOU ALREADY PAID`.

**Other commercials:** "Hollow Creek Mattress Barn" (normal), and an insurance ad covering "whatever is behind you", used only from Act 2.

## 7. Channel 13: Dead Air

Mostly static and silence, test card, and slates. Only `original` or `ai-generated` media.

**Default slate**

```
KDA-TV
TECHNICAL DIFFICULTIES
PLEASE STAND BY
```

**Voice:** flat and calm. Fictional and clearly in-universe. Do not imitate a real emergency alert tone or name a real agency.

**Number stems to record:** "two", "four", "seven", "thirteen", "channel", plus minute numbers one to thirty.

## 8. Events

Copy for `src/content/events/events.json`. `{…}` values come only from real memory.

| ID | Min act | Channel | Seam | Trigger | Limit | What happens |
|---|---|---|---|---|---|---|
| E01 | 1 | 02 | item-boundary | Visits to 02 ≥ 2 | 1/viewer | Anchor stops, stares 6 s of silence, then: "...Excuse me." Bulletin continues. |
| E02 | 1 | Any | tune-in | Any | 2/session | 800 ms longer static, faint voice under it: "there you are." |
| E03 | 1 | 04 | mid-item | Visits to 04 ≥ 2 | 1/viewer | Audio drops. Gourd: "Shh. They're back." |
| E04 | 1 | 07 | item-boundary | Visits to 07 ≥ 2 | 1/viewer | Host repeats "Our operators are waiting" four times, each slower. |
| E05 | 2 | 13 | tune-in | Distinct channels ≥ 2 | 2/viewer | Flash previous channel, slate: `UNAUTHORISED VIEWER DETECTED` / `LAST TUNED: CHANNEL {lastChannel}`. |
| E06 | 2 | 02 | item-boundary | Distinct channels ≥ 3 | 1/viewer | Anchor: "A viewer in this broadcast area has been watching for {totalMinutes} minutes." Pause. "We'd like them to know that's fine." |
| E07 | 2 | 13 | tune-in | Distinct channels ≥ 3, E05 fired | 1/viewer | Voice reads history: "Emergency transmission. This viewer has watched channels {visitedList}. Most recently, channel {lastChannel}." Slate: `DO NOT CHANGE THE CHANNEL`. |
| E08 | 2 | Any | tune-in | Local hour 0–4 | 1/session | Slate 3 s: `IT IS {localTime}.` / `YOU ARE STILL UP.` |
| E09 | 2 | 04 | item-boundary | Last channel was 13 | 1/viewer | Gourd: "You went to the bad channel. We saw." |
| E10 | 3 | 13 | tune-in | Act 3 | 1/viewer | **Sign-off.** Voice: "This concludes tonight's broadcast. Thank you for your attention. We have enjoyed yours." Picture collapses, then fixed sign-off text. Priority highest. |
| E11 | 4 | 02 | tune-in | After hours | 1/viewer | Empty news desk. Ticker: `WELCOME BACK`. Programming continues. |
| E12 | 4 | 13 | tune-in | Session count ≥ 2 | 1/session | Slate: `YOU CAME BACK.` / `VISIT {visitCountCurrent}.` |
| E13 | 3 | 02, 04, 07 | tune-in | E07 fired | 1/viewer | **It rips back.** The programme carries on. Room lights sink, a shape pushes the wallpaper from behind, then the wall rips from the other side. Lights return. Nobody mentions it. |

**Writing rules:** every line must be possible on real TV, understated, and short. Threats stay implied and never instruct the viewer to do anything. Prefer one wrong detail to five.

### Startles

A few seconds each, then back to the programme. These run on their own clock, separate from the story events above, and from Act 0.

| ID | Where | From act | What happens |
|---|---|---|---|
| S01-S04 | Ch 2, 4, 7, 13 | 0 | No warning. A face fills the window, cuts closer twice with its mouth falling open, then black, and something moans in the dark. |
| J01-J10 | Any | 0 | The same no-warning cut, each with its own sound: hands on fogged glass, one eye, a maw, a cracked doll, a crowd, a figure in static, a rotten pumpkin, a spider, a skull, claws through the wall. |
| S05 | Room | 0 | Three knocks and the lights dip. The programme carries on. |
| S06 | Room | 1 | The lights sink, something scrapes, and pale eyes show behind the viewer's own tears. |
| S07 | Room | 0 | The lights sink slowly over a heartbeat. |
| T03 | Room, first tear | 0 | The first tear is answered by claws through the wall. |
| T01 | Room, on a tear | 0 | The wall knocks back. |
| T02 | Room, on a tear | 1 | Breathing, and eyes behind the tear just made. |

## 9. Sign-off

Exact text; no other wording:

```
NO SIGNAL

THANK YOU FOR WATCHING.

BROADCAST TERMINATED · 00:00:13
```

## 10. Generation prompts

Use as starting points. Add "original fictional character; do not resemble any real person or existing franchise."

**Anchor:** "Medium shot of a fictional 1980s local television news anchor, 50s, grey suit, neutral expression, looking at camera, seated at a laminate news desk, flat studio lighting, shot on broadcast video, slight softness, 4:3."

**Newsroom:** "Empty 1980s local TV news set, navy backdrop with abstract city silhouette, laminate desk, no logos, no text, 4:3, shot on broadcast video."

**Mister Gourd:** "Handmade felt puppet of a friendly pumpkin with stitched smile, on a colourful cardboard children's TV set, 1970s public access look, 4:3, soft video image."

**Shopping set:** "1980s late-night home shopping TV set, pastel gradient backdrop, shelf with empty space, glossy counter, no text, no brands, 4:3, video look."

**Night Light:** "Studio product shot of a strange antique night light glowing faintly, black velvet, infomercial lighting, no text, no brand."

**Test card:** Build in code or vector art rather than generating, so it doesn't resemble a real broadcaster's test card.

## 11. Curating long programming

For every item, a human fills in the catalogue fields, including `rights`.

1. **Prefer the `file` path.** Verified public-domain or suitably licensed film gets the CRT shader. Good places to look: Internet Archive collections such as Prelinger Archives, checking each specific item's licence rather than assuming.
2. **Then permitted YouTube embeds.** Prefer creators who publish under a Creative Commons licence or who have given permission. Run `npm run check:youtube`.
3. **Avoid** commercial music, mainstream TV, and anything age-restricted.
4. **Transcode** to H.264 MP4 at 640×480 or similar. The CRT look hides resolution, and small files load fast.
5. **Keep a log** in `docs/rights-log.md`: item, source URL, evidence, date checked, who checked.

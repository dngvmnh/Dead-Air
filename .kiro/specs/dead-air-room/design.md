# Design: DEAD AIR Room

Read `.kiro/specs/dead-air-tv/design.md` first. Everything there still holds unless this file changes it. The YouTube rules in `youtube-compliance.md` override any idea here.

## 1. Composition

```
Room
├── canvas.room      (new; position: fixed; full viewport; z-index 0; aria-hidden)
└── Chassis          (z-index 1; opaque bezel; unchanged rules)
    └── TubeOpening
        ├── canvas.crt
        └── div.yt-surface
```

- The room canvas is behind the chassis, so it can never overlap the tube or the player. This is what keeps the feature inside the clean-feed rule, and the existing rule against full-screen overlays.
- Room, Chassis, and TubeOpening keep the ban on `transform`, `filter`, `opacity`, `clip-path`, `mask`, and `mix-blend-mode`. Any room shake happens inside the room shader.
- The chassis is never torn. It stays DOM, opaque, and fully operable.
- Room canvas internal resolution is capped at 1280×800 and never follows device pixels. Set `touch-action: none` on it only, so page scroll elsewhere still works.

## 2. Tear simulation (`src/core/tearSheet.ts`)

A pure, deterministic Verlet sheet. It takes `dtMs` and a seed as arguments and uses no DOM or clock, per `tech.md`.

```ts
export interface TearSheet {
  xs: Float32Array; ys: Float32Array; zs: Float32Array; // current
  px: Float32Array; py: Float32Array; pz: Float32Array; // previous
  pinned: Uint8Array;
  constraints: Int32Array;     // pairs of node indices
  restLength: Float32Array;
  broken: Uint8Array;          // 1 once broken; never reset
  tearLimit: Float32Array;     // jittered by seed, so tears wander like fibre
}

export function createSheet(cols: number, rows: number, seed: number): TearSheet;
export function grab(sheet: TearSheet, id: number, x: number, y: number): void;
export function moveGrab(sheet: TearSheet, id: number, x: number, y: number): void;
export function release(sheet: TearSheet, id: number): void;
export function stepSheet(sheet: TearSheet, dtMs: number): void; // fixed 16.67 ms sub-steps, 3 solver iterations
```

Grid sizes: wall about 96×60 nodes, tube about 48×36. Tune them to meet the budget and record the final values in the design log.

Nodes along the outer edge are pinned, so paper rips rather than flying off. Structural constraints run along grid lines and diagonals. `z` gives the curl and lift used for lighting and shadow.

A connected-component pass runs when constraints break, not every frame. Detached pieces fall under gravity, and are removed after they settle below the viewport.

**Properties for fast-check:**

- Positions stay finite for any input.
- A broken constraint never becomes unbroken.
- Pinned nodes never move.
- The same seed and inputs produce the same state.

## 3. Rendering a sheet (`src/render/tearRenderer.ts`)

- Upload node positions to a dynamic buffer each frame. Triangles with a broken constraint get zero area, using a static index buffer and a per-vertex `alive` attribute, or a rebuilt index buffer on break events only. Choose the cheaper one and note it.
- Fragment shader: sample the front texture by rest UV. Light from a normal derived from `z`. Near a torn edge, use noise to erode the alpha and paint a pale fibre band, so edges look ripped instead of polygonal. Under lifted flaps, draw a blurred drop shadow onto the behind layer.
- Behind layer: a separate texture, or a live 2D canvas uploaded when it changes.
- `tearRenderer` is shared by both canvases.

### Wall sheet

Front texture: wallpaper baked once at load from a 2D canvas. Behind texture: section 4.

### Tube sheet

Insert a new pass into `CrtRenderer`:

```
source texture → tear pass (FBO 640×480) → existing CRT fragment shader → canvas
```

When no tear exists, skip the pass and sample the source directly, so an untouched picture costs nothing extra. Add to `Renderer`:

```ts
setTubeTearEnabled(enabled: boolean): void;
tubePointer(e: TubePointerInput): void;
resetTubeTear(): void;
setReflection(video: HTMLVideoElement | null, level01: number): void;
```

`Screen` attaches pointer handlers to the canvas only, and only when the current source's surface is `canvas`. `FallbackRenderer` implements these as no-ops.

**Behind the tube picture:** a procedural dark layer in the channel's look. On channel 13 from Act 2, it shows the wall of the viewer's own room, so the picture seems to be a hole.

## 4. Behind layer by act (`src/render/behindRenderer.ts`)

| Act | Behind the wallpaper |
|---|---|
| 0 | Older wallpaper, then plaster and lath. Ordinary. |
| 1 | Plaster with pencil marks: a tally of the viewer's visits. |
| 2 | Plaster scratched with `visitedList` and the local time of first viewing. A small second TV glows far away in the gap, showing static. |
| 3 | Darkness that moves very slowly. The shape is only visible at the edge of a tear, and turns toward the pointer with a delay. |
| 4 | Rows of dim television sets, all with the sign-off text. |

Text passes through `core/template.ts`, using real values and fallbacks. There is no gore, and nothing appears suddenly. All of it is drawn procedurally, with placeholder art allowed until task 21.

## 5. Room (`src/render/roomRenderer.ts`, `src/core/roomState.ts`)

```ts
export interface RoomInput {
  memory: ViewerMemory;
  phase: TvPhase;
  picture: { r: number; g: number; b: number } | null; // null: off or YouTube
  localHour: number;
  localMinute: number;
  reduced: boolean;
}

export interface RoomState {
  ambient: number;      // falls by act
  tvLight: { r: number; g: number; b: number; amount: number };
  figureStep: number;
  objectVariant: number;
  repairVisible: boolean;
}

export function deriveRoom(input: RoomInput): RoomState;
```

**Look.** A low-key 1980s living room at night, seen head-on, with the set in the centre on a wooden stand. Wallpaper in sickly olive and umber, with faded repeating paper bats and jack-o'-lanterns. A paper garland, a candy bowl, a shelf with a frame, a wall clock showing real local time, and a window showing darkness. Halloween decoration is cheap and homemade, which makes it sad rather than cute. Use original art only.

**Light.** The picture colour lights the wall from the centre outward, falling off with distance. Sample from the owned 2D source canvas into an 8×8 buffer, at most 8 Hz, and smooth over about 400 ms. Never sample a YouTube iframe.

**Figure.** A soft silhouette on the wall, cast by the TV light, in steps: step 0 absent, step 1 at the far edge of the room, then closer. Step advances are computed from act and session count, stored in memory, and applied only during an unobserved moment. Add the step to memory, so a reload does not move it.

**Objects.** One variant advances during an unobserved moment after a qualifying visit: the frame tilts, the bowl is empty, the garland is down. Follow the same principle as channel 07's set: derived, and stable within a visit.

## 6. Memory (schema version 2)

```ts
export interface ViewerMemoryV2 extends Omit<ViewerMemory, 'schemaVersion'> {
  schemaVersion: 2;
  room: {
    strokes: Array<{ seed: number; session: number; points: Array<[number, number]> }>; // normalised 0..1; 24 strokes max, 32 points each
    figureStep: number;
    objectVariant: number;
    ripBackDone: boolean;
  };
}
```

Key stays `deadair.memory.v1`, because `schemaVersion` handles the migration. Keep the throttled writes, and flush on stroke end. The oldest stroke drops first at the cap. On load, rebuild by replaying strokes through a fast non-rendered path capped at 100 ms. If that would exceed the cap, drop the oldest strokes.

Rebuilt sheets do not need to match pixel-for-pixel. They must only look like the same damage.

## 7. Director additions

Add event steps. Adding a future event must not need engine changes.

```ts
| { do: 'roomLights'; level: number; ms: number }
| { do: 'wallPush'; path: RoomPathId; ms: number }   // bulge moving behind the sheet
| { do: 'wallRip'; path: RoomPathId; ms: number }    // tear driven along a preset path
```

Paths live in `src/content/room/paths.json`, and the validator checks references. Steps run on the existing event runner and honour `eventCancelRef`.

### E13

```json
{
  "id": "E13",
  "minAct": 3,
  "maxAct": 3,
  "channels": [2, 4, 7],
  "seams": ["tune-in"],
  "when": { "eventFired": "E07" },
  "limit": { "perViewer": 1 },
  "priority": 4,
  "chain": true,
  "steps": [
    { "do": "roomLights", "level": 0.08, "ms": 1400 },
    { "do": "silence", "ms": 1200 },
    { "do": "wallPush", "path": "left-of-set", "ms": 2200 },
    { "do": "wallRip", "path": "left-of-set", "ms": 900 },
    { "do": "silence", "ms": 1800 },
    { "do": "roomLights", "level": 1, "ms": 1200 }
  ]
}
```

The programme keeps playing normally on the tube, and no line is spoken. The event must allow a new step type with no picture, so `EventPresenter` does not replace the source during room-only steps.

Order on the demo path: E07 enters Act 3 on channel 13, the next tune fires E13, and the viewer returns to 13 for E10.

With reduced motion: `roomLights` to 0.02, apply the tear instantly while dark, then restore.

Set `ripBackDone` in memory and flush when E13's rip step finishes. On load, a viewer who reached Act 4 without E13 keeps a torn wall as after-hours state. Nothing stays pending.

## 8. Reflection (`src/render/reflection.ts`)

```ts
export interface ReflectionController {
  enable(): Promise<'on' | 'denied' | 'unavailable'>;
  disable(): void; // stops all tracks and clears srcObject
  video(): HTMLVideoElement | null;
}
```

- `getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false })`, only from the rear-panel click handler.
- The hidden `<video>` is never in the visible DOM. Its only consumer is the CRT texture upload.
- No `readPixels`, `drawImage`, recording, or canvas export on this data anywhere. Add a unit test or lint guard that this module is imported only by `Screen`, and is never used with those APIs.
- Shader: greyscale, mirrored, about 8 to 12% brightness, slightly blurred, curved, with the existing glass gloss. It adds to the dark tube rather than replacing it.
- `steadyDrive` decides visibility: `OFF` after the shutdown ends, plus scripted `silence` steps on owned sources.
- Act 3 adds a soft, fixed shadow to the shader, at a fixed place beside the centre. No detection. It is pure theatre.
- When the tab becomes hidden, stop all tracks and set the control to off. Pressing POWER does not affect the camera.
- Chassis: a small `REFL` lamp that lights only while a track is live.
- Rear-panel copy: "Reflection (optional). Uses your camera to show you in the glass. Stays on this device. Nothing is recorded or sent."

**Hosting:** `Permissions-Policy: camera=(self), microphone=(), geolocation=()`.

## 9. Audio

Rip: filtered noise burst with envelope following drag speed, plus a short low thump on detach. Behind-wall rumble for `wallPush`: a sub-100 Hz shaped noise, still within the 6 dB stinger limit. All of it goes through the SFX bus. A pointer gesture unlocks audio if POWER has not already.

## 10. Test seams

- `window.__room`, only under the existing test flag: strokes count, broken count, figure step, ambient level, last light sample, reflection active.
- A Playwright fake-camera flag (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`) for reflection on/off, track stopping, and YouTube and sign-off suppression. Never contact a real camera in tests.
- Real WebGL for tear tests. Pixel-compare a region before and after a drag, so a test cannot pass on state alone.

## 11. Key decisions

| Decision | Why | Rejected alternative |
|---|---|---|
| Hand-written Verlet in `core` | Pure, testable, tiny | three.js or a physics library: forbidden by `tech.md`, and large |
| Room canvas behind the chassis | Clean-feed safe by construction | Whole-page tear over the set: illegal over YouTube |
| Picture tear inside the CRT pipeline | Looks like part of the tube, and owned sources only | DOM overlay on the tube: banned |
| Reflection with no face analysis | Almost all the fear at almost no privacy or bundle cost | MediaPipe: big, and makes it surveillance |
| E13 data-driven | Project rule: horror is data | Bespoke code path |
| No HTML-in-canvas | Trial only, and not cross-browser | Would have let real DOM tear |

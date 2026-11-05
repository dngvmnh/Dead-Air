---
inclusion: always
---

# Structure

```
.kiro/                     Steering, specs, hooks (committed; required project evidence)
docs/                      Media bible, research notes
public/
  media/                   Small assets only: images, short audio (each under 5 MB)
scripts/
  validate-catalog.ts      Schema, rights, duration and policy checks
  check-youtube.ts         Optional online check of YouTube IDs
src/
  core/                    Pure logic. No React, DOM, Date.now or Math.random
    clock.ts               resolveBroadcast()
    memory.ts              ViewerMemory reducer and act computation
    director.ts            decideEvent()
    conditions.ts          Evaluates event condition data
    template.ts            Fills {lastChannel}-style variables
    tvMachine.ts           TV state machine reducer
    types.ts
  content/
    catalog/               ch02.json, ch04.json, ch07.json, ch13.json
    events/                events.json
    scenes/                Scene programme definitions
    schema.ts              Zod schemas
  playback/
    PlaybackAdapter.ts     Interface
    SceneAdapter.ts
    FileAdapter.ts
    YouTubeAdapter.ts
    loadYouTubeApi.ts
  render/
    crtShader.ts           GLSL and uniforms
    CrtRenderer.ts         WebGL2 pipeline
    sceneRenderer.ts       Draws a scene at a time offset onto a 2D canvas
    looks.ts               broadcast, vhs, deadair presets
  audio/
    AudioEngine.ts         Context, noise, tuning, buses
    stems.ts               Voice stem stitching
  persistence/
    memoryStore.ts         Versioned localStorage with in-memory fallback
  app/
    App.tsx
    useTelevision.ts       Wires clock, director, adapters, audio, memory
  components/
    Room/  Chassis/  Screen/  YouTubeSurface/  Remote/  StartNotice/
  styles/tokens.css
tests/e2e/
```

## Dependency direction

`components` and `app` may import everything. `playback`, `render`, `audio` and `persistence` may import `core` types. `core` imports nothing from the project except its own files and `content` types.

## Naming

Components use `PascalCase.tsx`; other modules use `camelCase.ts`. Tests sit beside the code as `*.test.ts`. Event ids are `E01`-style and stable once shipped, because they are stored in viewer memory.

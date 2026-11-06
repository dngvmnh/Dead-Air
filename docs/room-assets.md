# Room assets

Authorship and rights for the DEAD AIR room art (requirement 10.3, 10.4;
safety-and-rights.md). Every asset here is **original** and **procedural** —
drawn in code at load time onto 2D canvases, with no external files and nothing
copied from Tearable UI or any other reference (its licence is unknown).

| Asset | Where | Method | Rights |
|---|---|---|---|
| Wallpaper field (olive/umber gradient, vertical stripes, grain) | `src/render/roomWallpaper.ts` `bakeWallpaper` | Procedural 2D canvas | original |
| Repeating paper bats and jack-o'-lanterns | `bakeWallpaper` (`bat`, `pumpkin`) | Procedural vector shapes | original |
| Paper garland | `bakeRoom` | Procedural | original |
| Candy bowl + candy (empties at objectVariant ≥ 2) | `bakeRoom` | Procedural | original |
| Framed picture (tilts at objectVariant ≥ 1) | `bakeRoom` | Procedural | original |
| Window onto darkness + faint moon | `bakeRoom` | Procedural | original |
| Wall clock showing the viewer's real local time | `bakeRoom` | Procedural; hands from injected local hour/minute | original |
| Plaster, lath, cracks and damp | `bakeBehindPlaster` | Procedural | original |
| Older wallpaper patches (Act 0) | `render/behindRenderer.ts` | Procedural | original |
| Pencil tally of real visits (Act 1) | `render/behindRenderer.ts` | Procedural; real values only | original |
| Scratched history, far televisions (Act 2) | `render/behindRenderer.ts` | Procedural; real values only | original |
| Moving dark and a shape (Act 3) | `render/tearRenderer.ts` | Shader | original |
| Rows of televisions with the fixed sign-off text (Act 4) | `render/behindRenderer.ts` | Procedural | original |

Notes:

- No external image or audio files are used for the room. Nothing is downloaded
  or re-hosted. The paper-rip and detach sounds are procedural Web Audio
  (`src/audio/AudioEngine.ts`), not samples.
- The clock reads the local time only; it never infers or shows a location
  (safety-and-rights.md).
- The behind-layer imagery per act is procedural and implied, with no gore, no
  real people, and no real locations (requirement 3.3).
- Budget: these bakes run once at load and draw to canvases well under 5 MB;
  there are no media binaries in git (requirement 10.3, media storage rules).

/**
 * Bakes the Halloween wallpaper onto a 2D canvas once (design §5). Original,
 * procedural art: a sickly olive/umber field with faded repeating paper bats
 * and jack-o'-lanterns. Task 4 enriches the room; task 3 only needs a believable
 * paper front to tear. Behind-layer art is `behindRenderer` (task 6); here the
 * behind texture is a plain dark plaster so a tear reveals *something*.
 */

export interface BakedTexture {
  canvas: HTMLCanvasElement;
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for wallpaper bake');
  return { canvas, ctx };
}

/** A faded paper bat at (x,y) scaled by s. */
function bat(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.quadraticCurveTo(-10, -14, -22, -8);
  ctx.quadraticCurveTo(-14, -4, -16, 6);
  ctx.quadraticCurveTo(-8, 0, 0, 6);
  ctx.quadraticCurveTo(8, 0, 16, 6);
  ctx.quadraticCurveTo(14, -4, 22, -8);
  ctx.quadraticCurveTo(10, -14, 0, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A small jack-o'-lantern at (x,y). */
function pumpkin(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  // Eyes + grin, cut as negative triangles.
  ctx.beginPath();
  ctx.moveTo(-7, -3);
  ctx.lineTo(-3, -3);
  ctx.lineTo(-5, 1);
  ctx.closePath();
  ctx.moveTo(7, -3);
  ctx.lineTo(3, -3);
  ctx.lineTo(5, 1);
  ctx.closePath();
  ctx.moveTo(-6, 4);
  ctx.lineTo(0, 7);
  ctx.lineTo(6, 4);
  ctx.lineTo(3, 6);
  ctx.lineTo(-3, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Bake the repeating wallpaper. `ambient` (0..1) dims the whole sheet so the
 * room can darken by act without re-baking (the renderer could also dim, but a
 * single baked level keeps the front texture honest for the tear).
 */
export function bakeWallpaper(w = 1024, h = 768): BakedTexture {
  const { canvas, ctx } = makeCanvas(w, h);
  // Base paper: a warmer, lighter olive/umber so the TV light pool has a
  // mid-tone to pick out (task 5a.2). The renderer darkens the edges to black;
  // the paper itself must read as paper where the light lands.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#8a7c46');
  grad.addColorStop(0.5, '#786a3c');
  grad.addColorStop(1, '#5f5330');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle vertical stripes, like old wallpaper.
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let x = 0; x < w; x += 48) ctx.fillRect(x, 0, 24, h);

  // Repeating motif grid: alternating bats and pumpkins, with enough contrast
  // to be clearly readable where the light lands (task 5a.2).
  const stepX = 96;
  const stepY = 110;
  let row = 0;
  for (let y = 40; y < h; y += stepY) {
    const offset = row % 2 === 0 ? 0 : stepX / 2;
    for (let x = 40 + offset; x < w; x += stepX) {
      if ((x + y) % 3 === 0) {
        ctx.fillStyle = 'rgba(255, 140, 30, 0.42)';
        pumpkin(ctx, x, y, 1.1);
      } else {
        ctx.fillStyle = 'rgba(28, 18, 10, 0.55)';
        bat(ctx, x, y, 1);
      }
    }
    row += 1;
  }

  // Grain speckle for paper texture (deterministic enough; bake-once).
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let seed = 0x9e3779b9;
  for (let i = 0; i < d.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const n = ((seed >>> 24) / 255 - 0.5) * 14;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);

  return { canvas };
}

/**
 * Bake the full room front: the wallpaper plus the dim Halloween living-room
 * objects (requirement 5.1) — a paper garland, a candy bowl on a shelf, a
 * framed picture, a window onto darkness, and a wall clock showing the viewer's
 * real local time. Original procedural art. These are baked onto the tearable
 * paper so the whole room rips as one sheet (the world is paper, design/product
 * principle 7). `objectVariant` moves one object (design §5): 1 tilts the frame,
 * 2 empties the bowl.
 */
export function bakeRoom(
  localHour: number,
  localMinute: number,
  objectVariant = 0,
  w = 1024,
  h = 768,
): BakedTexture {
  const base = bakeWallpaper(w, h);
  const ctx = base.canvas.getContext('2d');
  if (!ctx) return base;

  // Objects are placed in the EXPOSED side bands (task 5a.2): the chassis sits
  // in the centre of the viewport, so the left band is roughly x 0..0.24 and the
  // right band x 0.76..1. The wall texture maps 1:1 to the viewport, so these
  // UV fractions are where the object lands on screen.

  // Window onto darkness, high in the LEFT band.
  ctx.save();
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(w * 0.03, h * 0.14, w * 0.17, h * 0.26);
  ctx.strokeStyle = '#2a2016';
  ctx.lineWidth = 6;
  ctx.strokeRect(w * 0.03, h * 0.14, w * 0.17, h * 0.26);
  ctx.beginPath();
  ctx.moveTo(w * 0.115, h * 0.14);
  ctx.lineTo(w * 0.115, h * 0.4);
  ctx.moveTo(w * 0.03, h * 0.27);
  ctx.lineTo(w * 0.2, h * 0.27);
  ctx.stroke();
  // A faint moon.
  ctx.fillStyle = 'rgba(190, 190, 160, 0.3)';
  ctx.beginPath();
  ctx.arc(w * 0.15, h * 0.2, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Paper garland across the top: a sagging string of little triangles.
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  const gy = h * 0.06;
  ctx.beginPath();
  ctx.moveTo(0, gy);
  for (let x = 0; x <= w; x += 60) ctx.quadraticCurveTo(x + 30, gy + 22, x + 60, gy);
  ctx.stroke();
  for (let x = 20; x < w; x += 60) {
    ctx.fillStyle = (x / 60) % 2 === 0 ? 'rgba(255,123,0,0.5)' : 'rgba(106,13,173,0.5)';
    ctx.beginPath();
    ctx.moveTo(x, gy + 12);
    ctx.lineTo(x + 16, gy + 12);
    ctx.lineTo(x + 8, gy + 34);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Shelf in the RIGHT band, with a candy bowl and a framed picture.
  ctx.save();
  const shelfY = h * 0.64;
  const shelfX = w * 0.76;
  ctx.fillStyle = '#2a2018';
  ctx.fillRect(shelfX, shelfY, w * 0.22, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(shelfX, shelfY + 10, w * 0.22, 6);
  // Candy bowl (empty at variant ≥ 2).
  ctx.fillStyle = '#3a2d22';
  ctx.beginPath();
  ctx.ellipse(w * 0.82, shelfY - 6, 34, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  if (objectVariant < 2) {
    for (let i = 0; i < 6; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#c8318a' : '#ff7b00';
      ctx.beginPath();
      ctx.arc(w * 0.82 - 20 + i * 8, shelfY - 12, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Framed picture on the wall above the shelf, tilted at variant ≥ 1.
  ctx.translate(w * 0.92, shelfY - 44);
  if (objectVariant >= 1) ctx.rotate(-0.12);
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(-34, -40, 68, 52);
  ctx.strokeStyle = '#4a3a2a';
  ctx.lineWidth = 4;
  ctx.strokeRect(-34, -40, 68, 52);
  ctx.fillStyle = 'rgba(140,128,104,0.5)';
  ctx.fillRect(-28, -34, 56, 40);
  ctx.restore();

  // Wall clock showing the real local time (requirement 5.1), in the RIGHT band
  // high up, clear of the chassis.
  ctx.save();
  const cx = w * 0.86;
  const cy = h * 0.24;
  const rad = 46;
  ctx.fillStyle = '#2a2318';
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#9a834a';
  ctx.lineWidth = 5;
  ctx.stroke();
  // Hour ticks so it reads as a clock.
  ctx.strokeStyle = 'rgba(216, 207, 191, 0.7)';
  ctx.lineWidth = 2;
  for (let t = 0; t < 12; t += 1) {
    const a = t * (Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rad * 0.82, cy + Math.sin(a) * rad * 0.82);
    ctx.lineTo(cx + Math.cos(a) * rad * 0.94, cy + Math.sin(a) * rad * 0.94);
    ctx.stroke();
  }
  // Hands from the real local time.
  const hourAng = ((localHour % 12) + localMinute / 60) * (Math.PI / 6) - Math.PI / 2;
  const minAng = localMinute * (Math.PI / 30) - Math.PI / 2;
  ctx.strokeStyle = '#d8cfbf';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(hourAng) * rad * 0.5, cy + Math.sin(hourAng) * rad * 0.5);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(minAng) * rad * 0.8, cy + Math.sin(minAng) * rad * 0.8);
  ctx.stroke();
  ctx.restore();

  return base;
}

/**
 * Plaster and lath behind the paper (task 5a.5). In Act 0 this reads as pale,
 * dry plaster over wooden lath — clearly LIGHTER than the olive wallpaper, so a
 * tear is obvious at a glance. The renderer's shadow pass and the behind layer
 * per act (task 6) add dread later; here the job is contrast, not darkness.
 */
export function bakeBehindPlaster(w = 1024, h = 768): BakedTexture {
  const { canvas, ctx } = makeCanvas(w, h);
  // Pale, slightly grubby plaster base.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#cdc3ad');
  grad.addColorStop(1, '#b3a78d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Exposed wooden lath strips showing through broken plaster.
  ctx.fillStyle = 'rgba(92, 66, 38, 0.55)';
  for (let y = 10; y < h; y += 30) ctx.fillRect(0, y, w, 12);
  // Lath shadow gaps.
  ctx.fillStyle = 'rgba(30, 20, 12, 0.4)';
  for (let y = 24; y < h; y += 30) ctx.fillRect(0, y, w, 4);

  // Cracks and stains in the plaster, so it is not a flat fill.
  ctx.strokeStyle = 'rgba(40, 30, 22, 0.35)';
  ctx.lineWidth = 1.5;
  let seed = 0x1234567;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed >>> 8) / 16777216;
  };
  for (let i = 0; i < 40; i += 1) {
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 120, y + (rnd() - 0.5) * 60);
    ctx.stroke();
  }
  // Damp stains.
  for (let i = 0; i < 10; i += 1) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 30 + rnd() * 70;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, 'rgba(70, 55, 38, 0.3)');
    g.addColorStop(1, 'rgba(70, 55, 38, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return { canvas };
}

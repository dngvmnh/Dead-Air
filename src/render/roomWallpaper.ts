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
  // Base paper: vertical olive/umber gradient with a faint grain.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#4a4326');
  grad.addColorStop(0.5, '#3e3822');
  grad.addColorStop(1, '#332d1b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle vertical stripes, like old wallpaper.
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let x = 0; x < w; x += 48) ctx.fillRect(x, 0, 24, h);

  // Repeating motif grid: alternating bats and pumpkins, faded into the paper.
  const stepX = 96;
  const stepY = 110;
  let row = 0;
  for (let y = 40; y < h; y += stepY) {
    const offset = row % 2 === 0 ? 0 : stepX / 2;
    for (let x = 40 + offset; x < w; x += stepX) {
      if ((x + y) % 3 === 0) {
        ctx.fillStyle = 'rgba(255, 150, 40, 0.16)';
        pumpkin(ctx, x, y, 1.1);
      } else {
        ctx.fillStyle = 'rgba(20, 15, 10, 0.3)';
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

  // Window onto darkness (upper-left): a cold rectangle with a faint cross bar.
  ctx.save();
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(w * 0.06, h * 0.12, w * 0.2, h * 0.26);
  ctx.strokeStyle = '#2a2016';
  ctx.lineWidth = 6;
  ctx.strokeRect(w * 0.06, h * 0.12, w * 0.2, h * 0.26);
  ctx.beginPath();
  ctx.moveTo(w * 0.16, h * 0.12);
  ctx.lineTo(w * 0.16, h * 0.38);
  ctx.moveTo(w * 0.06, h * 0.25);
  ctx.lineTo(w * 0.26, h * 0.25);
  ctx.stroke();
  // A faint moon.
  ctx.fillStyle = 'rgba(180, 180, 150, 0.22)';
  ctx.beginPath();
  ctx.arc(w * 0.2, h * 0.18, 14, 0, Math.PI * 2);
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

  // Shelf (lower-right) with a candy bowl and a framed picture.
  ctx.save();
  const shelfY = h * 0.66;
  ctx.fillStyle = '#2a2018';
  ctx.fillRect(w * 0.62, shelfY, w * 0.3, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(w * 0.62, shelfY + 10, w * 0.3, 6);
  // Candy bowl (empty at variant ≥ 2).
  ctx.fillStyle = '#3a2d22';
  ctx.beginPath();
  ctx.ellipse(w * 0.7, shelfY - 6, 34, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  if (objectVariant < 2) {
    for (let i = 0; i < 6; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#c8318a' : '#ff7b00';
      ctx.beginPath();
      ctx.arc(w * 0.7 - 20 + i * 8, shelfY - 12, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Framed picture, tilted at variant ≥ 1.
  ctx.translate(w * 0.84, shelfY - 40);
  if (objectVariant >= 1) ctx.rotate(-0.12);
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(-34, -40, 68, 52);
  ctx.strokeStyle = '#4a3a2a';
  ctx.lineWidth = 4;
  ctx.strokeRect(-34, -40, 68, 52);
  ctx.fillStyle = 'rgba(120,110,90,0.4)';
  ctx.fillRect(-28, -34, 56, 40);
  ctx.restore();

  // Wall clock showing the real local time (requirement 5.1).
  ctx.save();
  const cx = w * 0.46;
  const cy = h * 0.2;
  const rad = 44;
  ctx.fillStyle = '#1c1610';
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6a5a3a';
  ctx.lineWidth = 4;
  ctx.stroke();
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

/** Dark plaster/lath behind the paper, so a tear reveals a believable layer. */
export function bakeBehindPlaster(w = 1024, h = 768): BakedTexture {
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = '#17120e';
  ctx.fillRect(0, 0, w, h);
  // Horizontal lath lines in the gloom.
  ctx.strokeStyle = 'rgba(60, 48, 36, 0.5)';
  ctx.lineWidth = 2;
  for (let y = 18; y < h; y += 26) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // A faint cold draught of darkness at the centre.
  const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.7)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return { canvas };
}

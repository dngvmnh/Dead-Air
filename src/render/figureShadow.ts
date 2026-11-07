/**
 * The figure on the wall (requirement 5.5). It is only ever a shadow: nothing in
 * the room could be casting it. Each step stands closer to the set, so it gets
 * taller and moves in from the far edge of the room, until it leans over the top
 * of the chassis. Painted onto a copy of the wall, so it darkens whatever it falls
 * on, tears with the paper, and only changes when the wall is rebaked, which
 * happens in unobserved moments. Original, procedural art.
 */

interface Stance {
  /** Where the feet are, as wall fractions. */
  x: number;
  feet: number;
  /** How tall it stands, as a fraction of the wall's height. */
  height: number;
  /** Which way the head hangs, in figure heights. */
  lean: number;
}

/** Index 0 is step 1. The set covers about x 0.15 to 0.85, so all of this is in the side band. */
const STANCES: readonly Stance[] = [
  { x: 0.985, feet: 1.0, height: 0.52, lean: -0.02 },
  { x: 0.965, feet: 1.04, height: 0.72, lean: -0.03 },
  { x: 0.945, feet: 1.06, height: 0.86, lean: -0.05 },
  { x: 0.93, feet: 1.08, height: 0.96, lean: -0.08 },
  { x: 0.92, feet: 1.1, height: 1.04, lean: -0.15 },
];

export const FIGURE_STEPS = STANCES.length;

/** Draw the outline in figure units: 0 is the top of the head, 1 the feet. */
function drawFigure(ctx: CanvasRenderingContext2D, lean: number): void {
  // Head, too long and hanging forward.
  ctx.beginPath();
  ctx.ellipse(lean, 0.075, 0.042, 0.075, lean * 2, 0, Math.PI * 2);
  ctx.fill();
  // Neck, shoulders, a ribcage and very little below it.
  ctx.beginPath();
  ctx.moveTo(lean - 0.018, 0.12);
  ctx.quadraticCurveTo(-0.03, 0.17, -0.115, 0.205);
  ctx.quadraticCurveTo(-0.09, 0.36, -0.052, 0.58);
  ctx.lineTo(-0.058, 1.05);
  ctx.lineTo(-0.012, 1.05);
  ctx.lineTo(0, 0.62);
  ctx.lineTo(0.016, 1.05);
  ctx.lineTo(0.06, 1.05);
  ctx.lineTo(0.052, 0.58);
  ctx.quadraticCurveTo(0.09, 0.36, 0.115, 0.205);
  ctx.quadraticCurveTo(0.04, 0.17, lean + 0.018, 0.12);
  ctx.closePath();
  ctx.fill();
  // Arms that go down past where its knees should be.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const side of [-1, 1]) {
    const sx = 0.108 * side;
    const ex = 0.142 * side;
    const hx = 0.13 * side;
    ctx.lineWidth = 0.024;
    ctx.beginPath();
    ctx.moveTo(sx, 0.215);
    ctx.lineTo(ex, 0.46);
    ctx.lineTo(hx, 0.7);
    ctx.stroke();
    ctx.lineWidth = 0.007;
    for (let f = 0; f < 4; f += 1) {
      ctx.beginPath();
      ctx.moveTo(hx, 0.7);
      ctx.lineTo(hx + (f - 1.5) * 0.017, 0.82 + (f === 1 || f === 2 ? 0.035 : 0));
      ctx.stroke();
    }
  }
}

/** The wall with the figure's shadow on it. Step 0 is the wall itself, untouched. */
export function paintFigure(wall: HTMLCanvasElement, step: number): HTMLCanvasElement {
  const stance = STANCES[Math.min(step, FIGURE_STEPS) - 1];
  if (!stance) return wall;
  const out = document.createElement('canvas');
  out.width = wall.width;
  out.height = wall.height;
  const ctx = out.getContext('2d');
  const shadow = document.createElement('canvas');
  shadow.width = wall.width;
  shadow.height = wall.height;
  const sh = shadow.getContext('2d');
  if (!ctx || !sh) return wall;

  const H = stance.height * wall.height;
  const put = (target: CanvasRenderingContext2D, dx: number): void => {
    target.save();
    target.translate(stance.x * wall.width + dx, stance.feet * wall.height - H);
    // Narrower than it is tall, on a wall the viewport stretches sideways.
    target.scale(H * 0.72, H);
    target.fillStyle = '#000';
    target.strokeStyle = '#000';
    drawFigure(target, stance.lean);
    target.restore();
  };
  // Drawn off the canvas so only its blurred shadow lands: this softens the edge
  // where the canvas filter property is not available.
  const blur = 3 + step * 1.2;
  sh.shadowColor = '#000';
  sh.shadowBlur = blur;
  sh.shadowOffsetX = wall.width * 2;
  put(sh, -wall.width * 2);
  // Solid in the middle, even with the blurred edge: a shadow, not a smudge.
  sh.shadowColor = 'transparent';
  sh.shadowOffsetX = 0;
  sh.globalAlpha = 0.6;
  put(sh, 0);
  // The feet melt into the skirting.
  sh.globalAlpha = 1;
  sh.globalCompositeOperation = 'destination-in';
  const fade = sh.createLinearGradient(0, stance.feet * wall.height - H * 0.42, 0, stance.feet * wall.height - H * 0.05);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  sh.fillStyle = fade;
  sh.fillRect(0, 0, wall.width, wall.height);

  ctx.drawImage(wall, 0, 0);
  ctx.globalAlpha = Math.min(0.94, 0.72 + step * 0.04);
  ctx.drawImage(shadow, 0, 0);
  return out;
}

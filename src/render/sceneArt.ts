/**
 * Original procedural art for the programmes, standing in until painted or
 * generated art replaces a layer (a bitmap always wins). Everything is a pure
 * function of time, so scenes stay seekable. All characters are original and
 * fictional. The sets stay cheerful and ordinary: the scares need something
 * normal to break.
 */

import type { Ctx2D } from './overlayRenderer.ts';

type Paint = (ctx: Ctx2D, t: number) => void;

const DESIGN_W = 960;
const DESIGN_H = 720;

function ellipse(ctx: Ctx2D, x: number, y: number, rx: number, ry: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function polygon(ctx: Ctx2D, colour: string, points: ReadonlyArray<readonly [number, number]>): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

/** Closed for a beat every few seconds. */
function blinking(t: number, period = 4100): boolean {
  return t % period < 130;
}

/** A talking mouth: never quite regular, so it does not read as a loop. */
function talk(t: number): number {
  return Math.abs(Math.sin(t * 0.021) * Math.sin(t * 0.0067 + 1));
}

function newsroom(ctx: Ctx2D): void {
  ctx.fillStyle = '#16294a';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  ctx.fillStyle = '#20355c';
  for (const [x, h] of [[0, 120], [90, 190], [170, 90], [260, 220], [360, 130], [600, 150], [690, 240], [790, 110], [860, 180]] as const) {
    ctx.fillRect(x, 420 - h, 84, h);
  }
  ctx.fillStyle = '#f4d98a';
  for (let i = 0; i < 26; i += 1) ctx.fillRect((i * 137) % 940, 220 + ((i * 53) % 190), 7, 9);
  ctx.fillStyle = '#4a3324';
  ctx.fillRect(0, 420, DESIGN_W, 300);
  ctx.fillStyle = '#5d4230';
  ctx.fillRect(0, 420, DESIGN_W, 16);
}

function person(ctx: Ctx2D, t: number, staring: boolean): void {
  const lean = staring ? 0 : Math.sin(t * 0.0013) * 4;
  const cx = 480 + lean;
  polygon(ctx, '#39404d', [[cx - 190, 420], [cx - 150, 300], [cx - 44, 270], [cx + 44, 270], [cx + 150, 300], [cx + 190, 420]]);
  polygon(ctx, '#e9e6dc', [[cx - 34, 272], [cx + 34, 272], [cx, 340]]);
  polygon(ctx, '#7c1f26', [[cx - 10, 276], [cx + 10, 276], [cx + 12, 338], [cx, 356], [cx - 12, 338]]);
  ctx.fillStyle = '#c9a48a';
  ctx.fillRect(cx - 28, 232, 56, 46);
  ellipse(ctx, cx, 170, 80, 100, '#d6b197');
  polygon(ctx, '#2a2320', [[cx - 84, 150], [cx - 72, 84], [cx - 20, 62], [cx + 44, 66], [cx + 80, 104], [cx + 84, 150], [cx + 54, 110], [cx - 40, 108]]);
  const eyeY = 158;
  // Staring: no blink, and pupils too small for the light.
  const shut = !staring && blinking(t);
  for (const side of [-1, 1]) {
    const ex = cx + side * 32;
    if (shut) {
      ctx.fillStyle = '#8e6d58';
      ctx.fillRect(ex - 15, eyeY - 2, 30, 4);
    } else {
      ellipse(ctx, ex, eyeY, staring ? 18 : 15, staring ? 12 : 8, '#f1eee6');
      ellipse(ctx, ex, eyeY, staring ? 3 : 6, staring ? 3 : 6, '#1b1512');
    }
  }
  ctx.fillStyle = '#9a7158';
  ctx.fillRect(cx - 4, 176, 8, 26);
  if (staring) {
    // The same fixed line whatever is being said.
    ctx.fillStyle = '#6d3a33';
    ctx.fillRect(cx - 34, 226, 68, 4);
  } else {
    ellipse(ctx, cx, 226, 24, 3 + talk(t) * 11, '#5a2a26');
  }
}

function weatherMap(ctx: Ctx2D, t: number): void {
  ctx.fillStyle = '#123a5c';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  polygon(ctx, '#4e7d4a', [[120, 150], [420, 120], [640, 170], [820, 150], [860, 330], [700, 480], [430, 520], [240, 470], [110, 330]]);
  polygon(ctx, '#3f6a3e', [[300, 240], [470, 210], [560, 300], [440, 400], [300, 360]]);
  ctx.strokeStyle = 'rgba(230, 240, 250, 0.22)';
  ctx.lineWidth = 2;
  for (let x = 120; x < 900; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 120);
    ctx.lineTo(x, 520);
    ctx.stroke();
  }
  for (const [x, y, d] of [[180, 230, 0], [430, 300, 2000], [660, 250, 5000], [560, 420, 9000]] as const) {
    const drift = ((t + d) * 0.012) % 60;
    for (const [ox, oy, r] of [[-30, 6, 24], [0, -6, 32], [32, 6, 22]] as const) {
      ellipse(ctx, x + drift + ox, y + oy, r, r * 0.8, '#d7dde6');
    }
  }
}

function pumpkinSet(ctx: Ctx2D): void {
  ctx.fillStyle = '#4a2a78';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  ctx.fillStyle = '#f6e3a1';
  for (let i = 0; i < 30; i += 1) ctx.fillRect((i * 173) % 950, 100 + ((i * 97) % 290), 8, 8);
  polygon(ctx, '#d87b1e', [[0, 470], [190, 360], [380, 460], [600, 370], [820, 450], [960, 390], [960, 720], [0, 720]]);
  polygon(ctx, '#b85f12', [[0, 560], [960, 520], [960, 720], [0, 720]]);
}

function gourdFace(ctx: Ctx2D, cx: number, cy: number, r: number, turned: boolean, t: number): void {
  ellipse(ctx, cx, cy, r * 1.12, r, '#ea8a24');
  for (const off of [-0.6, 0, 0.6]) ellipse(ctx, cx + off * r, cy, r * 0.3, r * 0.96, 'rgba(198, 106, 20, 0.55)');
  ctx.fillStyle = '#3f7a2c';
  ctx.fillRect(cx - 10, cy - r - 26, 20, 30);
  for (const side of [-1, 1]) {
    ellipse(ctx, cx + side * r * 0.38, cy - r * 0.2, r * 0.17, r * 0.17, '#f4eedb');
    // Felt buttons look ahead until he has noticed you.
    ellipse(ctx, cx + side * r * 0.38 + (turned ? 0 : side * 2), cy - r * 0.2, r * 0.08, r * 0.08, '#17120f');
  }
  ctx.strokeStyle = '#3a1d08';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy + r * 0.28);
  ctx.quadraticCurveTo(cx, cy + r * (turned ? 0.42 : 0.42 + talk(t) * 0.16), cx + r * 0.5, cy + r * 0.28);
  ctx.stroke();
  for (let i = -3; i <= 3; i += 1) {
    const x = cx + (i / 3) * r * 0.42;
    const y = cy + r * (0.35 - Math.abs(i) * 0.008) + (3 - Math.abs(i)) * r * 0.012;
    ctx.fillStyle = '#3a1d08';
    ctx.fillRect(x - 2, y - 7, 4, 14);
  }
}

function gourd(ctx: Ctx2D, t: number): void {
  gourdFace(ctx, 340, 340 + Math.sin(t * 0.004) * 12, 120, false, t);
}

function gourdTurned(ctx: Ctx2D, t: number): void {
  // Bigger and closer to the lens, and he has stopped bobbing.
  ctx.fillStyle = '#4a2a78';
  ctx.fillRect(160, 160, 380, 370);
  gourdFace(ctx, 420, 320, 165, true, t);
}

function dot(ctx: Ctx2D, t: number): void {
  const y = 330 + Math.sin(t * 0.0031 + 1) * 18;
  ellipse(ctx, 680, y, 62, 74, '#f3efe6');
  ctx.fillStyle = '#f3efe6';
  ctx.fillRect(618, y, 124, 74);
  for (let i = 0; i < 4; i += 1) ellipse(ctx, 633 + i * 31, y + 74, 16, 12, '#4a2a78');
  ellipse(ctx, 660, y - 12, 8, 11, '#17120f');
  ellipse(ctx, 700, y - 12, 8, 11, '#17120f');
}

function shopSet(ctx: Ctx2D): void {
  const g = ctx.createLinearGradient(0, 0, DESIGN_W, DESIGN_H);
  g.addColorStop(0, '#176c70');
  g.addColorStop(0.55, '#7a2a78');
  g.addColorStop(1, '#3b1547');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  ctx.fillStyle = '#b08a2e';
  ctx.fillRect(0, 500, DESIGN_W, 220);
}

function shelf(ctx: Ctx2D): void {
  ctx.fillStyle = '#c9b99a';
  ctx.fillRect(250, 280, 620, 90);
  ctx.fillStyle = '#7d6a4b';
  ctx.fillRect(250, 368, 620, 12);
}

function nightLight(ctx: Ctx2D, t: number): void {
  const cx = 560;
  const pulse = 0.5 + Math.sin(t * 0.002) * 0.14;
  const glow = ctx.createRadialGradient(cx, 210, 6, cx, 210, 120);
  glow.addColorStop(0, `rgba(255, 238, 180, ${pulse})`);
  glow.addColorStop(1, 'rgba(255, 238, 180, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 120, 90, 240, 240);
  ellipse(ctx, cx, 205, 40, 52, '#f7e9b8');
  polygon(ctx, '#594a33', [[cx - 26, 250], [cx + 26, 250], [cx + 40, 282], [cx - 40, 282]]);
}

function candy(ctx: Ctx2D, t: number): void {
  const cx = 125;
  polygon(ctx, '#e0559b', [[cx - 110, 500], [cx - 84, 300], [cx - 26, 268], [cx + 26, 268], [cx + 84, 300], [cx + 110, 500]]);
  ctx.fillStyle = '#d9b8a0';
  ctx.fillRect(cx - 18, 236, 36, 40);
  ellipse(ctx, cx, 180, 60, 74, '#e3c3ab');
  polygon(ctx, '#e9c14f', [[cx - 74, 250], [cx - 74, 150], [cx - 40, 96], [cx + 40, 96], [cx + 74, 150], [cx + 74, 250], [cx + 50, 160], [cx - 50, 160]]);
  const shut = blinking(t, 3300);
  for (const side of [-1, 1]) {
    if (shut) {
      ctx.fillStyle = '#a07f6a';
      ctx.fillRect(cx + side * 24 - 12, 170, 24, 4);
    } else {
      ellipse(ctx, cx + side * 24, 172, 12, 7, '#f6f2e8');
      ellipse(ctx, cx + side * 24, 172, 5, 5, '#2a1c17');
    }
  }
  // A smile that never stops, even while she talks.
  ellipse(ctx, cx, 216, 26, 7 + talk(t) * 7, '#8f1e3e');
  ctx.fillStyle = '#f6f2e8';
  ctx.fillRect(cx - 20, 210, 40, 5);
}

const ART: Readonly<Record<string, Paint>> = {
  'img/ch02/newsroom.png': newsroom,
  'img/ch02/anchor-neutral.png': (ctx, t) => person(ctx, t, false),
  'img/ch02/anchor-staring.png': (ctx, t) => person(ctx, t, true),
  'img/ch02/weather-map.png': weatherMap,
  'img/ch04/set.png': pumpkinSet,
  'img/ch04/gourd.png': gourd,
  'img/ch04/gourd-turned.png': gourdTurned,
  'img/ch04/dot.png': dot,
  'img/ch07/set.png': shopSet,
  'img/ch07/shelf.png': shelf,
  'img/ch07/night-light.png': nightLight,
  'img/ch07/candy.png': candy,
};

/** Paint the layer `src`. False if it has no art, so the caller can mark the gap. */
export function drawSceneArt(ctx: Ctx2D, src: string, tMs: number, x: number, y: number, w: number, h: number): boolean {
  const paint = ART[src];
  if (!paint) return false;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / DESIGN_W, h / DESIGN_H);
  paint(ctx, tMs);
  ctx.restore();
  return true;
}

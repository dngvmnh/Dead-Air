import { useEffect, useRef } from 'react';
import styles from './RoomCanvas.module.css';
import {
  createSheet,
  grab,
  moveGrab,
  release,
  stepSheet,
  nodeIndex,
  countBroken,
  WALL_COLS,
  WALL_ROWS,
  type TearSheet,
} from '../../core/tearSheet.ts';
import { TearGLRenderer } from '../../render/tearRenderer.ts';
import { bakeWallpaper, bakeBehindPlaster } from '../../render/roomWallpaper.ts';
import type { AudioEngine } from '../../audio/AudioEngine.ts';

/**
 * The tearable wall behind the set (design §1, §3). A full-viewport canvas at
 * z-index 0, BEHIND the opaque chassis, so it can never overlap the tube or a
 * YouTube surface (the clean-feed rule holds by construction). `aria-hidden`,
 * `touch-action: none` on the canvas only so page scroll elsewhere still works.
 *
 * The viewer drags to tear the paper (mouse + up to two touch points). Near an
 * existing torn edge or the idle corner the pointer lifts the flap and shows a
 * grab cursor; no text explains it. `T` rips a seeded path for keyboard users.
 * WebGL2 absent → a static pre-torn 2D room (requirement 8.5).
 */
export interface RoomCanvasProps {
  /** Ignore tear input while the first-run notice is up (requirement 1.8). */
  interactive: boolean;
  /** Audio engine for the procedural rip (shared with the TV). */
  getAudio: () => AudioEngine;
}

interface RoomSeam {
  strokes: () => number;
  broken: () => number;
  ripSeeded: () => void;
}

const IDLE_CORNER_RADIUS = 0.12; // fraction of the sheet near the top-right corner

export function RoomCanvas({ interactive, getAudio }: RoomCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interactiveRef = useRef(interactive);
  // Sync the latest `interactive` into the ref from an effect (not during
  // render); the pointer/key handlers read it live.
  useEffect(() => {
    interactiveRef.current = interactive;
  }, [interactive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preserve =
      (window as unknown as { __CRT_PRESERVE_DRAWING_BUFFER__?: boolean }).__CRT_PRESERVE_DRAWING_BUFFER__ === true;
    const forceFallback = (window as unknown as { __CRT_FORCE_FALLBACK__?: boolean }).__CRT_FORCE_FALLBACK__ === true;

    const seed = 0x5eed;
    const sheet: TearSheet = createSheet(WALL_COLS, WALL_ROWS, seed);

    // Baking and renderer creation need a real canvas context. Under jsdom
    // (unit tests) getContext returns null and the bake throws; in that case
    // the room simply does not render and the rest of the app is unaffected.
    let front: { canvas: HTMLCanvasElement };
    let behind: { canvas: HTMLCanvasElement };
    try {
      front = bakeWallpaper();
      behind = bakeBehindPlaster();
    } catch {
      return; // no 2D context (e.g. jsdom): render nothing, never crash.
    }

    const gl = forceFallback ? null : TearGLRenderer.create(canvas, { preserveDrawingBuffer: preserve });
    const fallbackCtx = gl ? null : canvas.getContext('2d');
    if (!gl && !fallbackCtx) return; // no renderer available at all.
    let strokeCount = 0;

    // Active-frame counter: the loop steps/renders only while > 0 or a drag is
    // live; otherwise it idles cheaply. `wake` re-arms it after any interaction.
    let activeFrames = 60; // paint the first second on load
    const wake = (): void => {
      activeFrames = 90;
    };

    if (gl) {
      gl.setSheet(sheet);
      gl.setFrontTexture(front.canvas);
      gl.setBehindTexture(behind.canvas);
    }

    const cap = { w: 1280, h: 800 };
    const resize = (): void => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      if (gl) gl.resize(w, h, cap);
      else {
        const cw = Math.min(w, cap.w);
        const chh = Math.min(h, cap.h);
        if (canvas.width !== cw) canvas.width = cw;
        if (canvas.height !== chh) canvas.height = chh;
      }
    };
    resize();
    window.addEventListener('resize', resize);
    // On context restore the renderer rebuilds from stored strokes; wake the
    // loop so the rebuilt wall is drawn again (requirement 8.6).
    const onRestored = (): void => {
      resize();
      wake();
    };
    canvas.addEventListener('webglcontextrestored', onRestored);

    // --- Pointer → grid mapping ------------------------------------------
    const toGrid = (clientX: number, clientY: number): { gx: number; gy: number } => {
      const rect = canvas.getBoundingClientRect();
      const nx = (clientX - rect.left) / Math.max(1, rect.width);
      const ny = (clientY - rect.top) / Math.max(1, rect.height);
      return { gx: nx * (WALL_COLS - 1), gy: ny * (WALL_ROWS - 1) };
    };
    const nearestFreeNode = (gx: number, gy: number): number => {
      const c = Math.max(0, Math.min(WALL_COLS - 1, Math.round(gx)));
      const r = Math.max(0, Math.min(WALL_ROWS - 1, Math.round(gy)));
      return nodeIndex(sheet, c, r);
    };

    // Active drags keyed by pointerId (mouse or touch), up to two. Each drag
    // holds the NODE index it grabbed (the tearSheet grab id is the node index).
    const drags = new Map<number, { node: number; lastX: number; lastY: number; lastT: number; points: Array<[number, number]> }>();

    const onDown = (e: PointerEvent): void => {
      if (!interactiveRef.current) return;
      if (drags.size >= 2) return; // two independent touch points max
      const { gx, gy } = toGrid(e.clientX, e.clientY);
      const node = nearestFreeNode(gx, gy);
      // An edge (pinned) node cannot be dragged; ignore so the gesture is a no-op.
      if (sheet.pinned[node] === 1) return;
      grab(sheet, node, gx, gy);
      drags.set(e.pointerId, { node, lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp, points: [[gx / (WALL_COLS - 1), gy / (WALL_ROWS - 1)]] });
      strokeCount += 1;
      canvas.setPointerCapture?.(e.pointerId);
      // A pointer gesture may unlock audio if POWER hasn't (design §9).
      try {
        void getAudio().unlock();
      } catch {
        /* audio optional */
      }
      e.preventDefault();
    };

    const onMove = (e: PointerEvent): void => {
      const d = drags.get(e.pointerId);
      if (!d) {
        // Hover feedback: grab cursor near an edge or the idle corner.
        updateCursor(e.clientX, e.clientY);
        return;
      }
      const { gx, gy } = toGrid(e.clientX, e.clientY);
      moveGrab(sheet, d.node, gx, gy);
      // Rip sound scaled by drag speed.
      const dt = Math.max(1, e.timeStamp - d.lastT);
      const dist = Math.hypot(e.clientX - d.lastX, e.clientY - d.lastY);
      const speed = Math.min(1, dist / dt / 2); // px/ms normalised
      if (dist > 6) {
        try {
          getAudio().playRip(speed);
        } catch {
          /* audio optional */
        }
        d.points.push([gx / (WALL_COLS - 1), gy / (WALL_ROWS - 1)]);
      }
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.lastT = e.timeStamp;
      e.preventDefault();
    };

    const endDrag = (e: PointerEvent): void => {
      const d = drags.get(e.pointerId);
      if (!d) return;
      release(sheet, d.node);
      drags.delete(e.pointerId);
      canvas.releasePointerCapture?.(e.pointerId);
    };

    const updateCursor = (clientX: number, clientY: number): void => {
      if (!interactiveRef.current) {
        canvas.style.cursor = 'default';
        return;
      }
      const { gx, gy } = toGrid(clientX, clientY);
      const nearBroken = isNearTornEdge(sheet, gx, gy);
      const nearCorner = gx / (WALL_COLS - 1) > 1 - IDLE_CORNER_RADIUS && gy / (WALL_ROWS - 1) < IDLE_CORNER_RADIUS;
      canvas.style.cursor = nearBroken || nearCorner ? 'grab' : 'default';
      // Lift the idle corner slightly so there is a visible flap to grab.
      if (nearCorner) {
        const n = nodeIndex(sheet, WALL_COLS - 2, 1);
        if (sheet.pinned[n] === 0) sheet.zs[n] = 0.5;
      }
    };

    // Keyboard: `T` rips a seeded diagonal path (requirement 8.2).
    const onKey = (e: KeyboardEvent): void => {
      if (!interactiveRef.current) return;
      if (e.key !== 't' && e.key !== 'T') return;
      // Don't hijack typing in an input/iframe.
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'IFRAME')) return;
      ripSeededPath(sheet);
      strokeCount += 1;
    };

    const onDownW = (e: PointerEvent): void => {
      onDown(e);
      wake();
    };
    const onMoveW = (e: PointerEvent): void => {
      onMove(e);
      if (drags.size > 0) wake();
    };
    const onLeave = (e: PointerEvent): void => {
      if (!drags.has(e.pointerId)) canvas.style.cursor = 'default';
    };
    const onKeyW = (e: KeyboardEvent): void => {
      const before = countBroken(sheet);
      onKey(e);
      if (countBroken(sheet) !== before) wake();
    };
    canvas.addEventListener('pointerdown', onDownW);
    canvas.addEventListener('pointermove', onMoveW);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKeyW);

    // --- Loop -------------------------------------------------------------
    let raf = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = now - last;
      last = now;
      const busy = drags.size > 0 || activeFrames > 0;
      if (busy) {
        if (activeFrames > 0) activeFrames -= 1;
        stepSheet(sheet, dt);
        if (gl) gl.render(now);
        else if (fallbackCtx) drawFallback(fallbackCtx, canvas, front.canvas, behind.canvas);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Test seam.
    if (preserve) {
      (window as unknown as { __room?: RoomSeam }).__room = {
        strokes: () => strokeCount,
        broken: () => countBroken(sheet),
        ripSeeded: () => {
          ripSeededPath(sheet);
          strokeCount += 1;
        },
      };
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyW);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      canvas.removeEventListener('pointerdown', onDownW);
      canvas.removeEventListener('pointermove', onMoveW);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('pointerleave', onLeave);
      gl?.dispose();
      delete (window as unknown as { __room?: RoomSeam }).__room;
    };
    // Build once; interactive is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className={styles.roomCanvas} aria-hidden="true" data-testid="room-canvas" />;
}

/** True when (gx,gy) is within a cell of a broken constraint (a torn edge). */
function isNearTornEdge(sheet: TearSheet, gx: number, gy: number): boolean {
  const c = Math.round(gx);
  const r = Math.round(gy);
  const here = nodeIndex(sheet, Math.max(0, Math.min(sheet.cols - 1, c)), Math.max(0, Math.min(sheet.rows - 1, r)));
  const count = sheet.restLength.length;
  for (let k = 0; k < count; k += 1) {
    if (sheet.broken[k] !== 1) continue;
    if (sheet.constraints[k * 2] === here || sheet.constraints[k * 2 + 1] === here) return true;
  }
  return false;
}

/** Yank a seeded diagonal run of interior nodes to force a tear (T key). */
function ripSeededPath(sheet: TearSheet): void {
  const steps = Math.min(sheet.cols, sheet.rows) - 2;
  for (let i = 1; i <= steps; i += 1) {
    const c = Math.min(sheet.cols - 2, i);
    const r = Math.min(sheet.rows - 2, i);
    const n = nodeIndex(sheet, c, r);
    if (sheet.pinned[n] === 1) continue;
    // The grab id is the node index (design §2); pull it far to tear.
    grab(sheet, n, sheet.xs[n]! + sheet.cols * 2, sheet.ys[n]! + sheet.rows * 2);
    stepSheet(sheet, 16.67);
    stepSheet(sheet, 16.67);
    release(sheet, n);
  }
  // A few settle steps so the tear opens.
  for (let s = 0; s < 20; s += 1) stepSheet(sheet, 16.67);
}

/** 2D fallback: a static pre-torn room with the behind layer showing (req 8.5). */
function drawFallback(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  front: HTMLCanvasElement,
  behind: HTMLCanvasElement,
): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.drawImage(behind, 0, 0, w, h);
  // Paper with a fixed diagonal gash removed, so the behind shows through.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h);
  ctx.lineTo(w * 0.62, h);
  ctx.lineTo(w * 0.42, h * 0.5);
  ctx.lineTo(w * 0.58, h * 0.2);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(front, 0, 0, w, h);
  ctx.restore();
}

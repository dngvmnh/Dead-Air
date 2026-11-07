import { useEffect, useRef } from 'react';
import styles from './RoomCanvas.module.css';
import {
  createSheet,
  grab,
  moveGrab,
  release,
  cutPath,
  stepSheet,
  nodeIndex,
  countBroken,
  WALL_COLS,
  WALL_ROWS,
  type TearSheet,
} from '../../core/tearSheet.ts';
import { TearGLRenderer } from '../../render/tearRenderer.ts';
import { bakeRoom } from '../../render/roomWallpaper.ts';
import { bakeBehindLayer, bakeGlimpse } from '../../render/behindRenderer.ts';
import type { AudioEngine } from '../../audio/AudioEngine.ts';
import type { RoomState } from '../../core/roomState.ts';
import type { BehindView } from '../../core/behindState.ts';
import type { RoomEffects } from '../../app/useTelevision.ts';

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
  /** Derive the lit room state (ambient by act + picture glow), design §5. */
  getRoomState: (reduced: boolean, localHour: number, localMinute: number) => RoomState;
  /** What a tear reveals for this viewer now (design §4). */
  getBehindView: (localHour: number, localMinute: number) => BehindView;
  /** Hands the room's lights and glimpse to the startles, and takes them back. */
  registerRoom?: (handle: RoomEffects | null) => void;
  /** The viewer just finished a tear. */
  onTearEnd?: () => void;
  /** Reduced Effects / reduced motion: calmer light, no auto motion (req 8.4). */
  reduced: boolean;
}

interface RoomSeam {
  strokes: () => number;
  broken: () => number;
  ripSeeded: () => void;
  /** Paint everything behind the paper solid magenta, so a test can measure holes. */
  showHoleMask: (on: boolean) => void;
  /** The act and words currently behind the wall. */
  behind: () => { act: number; tally: number; lines: string[] };
  /** The room's scripted light level and how visible the glimpse is, 0..1. */
  level: () => number;
  glimpseAmount: () => number;
}

const IDLE_CORNER_RADIUS = 0.12; // fraction of the sheet near the top-right corner

export function RoomCanvas({
  interactive,
  getAudio,
  getRoomState,
  getBehindView,
  registerRoom,
  onTearEnd,
  reduced,
}: RoomCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interactiveRef = useRef(interactive);
  const getRoomStateRef = useRef(getRoomState);
  const getBehindViewRef = useRef(getBehindView);
  const registerRoomRef = useRef(registerRoom);
  const onTearEndRef = useRef(onTearEnd);
  const reducedRef = useRef(reduced);
  // Sync the latest props into refs from an effect (not during render); the
  // loop and handlers read them live.
  useEffect(() => {
    interactiveRef.current = interactive;
    getRoomStateRef.current = getRoomState;
    getBehindViewRef.current = getBehindView;
    registerRoomRef.current = registerRoom;
    onTearEndRef.current = onTearEnd;
    reducedRef.current = reduced;
  }, [interactive, getRoomState, getBehindView, registerRoom, onTearEnd, reduced]);

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
    const now0 = new Date();
    let front: { canvas: HTMLCanvasElement };
    let behindCanvas: TexImageSource;
    let behindView: BehindView;
    let behindLayer: ReturnType<typeof bakeBehindLayer>;
    try {
      // Bake the full room (wallpaper + objects + wall clock at the real local
      // time) and the plaster behind. objectVariant comes from the derived room
      // state (task 8 moves it during unobserved moments).
      const variant = getRoomStateRef.current(reducedRef.current, now0.getHours(), now0.getMinutes()).objectVariant;
      front = bakeRoom(now0.getHours(), now0.getMinutes(), variant);
      behindView = getBehindViewRef.current(now0.getHours(), now0.getMinutes());
      behindLayer = bakeBehindLayer(behindView, reducedRef.current);
      behindCanvas = behindLayer.albedo;
    } catch {
      return; // no 2D context (e.g. jsdom): render nothing, never crash.
    }

    // The room is decoration, so a driver that rejects its shaders must never take
    // the television down with it.
    let gl: TearGLRenderer | null = null;
    if (!forceFallback) {
      try {
        gl = TearGLRenderer.create(canvas, { preserveDrawingBuffer: preserve });
      } catch (err) {
        console.warn('room renderer unavailable', err);
      }
    }
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
      gl.setBehindLayer(behindLayer);
    }

    // Memory loads after this effect and keeps changing, so what is behind the wall
    // is re-derived on the idle tick and baked only when it would look different.
    const syncBehind = (): boolean => {
      const d = new Date();
      const view = getBehindViewRef.current(d.getHours(), d.getMinutes());
      if (view.key === behindView.key) return false;
      behindView = view;
      try {
        const layer = bakeBehindLayer(view, reducedRef.current);
        behindCanvas = layer.albedo;
        gl?.setBehindLayer(layer);
      } catch {
        return false;
      }
      return true;
    };

    // Act 3: a shape in the dark, turning towards the pointer with a long delay.
    // It starts behind the viewer's own tear and drifts, so it never jumps.
    const strokeMid = { x: 0.08, y: 0.5 };
    const pointer = { x: 0.5, y: 0.5 };
    const shape = { x: 0.08, y: 0.5 };
    const SHAPE_LAG_MS = 2600;
    // The dark drifts over tens of seconds, so 5 Hz looks the same as 60 and costs
    // a twelfth of the fill on a wall that may be torn for the rest of the session.
    const SHAPE_REDRAW_MS = 200;
    let lastShapeDraw = 0;
    const updateShape = (dt: number): void => {
      const on = behindView.act === 3 && strokeCount > 0;
      if (!on) {
        gl?.setShape(shape.x, shape.y, 0);
        return;
      }
      if (!reducedRef.current) {
        const k = Math.min(1, dt / SHAPE_LAG_MS);
        shape.x += (strokeMid.x + (pointer.x - strokeMid.x) * 0.1 - shape.x) * k;
        shape.y += (strokeMid.y + (pointer.y - strokeMid.y) * 0.1 - shape.y) * k;
      }
      gl?.setShape(shape.x, shape.y, 1);
    };

    // The lights sinking and the glimpse (requirement 11). Both ease, so neither
    // can read as a flash, and they stop costing anything once settled.
    let levelNow = 1;
    let levelFrom = 1;
    let levelTo = 1;
    let levelStart = 0;
    let levelMs = 1;
    let levelMoving = false;
    let glimpseNow = 0;
    let glimpseUntil = 0;
    const GLIMPSE_FADE_MS = 160;
    const effects: RoomEffects = {
      setLevel: (level, ms) => {
        levelFrom = levelNow;
        levelTo = level;
        levelStart = performance.now();
        levelMs = Math.max(1, ms);
        levelMoving = true;
      },
      glimpse: (ms) => {
        if (ms <= 0) {
          glimpseUntil = 0;
          return;
        }
        // Eyes where the viewer last tore. With no tear there is nowhere to see them.
        if (strokeCount === 0) return;
        gl?.setGlimpse(bakeGlimpse(strokeMid.x, strokeMid.y));
        glimpseUntil = performance.now() + ms;
      },
    };
    registerRoomRef.current?.(effects);
    const stepEffects = (now: number, dt: number): boolean => {
      let changed = false;
      if (levelMoving) {
        const t = Math.min(1, (now - levelStart) / levelMs);
        levelNow = levelFrom + (levelTo - levelFrom) * t * t * (3 - 2 * t);
        gl?.setLevel(levelNow);
        if (t >= 1) levelMoving = false;
        changed = true;
      }
      const target = now < glimpseUntil ? 1 : 0;
      if (glimpseNow !== target) {
        const delta = dt / GLIMPSE_FADE_MS;
        glimpseNow = target > glimpseNow ? Math.min(1, glimpseNow + delta) : Math.max(0, glimpseNow - delta);
        gl?.setGlimpseAmount(glimpseNow);
        changed = true;
      }
      return changed;
    };

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
    const drags = new Map<
      number,
      { node: number; lastX: number; lastY: number; lastT: number; lastGx: number; lastGy: number; points: Array<[number, number]> }
    >();

    const onDown = (e: PointerEvent): void => {
      if (!interactiveRef.current) return;
      if (drags.size >= 2) return; // two independent touch points max
      const { gx, gy } = toGrid(e.clientX, e.clientY);
      const node = nearestFreeNode(gx, gy);
      // An edge (pinned) node cannot be dragged; ignore so the gesture is a no-op.
      if (sheet.pinned[node] === 1) return;
      grab(sheet, node, gx, gy);
      drags.set(e.pointerId, {
        node,
        lastX: e.clientX,
        lastY: e.clientY,
        lastT: e.timeStamp,
        lastGx: gx,
        lastGy: gy,
        points: [[gx / (WALL_COLS - 1), gy / (WALL_ROWS - 1)]],
      });
      strokeCount += 1;
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {
        // The pointer ended before the browser could capture it.
      }
      // A pointer gesture may unlock audio if POWER hasn't (design §9).
      try {
        void getAudio().unlock();
      } catch {
        /* audio optional */
      }
      e.preventDefault();
    };

    const onMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = (e.clientX - rect.left) / Math.max(1, rect.width);
      pointer.y = (e.clientY - rect.top) / Math.max(1, rect.height);
      const d = drags.get(e.pointerId);
      if (!d) {
        // Hover feedback: grab cursor near an edge or the idle corner.
        updateCursor(e.clientX, e.clientY);
        return;
      }
      const { gx, gy } = toGrid(e.clientX, e.clientY);
      // Hold the paper at the pointer's tip, not at the node the drag began on:
      // hauling one node across the wall stretched the triangles around it into
      // long spikes over the hole.
      const tip = nearestFreeNode(gx, gy);
      if (tip !== d.node && sheet.pinned[tip] === 0) {
        release(sheet, d.node);
        grab(sheet, tip, gx, gy);
        d.node = tip;
      } else {
        moveGrab(sheet, d.node, gx, gy);
      }
      // Cut the paper along the SWEPT segment since the last move, within one
      // cell of the path. This makes the gash follow the pointer at any drag
      // speed (task 5a.3) — a fast flick that jumps several cells still opens a
      // continuous slit, which pulling one grabbed node alone cannot do.
      cutPath(sheet, d.lastGx, d.lastGy, gx, gy);
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
      d.lastGx = gx;
      d.lastGy = gy;
      e.preventDefault();
    };

    const endDrag = (e: PointerEvent): void => {
      const d = drags.get(e.pointerId);
      if (!d) return;
      release(sheet, d.node);
      if (d.points.length > 1) {
        strokeMid.x = d.points.reduce((sum, p) => sum + p[0], 0) / d.points.length;
        strokeMid.y = d.points.reduce((sum, p) => sum + p[1], 0) / d.points.length;
      }
      drags.delete(e.pointerId);
      onTearEndRef.current?.();
      try {
        canvas.releasePointerCapture?.(e.pointerId);
      } catch {
        // Already released with the pointer.
      }
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
    // Two cadences: while interacting, full-rate sim + render; otherwise a
    // throttled (~10 Hz) light-only re-render so the wall tracks the TV picture
    // colour (design §5) without a 60 fps sim replay — which also keeps the TV's
    // mocked-clock tests fast. The picture itself is sampled at ≤ 8 Hz inside
    // getRoomState.
    let raf = 0;
    let last = performance.now();
    let lastLightAt = 0;
    let lastBehindAt = 0;
    // The idle light refresh is throttled hard: the wall glow only needs to
    // track the picture a few times a second, and a lower cadence keeps the
    // always-on room cheap (task 10 budget) and the TV's long mocked-clock
    // tests fast, since page.clock replays every scheduled callback.
    const LIGHT_INTERVAL_MS = 200;
    let lastLightKey = '';
    // Apply the derived light; returns true if it changed meaningfully.
    // The TV light pool is centred on the actual tube opening, not the middle
    // of the wall (task 5a.2): read its box and convert to a 0..1 fraction.
    const updateLightCenter = (): void => {
      if (!gl) return;
      const tube = document.querySelector('[data-testid="tube-opening"]');
      if (!tube) {
        gl.setLightCenter(0.5, 0.45);
        return;
      }
      const r = tube.getBoundingClientRect();
      const cx = (r.left + r.width / 2) / Math.max(1, window.innerWidth);
      const cy = (r.top + r.height / 2) / Math.max(1, window.innerHeight);
      gl.setLightCenter(cx, cy);
    };
    const applyLight = (): boolean => {
      const d = new Date();
      const rs = getRoomStateRef.current(reducedRef.current, d.getHours(), d.getMinutes());
      gl?.setLight(rs.ambient, rs.tvLight);
      updateLightCenter();
      const l = rs.tvLight;
      const key = `${rs.ambient.toFixed(2)}|${Math.round(l.r / 16)}|${Math.round(l.g / 16)}|${Math.round(l.b / 16)}|${l.amount.toFixed(2)}`;
      if (key === lastLightKey) return false;
      lastLightKey = key;
      return true;
    };
    const draw = (now: number): void => {
      if (gl) gl.render(now);
      else if (fallbackCtx) drawFallback(fallbackCtx, canvas, front.canvas, behindCanvas);
    };
    const loop = (now: number): void => {
      const dt = now - last;
      last = now;
      const busy = drags.size > 0 || activeFrames > 0;
      updateShape(dt);
      const effectsMoved = stepEffects(now, dt);
      // Checked whether or not the wall is busy: memory loads during the first
      // painted second, and a tear made then must still show the right act.
      let changedBehind = false;
      if (now - lastBehindAt >= LIGHT_INTERVAL_MS) {
        lastBehindAt = now;
        changedBehind = syncBehind();
      }
      if (busy) {
        if (activeFrames > 0) activeFrames -= 1;
        stepSheet(sheet, dt);
        applyLight();
        draw(now);
      } else {
        let redraw = false;
        if (now - lastLightAt >= LIGHT_INTERVAL_MS) {
          // Idle: only redraw when something actually changed (no sim step), so a
          // static picture costs a sample and nothing more.
          lastLightAt = now;
          redraw = applyLight();
        }
        if (changedBehind || effectsMoved) redraw = true;
        // Movement in the dark only exists once there is a tear to see it through.
        const moving = behindView.act === 3 && strokeCount > 0 && !reducedRef.current;
        if (moving && now - lastShapeDraw >= SHAPE_REDRAW_MS) redraw = true;
        if (redraw) {
          lastShapeDraw = now;
          draw(now);
        }
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
        showHoleMask: (on) => {
          gl?.setHoleMask(on);
          gl?.render(performance.now());
        },
        behind: () => ({ act: behindView.act, tally: behindView.tally, lines: behindView.lines }),
        level: () => levelNow,
        glimpseAmount: () => glimpseNow,
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
      registerRoomRef.current?.(null);
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

/**
 * Rip a seeded path across the middle of the wall (the `T` key). Keyboard users
 * get the same discovery as a drag (requirement 8.2). The path sweeps a broad
 * arc through the interior — away from the pinned edges — so it opens a clear,
 * visible gash rather than a nick in the corner.
 */
function ripSeededPath(sheet: TearSheet): void {
  // Tear down the LEFT margin of the wall (columns ~8-18% in), which is the
  // part NOT covered by the centred chassis, so a keyboard user sees the gash
  // (requirement 8.2). A gentle arc keeps it from being a straight slit.
  const c0 = sheet.cols * 0.1;
  const c1 = sheet.cols * 0.22;
  const r0 = sheet.rows * 0.2;
  const r1 = sheet.rows * 0.8;
  // Cut a gentle arc down the exposed left band, segment by segment, so the
  // same path-following tear a drag makes (task 5a.3) appears for the keyboard.
  let prevX = c0 + (c1 - c0) * Math.sin(0);
  let prevY = r0;
  const STEPS = 16;
  for (let s = 1; s <= STEPS; s += 1) {
    const t = s / STEPS;
    const x = c0 + (c1 - c0) * Math.sin(t * Math.PI);
    const y = r0 + (r1 - r0) * t;
    cutPath(sheet, prevX, prevY, x, y);
    prevX = x;
    prevY = y;
  }
  // Settle so the flaps peel open.
  for (let s = 0; s < 24; s += 1) stepSheet(sheet, 16.67);
}

/** 2D fallback: a static pre-torn room with the behind layer showing (req 8.5). */
function drawFallback(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  front: HTMLCanvasElement,
  behind: TexImageSource,
): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.drawImage(behind as CanvasImageSource, 0, 0, w, h);
  // The room is dark, so what is behind the paper must be too.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, 0, w, h);
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

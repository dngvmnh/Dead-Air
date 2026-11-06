import { useEffect, useRef } from 'react';
import styles from './Screen.module.css';
import { type TvPhase } from '../../core/tvMachine.ts';
import { CrtRenderer } from '../../render/CrtRenderer.ts';
import { FallbackRenderer } from '../../render/FallbackRenderer.ts';
import { type Renderer } from '../../render/Renderer.ts';
import { DEFAULT_LOOK } from '../../render/looks.ts';
import { BOOT_MS, SHUTDOWN_MS } from '../../app/timing.ts';

/**
 * Tests enable `preserveDrawingBuffer` through this window flag so canvas
 * pixel readback is reliable across frames. Production leaves it unset, so the
 * renderer draws without preserving the buffer (see CrtRendererOptions).
 */
declare global {
  interface Window {
    __CRT_PRESERVE_DRAWING_BUFFER__?: boolean;
    /** Test-only: force the non-WebGL fallback path (requirement 5.3). */
    __CRT_FORCE_FALLBACK__?: boolean;
  }
}

/**
 * The tube opening. The WebGL2 CRT renderer draws here for owned sources; a
 * status word stays behind the canvas so the chassis reads clearly until real
 * sources arrive (Milestone 2). All screen effects live inside the shader —
 * never as CSS on this element or its ancestors (design.md §3).
 */
export interface ScreenProps {
  phase: TvPhase;
  channelLabel: string;
  /** Reduced Effects / prefers-reduced-motion: disable flashes, roll, jitter. */
  reducedEffects: boolean;
  /**
   * Hands the created renderer to the orchestrator so owned sources (scenes,
   * files) can publish their picture via `renderer.setSource`. Called with the
   * renderer on mount and `null` on unmount. The orchestrator owns playback;
   * Screen still owns the renderer's lifecycle and phase-driven envelopes.
   */
  onRendererReady?: (renderer: Renderer | null) => void;
}

function statusWord(phase: TvPhase): string {
  switch (phase) {
    case 'OFF':
      return '';
    case 'BOOTING':
      return 'Warming up';
    case 'TUNING':
      return 'Tuning';
    case 'STAND_BY':
      return 'Please stand by';
    case 'SIGN_OFF':
      return 'No signal';
    case 'ON_AIR':
    case 'EVENT':
      return 'On air';
  }
}

/**
 * Resting drive for phases that are neither booting, shutting down nor tuning.
 * Boot/shutdown animate uPower/uCollapse via the renderer's envelopes; tuning
 * pins static to 1 via setTuning. For the remaining steady phases we set the
 * baseline brightness and snow here.
 */
function steadyDrive(phase: TvPhase): { power: number; static: number } {
  switch (phase) {
    case 'STAND_BY':
    case 'SIGN_OFF':
      return { power: 1, static: 0.4 };
    case 'ON_AIR':
    case 'EVENT':
      return { power: 1, static: 0.08 };
    // OFF, BOOTING and TUNING are driven by envelopes/tuning, not this value.
    case 'OFF':
    case 'BOOTING':
    case 'TUNING':
      return { power: 0, static: 0 };
  }
}

export function Screen({ phase, channelLabel, reducedEffects, onRendererReady }: ScreenProps) {
  const off = phase === 'OFF';
  const word = statusWord(phase);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const prevPhase = useRef<TvPhase | null>(null);

  // Keep the latest callback without making it a dependency of the mount effect
  // (the renderer is built exactly once).
  const onRendererReadyRef = useRef(onRendererReady);
  useEffect(() => {
    onRendererReadyRef.current = onRendererReady;
  }, [onRendererReady]);

  // Create the renderer once the canvas is mounted. Prefer the WebGL2 CRT
  // pipeline; if WebGL2 is unavailable (requirement 5.3), fall back to the 2D
  // renderer with a CSS treatment so the TV stays operable. In jsdom both
  // getContext calls return null, so the TV simply shows the status word.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const crt =
      window.__CRT_FORCE_FALLBACK__ === true
        ? null
        : CrtRenderer.create(canvas, {
            preserveDrawingBuffer: window.__CRT_PRESERVE_DRAWING_BUFFER__ === true,
          });
    const renderer: Renderer | null = crt ?? FallbackRenderer.create(canvas);
    if (!renderer) return;
    rendererRef.current = renderer;
    renderer.setLook(DEFAULT_LOOK);
    renderer.setReducedEffects(reducedEffects);
    renderer.start();
    if (window.__CRT_PRESERVE_DRAWING_BUFFER__ === true) {
      (window as unknown as { __crt?: Renderer }).__crt = renderer;
    }
    onRendererReadyRef.current?.(renderer);
    return () => {
      onRendererReadyRef.current?.(null);
      renderer.dispose();
      rendererRef.current = null;
    };
    // Reduced effects is applied here on mount and kept in sync by the effect
    // below; it is intentionally not a dependency so the renderer is built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the renderer's reduced-effects state in sync with the setting.
  useEffect(() => {
    rendererRef.current?.setReducedEffects(reducedEffects);
  }, [reducedEffects]);

  // Drive the renderer from phase transitions. Boot and shutdown are animated
  // envelopes inside the shader (uPower/uCollapse); tuning holds full static;
  // the remaining phases get a steady brightness and snow. Nothing here touches
  // DOM styling on the tube — all screen effects live in the shader.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const from = prevPhase.current;
    prevPhase.current = phase;

    // Tuning holds snow; any other phase releases the hold.
    renderer.setTuning(phase === 'TUNING');

    if (phase === 'BOOTING') {
      // Warm up from a dark collapsed line to a full picture, no snow.
      renderer.setStatic(0);
      renderer.startBoot(BOOT_MS);
      return;
    }
    if (phase === 'OFF') {
      if (from !== null && from !== 'OFF') {
        // Collapsing to a line and dot, then dark (requirement 1.4).
        renderer.startShutdown(SHUTDOWN_MS);
      } else {
        // Already off (first mount): stay dark, no transition to play.
        renderer.setPower(0);
        renderer.setStatic(0);
      }
      return;
    }
    if (phase === 'TUNING') {
      // Static is pinned by setTuning; keep the tube lit under the snow.
      renderer.setPower(1);
      return;
    }
    const drive = steadyDrive(phase);
    renderer.setPower(drive.power);
    renderer.setStatic(drive.static);
  }, [phase]);

  return (
    <div
      className={`${styles.tube} ${off ? styles.off : ''}`}
      data-phase={phase}
      data-testid="tube-opening"
    >
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      {!off && word ? (
        <div className={styles.placeholder}>
          {word}
          {phase === 'ON_AIR' || phase === 'EVENT' ? ` · CH ${channelLabel}` : ''}
        </div>
      ) : null}
    </div>
  );
}

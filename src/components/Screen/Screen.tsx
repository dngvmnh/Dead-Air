import { useEffect, useRef } from 'react';
import styles from './Screen.module.css';
import { type TvPhase } from '../../core/tvMachine.ts';
import { CrtRenderer } from '../../render/CrtRenderer.ts';
import { DEFAULT_LOOK } from '../../render/looks.ts';

/**
 * The tube opening. The WebGL2 CRT renderer draws here for owned sources; a
 * status word stays behind the canvas so the chassis reads clearly until real
 * sources arrive (Milestone 2). All screen effects live inside the shader —
 * never as CSS on this element or its ancestors (design.md §3).
 */
export interface ScreenProps {
  phase: TvPhase;
  channelLabel: string;
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
 * How bright the picture is and how much snow covers it, per phase. Task 4.2
 * replaces these step changes with animated boot/shutdown/tuning envelopes;
 * for now each phase maps to a steady value so the pipeline is demonstrable.
 */
function phaseDrive(phase: TvPhase): { power: number; static: number } {
  switch (phase) {
    case 'OFF':
      return { power: 0, static: 0 };
    case 'BOOTING':
      return { power: 0.6, static: 0.2 };
    case 'TUNING':
      return { power: 1, static: 1 };
    case 'STAND_BY':
    case 'SIGN_OFF':
      return { power: 1, static: 0.4 };
    case 'ON_AIR':
    case 'EVENT':
      return { power: 1, static: 0.08 };
  }
}

export function Screen({ phase, channelLabel }: ScreenProps) {
  const off = phase === 'OFF';
  const word = statusWord(phase);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CrtRenderer | null>(null);

  // Create the WebGL2 renderer once the canvas is mounted. Where WebGL2 is
  // unavailable (e.g. jsdom in unit tests) `create` returns null and the TV
  // simply shows the status word; the non-WebGL fallback is task 4.3.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = CrtRenderer.create(canvas);
    if (!renderer) return;
    rendererRef.current = renderer;
    renderer.setLook(DEFAULT_LOOK);
    renderer.start();
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Drive the renderer from the current phase. Owned sources (Milestone 2) will
  // also hand the renderer a texture via setSource; until then the shader draws
  // procedural static and the look over tube black.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const drive = phaseDrive(phase);
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { createReflection, type ReflectionController } from '../render/reflection.ts';
import { type Renderer } from '../render/Renderer.ts';
import { type TvPhase } from '../core/tvMachine.ts';

/**
 * The optional reflection (requirement 7): the rear-panel switch and when the glass
 * shows it. The choice lives only here in component state, so it does not survive a
 * load (7.7), and no story content looks at it (7.9). Power does not touch the camera.
 */
export type ReflectionStatus = 'off' | 'asking' | 'on';

export interface ReflectionInputs {
  phase: TvPhase;
  /** A scripted silence on our own picture, while the tube is dark. */
  scriptedSilence: boolean;
  surface: 'canvas' | 'youtube' | null;
  getRenderer: () => Renderer | null;
  /** Current act. From Act 3 there is something in the glass with them. */
  getAct: () => number;
}

export interface ReflectionControl {
  status: ReflectionStatus;
  /** A short plain message when the camera could not be had. */
  message: string;
  toggle: () => void;
  /** Switch off now, for Forget me. */
  off: () => void;
}

/** Tube dark (7.3), and never over a player or the sign-off (7.4), which are other phases. */
export function reflectionVisible(phase: TvPhase, scriptedSilence: boolean, surface: ReflectionInputs['surface']): boolean {
  if (phase === 'OFF') return true;
  return phase === 'EVENT' && scriptedSilence && surface === 'canvas';
}

export function useReflection({ phase, scriptedSilence, surface, getRenderer, getAct }: ReflectionInputs): ReflectionControl {
  const [status, setStatus] = useState<ReflectionStatus>('off');
  const [message, setMessage] = useState('');
  const controllerRef = useRef<ReflectionController | null>(null);

  const off = useCallback(() => {
    controllerRef.current?.disable();
    getRenderer()?.setReflection(null, 0);
    setStatus('off');
  }, [getRenderer]);

  const toggle = useCallback(() => {
    if (status !== 'off') {
      off();
      setMessage('');
      return;
    }
    setMessage('');
    // Nothing to show it with: do not start a camera for no picture (8.5).
    if (!getRenderer()?.supportsReflection()) {
      setMessage('Reflection is not available on this device.');
      return;
    }
    const controller = controllerRef.current ?? createReflection();
    controllerRef.current = controller;
    setStatus('asking');
    void controller.enable().then((result) => {
      if (result === 'on') {
        setStatus('on');
        return;
      }
      setStatus('off');
      setMessage(result === 'denied' ? 'Camera permission was denied.' : 'No camera was found.');
    });
  }, [status, off, getRenderer]);

  // A hidden tab stops the camera for good: it comes back only when asked (7.6).
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') off();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [off]);

  useEffect(() => () => controllerRef.current?.disable(), []);

  useEffect(() => {
    if (status !== 'on') return;
    const video = controllerRef.current?.video() ?? null;
    const level = reflectionVisible(phase, scriptedSilence, surface) ? 1 : 0;
    getRenderer()?.setReflection(video, level, getAct() >= 3);
  }, [status, phase, scriptedSilence, surface, getRenderer, getAct]);

  return { status, message, toggle, off };
}

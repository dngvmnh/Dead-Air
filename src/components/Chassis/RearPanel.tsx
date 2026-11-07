import { useState } from 'react';
import styles from './RearPanel.module.css';
import { type ReflectionControl } from '../../app/useReflection.ts';

/**
 * The set's rear panel: the optional reflection (requirement 7), and Forget me,
 * which erases viewer memory (requirement 7.6). A confirm step avoids an accidental
 * wipe. What the camera is for is written here, before any prompt can appear.
 */
export interface RearPanelProps {
  onForgetMe: () => void;
  reflection: ReflectionControl;
}

export function RearPanel({ onForgetMe, reflection }: RearPanelProps) {
  const [confirming, setConfirming] = useState(false);

  function handleForget(): void {
    if (confirming) {
      onForgetMe();
      setConfirming(false);
    } else {
      setConfirming(true);
    }
  }

  const lit = reflection.status === 'on';

  return (
    <div className={styles.panel} role="group" aria-label="Rear panel">
      <div className={styles.header}>
        <span className={styles.title}>Rear panel</span>
        <span className={styles.lamp} data-testid="refl-lamp" data-lit={lit}>
          <span className={styles.lampDot} aria-hidden="true" />
          REFL
          <span className="visually-hidden">{lit ? ' camera in use' : ' camera not in use'}</span>
        </span>
      </div>

      <button
        type="button"
        className={styles.button}
        onClick={reflection.toggle}
        aria-pressed={reflection.status !== 'off'}
      >
        Reflection {reflection.status === 'off' ? 'off' : 'on'}
      </button>
      <p className={styles.copy}>
        Reflection (optional). Uses your camera to show you in the glass. Stays on this device. Nothing is recorded or
        sent.
      </p>
      {reflection.message ? (
        <p className={styles.message} role="status">
          {reflection.message}
        </p>
      ) : null}

      <button
        type="button"
        className={`${styles.button} ${styles.forget}`}
        onClick={handleForget}
        onBlur={() => setConfirming(false)}
        aria-label={confirming ? 'Confirm forget me' : 'Forget me'}
      >
        {confirming ? 'Tap again to erase' : 'Forget me'}
      </button>
    </div>
  );
}

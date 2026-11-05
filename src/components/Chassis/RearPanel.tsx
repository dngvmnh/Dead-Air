import { useState } from 'react';
import styles from './RearPanel.module.css';

/**
 * The set's rear panel (task 3.3): accessibility and privacy controls.
 *   - Reduced Effects disables flashes, roll and jitter (requirement 13.2).
 *   - Forget me erases viewer memory (requirement 7.6). A confirm step avoids
 *     an accidental wipe.
 */
export interface RearPanelProps {
  reducedEffects: boolean;
  onToggleReducedEffects: () => void;
  onForgetMe: () => void;
}

export function RearPanel({
  reducedEffects,
  onToggleReducedEffects,
  onForgetMe,
}: RearPanelProps) {
  const [confirming, setConfirming] = useState(false);

  function handleForget(): void {
    if (confirming) {
      onForgetMe();
      setConfirming(false);
    } else {
      setConfirming(true);
    }
  }

  return (
    <div className={styles.panel} role="group" aria-label="Rear panel">
      <span className={styles.title}>Rear panel</span>

      <button
        type="button"
        className={styles.button}
        aria-pressed={reducedEffects}
        onClick={onToggleReducedEffects}
      >
        Reduced effects
      </button>

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

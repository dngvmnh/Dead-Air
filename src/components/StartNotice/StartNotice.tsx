import { useEffect, useRef } from 'react';
import styles from './StartNotice.module.css';

/**
 * First-run content warning (requirement 1.2, safety-and-rights.md).
 * Must be acknowledged before POWER can start the television.
 */
export interface StartNoticeProps {
  onAcknowledge: () => void;
}

export function StartNotice({ onAcknowledge }: StartNoticeProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-notice-title"
    >
      <div className={styles.panel}>
        <h2 id="start-notice-title" className={styles.title}>
          Before you turn it on
        </h2>
        <p className={styles.body}>
          DEAD AIR is a horror experience that simulates late-night analog
          television. Please be aware it contains:
        </p>
        <ul className={styles.list}>
          <li>Flashing lights and sudden visual static</li>
          <li>Sudden and unsettling sounds</li>
          <li>Horror themes and a slow, creeping dread</li>
        </ul>
        <p className={styles.body}>
          Flashing is limited to three flashes per second. You can turn on
          Reduced Effects on the set&rsquo;s rear panel at any time, and your
          system&rsquo;s reduced-motion setting is respected automatically.
          Your viewing history stays in this browser, and this site never
          sends it anywhere. Programmes from YouTube are played by YouTube,
          under its own terms.
        </p>
        <div className={styles.actions}>
          <button
            ref={buttonRef}
            type="button"
            className={styles.enter}
            onClick={onAcknowledge}
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}

import { type ReactNode } from 'react';
import styles from './Room.module.css';

/**
 * The room around the set. Holds the ARIA live region used to announce channel
 * changes (requirement 13.5). The vignette is painted on the room background,
 * never as a full-screen overlay in front of the tube.
 */
export interface RoomProps {
  announcement: string;
  children: ReactNode;
}

export function Room({ announcement, children }: RoomProps) {
  return (
    <div className={styles.room}>
      {children}
      <div className={styles.liveRegion} aria-live="polite" role="status">
        {announcement}
      </div>
    </div>
  );
}

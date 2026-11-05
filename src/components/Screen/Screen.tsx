import styles from './Screen.module.css';
import { type TvPhase } from '../../core/tvMachine.ts';

/**
 * The tube opening. Milestone 1 shows a status word so the chassis is legible;
 * the WebGL CRT renderer and real sources replace the placeholder in task 4.
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

export function Screen({ phase, channelLabel }: ScreenProps) {
  const off = phase === 'OFF';
  const word = statusWord(phase);

  return (
    <div
      className={`${styles.tube} ${off ? styles.off : ''}`}
      data-phase={phase}
      data-testid="tube-opening"
    >
      <canvas className={styles.canvas} aria-hidden="true" />
      {!off && word ? (
        <div className={styles.placeholder}>
          {word}
          {phase === 'ON_AIR' || phase === 'EVENT' ? ` · CH ${channelLabel}` : ''}
        </div>
      ) : null}
    </div>
  );
}

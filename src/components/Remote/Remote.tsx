import { type RefObject } from 'react';
import styles from './Remote.module.css';
import { type TvState } from '../../core/tvMachine.ts';
import { type UiSettings } from '../../app/useTelevision.ts';

/**
 * The physical controls on the chassis: POWER, channel up/down, volume, mute,
 * and closed captions, plus the LED display (requirements 1.1, 2.1, 2.2, 2.5,
 * 12.3, 13.3, 13.4). Every control has an accessible name, and a 44px target on phones (40px on desktop).
 */
export interface RemoteProps {
  state: TvState;
  settings: UiSettings;
  channelLabel: string;
  powerRef: RefObject<HTMLButtonElement | null>;
  onPower: () => void;
  onChannelUp: () => void;
  onChannelDown: () => void;
  onVolume: (volume: number) => void;
  onToggleMute: () => void;
  onToggleCaptions: () => void;
}

export function Remote({
  state,
  settings,
  channelLabel,
  powerRef,
  onPower,
  onChannelUp,
  onChannelDown,
  onVolume,
  onToggleMute,
  onToggleCaptions,
}: RemoteProps) {
  const powered = state.phase !== 'OFF';
  const canSurf = powered && state.phase !== 'BOOTING' && state.phase !== 'SIGN_OFF';

  return (
    <div className={styles.remote} role="group" aria-label="Television controls">
      <div className={styles.ledPanel} aria-hidden="false">
        <span
          className={styles.powerLed}
          data-on={powered}
          role="img"
          aria-label={powered ? 'Power on' : 'Power off'}
        />
        <span className={styles.channelLed} data-on={powered}>
          {powered ? channelLabel : '--'}
        </span>
        <span className={styles.muteLed} data-on={settings.muted}>
          MUTE
        </span>
      </div>

      <button
        ref={powerRef}
        type="button"
        className={`${styles.button} ${styles.power}`}
        data-on={powered}
        aria-pressed={powered}
        onClick={onPower}
      >
        Power
      </button>

      <div className={styles.group} role="group" aria-label="Channel">
        <span className={styles.label}>CH</span>
        <button
          type="button"
          className={styles.button}
          onClick={onChannelDown}
          disabled={!canSurf}
          aria-label="Channel down"
        >
          −
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={onChannelUp}
          disabled={!canSurf}
          aria-label="Channel up"
        >
          +
        </button>
      </div>

      <div className={styles.group} role="group" aria-label="Volume">
        <span className={styles.label}>Vol</span>
        <input
          className={styles.volume}
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(settings.volume * 100)}
          onChange={(e) => onVolume(Number(e.target.value) / 100)}
          aria-label="Volume"
          aria-valuetext={`${Math.round(settings.volume * 100)} percent`}
        />
        <button
          type="button"
          className={`${styles.button} ${styles.toggle}`}
          aria-pressed={settings.muted}
          onClick={onToggleMute}
        >
          Mute
        </button>
      </div>

      <button
        type="button"
        className={`${styles.button} ${styles.toggle}`}
        aria-pressed={settings.captions}
        onClick={onToggleCaptions}
        aria-label="Closed captions"
      >
        CC
      </button>
    </div>
  );
}

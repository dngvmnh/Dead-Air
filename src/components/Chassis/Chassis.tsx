import { type RefObject } from 'react';
import styles from './Chassis.module.css';
import { Screen } from '../Screen/Screen.tsx';
import { Remote } from '../Remote/Remote.tsx';
import { RearPanel } from './RearPanel.tsx';
import { HauntedDecor } from './HauntedDecor.tsx';
import { channelLabel } from '../../core/channels.ts';
import { type TelevisionApi } from '../../app/useTelevision.ts';

/**
 * The television cabinet: bezel + tube opening, the control panel, and the rear
 * panel. Controls sit beside the screen so the whole set fits a laptop viewport,
 * and stack under a full-width screen below 768px (requirement 15.2).
 */
export interface ChassisProps {
  tv: TelevisionApi;
  powerRef: RefObject<HTMLButtonElement | null>;
}

export function Chassis({ tv, powerRef }: ChassisProps) {
  const label = channelLabel(tv.state.channel);

  return (
    <div className={styles.chassis}>
      <HauntedDecor />
      <div className={styles.bezel}>
        <Screen
          phase={tv.state.phase}
          channelLabel={label}
          reducedEffects={tv.settings.reducedEffects}
          onRendererReady={tv.registerRenderer}
          tubeTearable={tv.tubeTearable}
          onTubeRip={(speed) => tv.getAudio().playRip(speed)}
          onTubeTearEnd={tv.onTearEnd}
        />
      </div>
      <p className={styles.brand}>KDA · DEAD AIR</p>

      <Remote
        state={tv.state}
        settings={tv.settings}
        channelLabel={label}
        powerRef={powerRef}
        onPower={tv.power}
        onChannelUp={tv.channelUp}
        onChannelDown={tv.channelDown}
        onVolume={tv.setVolume}
        onToggleMute={tv.toggleMute}
        onToggleCaptions={tv.toggleCaptions}
      />

      <RearPanel onForgetMe={tv.forgetMe} />
    </div>
  );
}

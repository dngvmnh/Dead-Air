import styles from './Chassis.module.css';
import { Screen } from '../Screen/Screen.tsx';
import { Remote } from '../Remote/Remote.tsx';
import { RearPanel } from './RearPanel.tsx';
import { channelLabel } from '../../core/channels.ts';
import { type TelevisionApi } from '../../app/useTelevision.ts';

/**
 * The television cabinet: bezel + tube opening, the control panel, and the rear
 * panel. Below 768px the controls stack under a full-width screen (requirement
 * 15.2), which the flex column and responsive chassis width provide.
 */
export interface ChassisProps {
  tv: TelevisionApi;
}

export function Chassis({ tv }: ChassisProps) {
  const label = channelLabel(tv.state.channel);

  return (
    <div className={styles.chassis}>
      <div className={styles.bezel}>
        <Screen phase={tv.state.phase} channelLabel={label} />
      </div>
      <p className={styles.brand}>KDA · DEAD AIR</p>

      <Remote
        state={tv.state}
        settings={tv.settings}
        channelLabel={label}
        onPower={tv.power}
        onChannelUp={tv.channelUp}
        onChannelDown={tv.channelDown}
        onVolume={tv.setVolume}
        onToggleMute={tv.toggleMute}
        onToggleCaptions={tv.toggleCaptions}
      />

      <RearPanel
        reducedEffects={tv.settings.reducedEffects}
        onToggleReducedEffects={tv.toggleReducedEffects}
        onForgetMe={tv.forgetMe}
      />
    </div>
  );
}

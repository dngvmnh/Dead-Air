import { useTelevision } from './useTelevision.ts';
import { useKeyboardControls } from './useKeyboardControls.ts';
import { Room } from '../components/Room/Room.tsx';
import { Chassis } from '../components/Chassis/Chassis.tsx';
import { StartNotice } from '../components/StartNotice/StartNotice.tsx';

/**
 * App shell. Milestone 1 wires the room, chassis and controls around the
 * television. The broadcast clock, adapters, audio and horror director arrive
 * in later milestones through the same useTelevision orchestrator.
 */
export function App() {
  const tv = useTelevision();
  useKeyboardControls(tv);

  return (
    <>
      <h1 className="visually-hidden">DEAD AIR</h1>
      <Room announcement={tv.announcement}>
        <Chassis tv={tv} />
      </Room>
      {tv.state.noticeSeen ? null : (
        <StartNotice onAcknowledge={tv.acknowledgeNotice} />
      )}
    </>
  );
}

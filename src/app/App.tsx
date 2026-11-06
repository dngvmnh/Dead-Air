import { useEffect, useRef } from 'react';
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
  const { noticeSeen } = tv.state;
  const powerRef = useRef<HTMLButtonElement>(null);

  // Closing the notice removes the focused element, so hand focus to the one
  // control the viewer needs next.
  useEffect(() => {
    if (noticeSeen) powerRef.current?.focus();
  }, [noticeSeen]);

  return (
    <>
      <h1 className="visually-hidden">DEAD AIR</h1>
      <div inert={!noticeSeen}>
        <Room announcement={tv.announcement}>
          <Chassis tv={tv} powerRef={powerRef} />
        </Room>
      </div>
      {noticeSeen ? null : (
        <StartNotice onAcknowledge={tv.acknowledgeNotice} />
      )}
    </>
  );
}

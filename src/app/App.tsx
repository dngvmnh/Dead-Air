import { useEffect, useRef } from 'react';
import { useTelevision } from './useTelevision.ts';
import { useKeyboardControls } from './useKeyboardControls.ts';
import { Room } from '../components/Room/Room.tsx';
import { RoomCanvas } from '../components/Room/RoomCanvas.tsx';
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
        {/* The tearable wall sits BEHIND the chassis (z-index 0); the chassis is
            opaque and establishes its own stacking context above it, so the room
            can never overlap the tube or a YouTube surface (design §1). Tear
            input is ignored until the notice is acknowledged (requirement 1.8). */}
        <RoomCanvas
          interactive={noticeSeen}
          getAudio={tv.getAudio}
          getRoomState={tv.getRoomState}
          getBehindView={tv.getBehindView}
          reduced={tv.settings.reducedEffects}
        />
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

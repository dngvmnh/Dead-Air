/** Shades jump art away from the main thread (see `jumpBake.ts`). */

import { jumpPixels } from './jumpBake.ts';
import type { JumpKind } from '../content/schema.ts';
import type { Pose } from './jumpArt.ts';

self.onmessage = (e: MessageEvent<[JumpKind, Pose]>) => {
  const [kind, pose] = e.data;
  const pixels = jumpPixels(kind, pose);
  (self as unknown as { postMessage: (m: unknown, t: Transferable[]) => void }).postMessage({ kind, pose, pixels }, [pixels.buffer]);
};

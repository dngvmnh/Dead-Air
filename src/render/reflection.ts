/**
 * The camera, for the viewer's reflection in the dark glass (requirement 7, design
 * §8). This is the only module that may ask for it, and only from the rear panel's
 * click. The video stays out of the DOM, and its one consumer is the CRT's texture
 * upload: nothing analyses, saves, uploads or reads back a frame.
 * `reflection.test.ts` holds the rest of the source to that.
 */

export type ReflectionResult = 'on' | 'denied' | 'unavailable';

export interface ReflectionController {
  /** Ask for the camera. Call only from a click on the rear panel. */
  enable(): Promise<ReflectionResult>;
  /** Stop every track and let go of the stream. */
  disable(): void;
  video(): HTMLVideoElement | null;
}

export function createReflection(
  media: Pick<MediaDevices, 'getUserMedia'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices,
): ReflectionController {
  let element: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  // A viewer can switch off while the browser's prompt is still up.
  let ask = 0;

  const stop = (s: MediaStream): void => {
    for (const track of s.getTracks()) track.stop();
  };

  const disable = (): void => {
    ask += 1;
    if (stream) stop(stream);
    stream = null;
    if (element) element.srcObject = null;
    element = null;
  };

  return {
    video: () => element,
    disable,
    enable: async () => {
      if (!media?.getUserMedia) return 'unavailable';
      ask += 1;
      const mine = ask;
      let got: MediaStream;
      try {
        got = await media.getUserMedia({
          video: { width: 320, height: 240, facingMode: 'user' },
          audio: false,
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable';
      }
      if (mine !== ask) {
        stop(got);
        return 'unavailable';
      }
      stream = got;
      element = document.createElement('video');
      element.muted = true;
      element.playsInline = true;
      element.srcObject = got;
      try {
        await element.play();
      } catch {
        // Autoplay of a muted stream is allowed after a click; if a browser still
        // refuses, the texture stays black and the viewer can switch it off.
      }
      return 'on';
    },
  };
}

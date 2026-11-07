/**
 * The set fills the screen from the viewer's first click (the owner's request,
 * 2026-11-07). Browsers only allow fullscreen in answer to a click, so this is called
 * from the notice's button and from POWER, and a refusal leaves the window as it was.
 * Escape, as always, leaves fullscreen; nothing asks again until the next click.
 */
export function enterFullscreen(): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as {
    __CRT_PRESERVE_DRAWING_BUFFER__?: boolean;
    __FULLSCREEN_TEST__?: boolean;
  };
  // The browser tests keep a fixed window, unless one checks this.
  if (w.__CRT_PRESERVE_DRAWING_BUFFER__ && !w.__FULLSCREEN_TEST__) return;
  const root = document.documentElement;
  if (document.fullscreenElement || typeof root.requestFullscreen !== 'function') return;
  try {
    void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  } catch {
    // An old engine throws instead of rejecting.
  }
}

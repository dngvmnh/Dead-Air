import { useEffect } from 'react';
import { type TelevisionApi } from './useTelevision.ts';

/**
 * Global keyboard shortcuts (requirement 2.6):
 *   ArrowUp  -> CH+      ArrowDown -> CH-
 *   P        -> power    M         -> mute
 *   -        -> volume down        =  -> volume up
 *
 * Shortcuts are suppressed while focus is inside the YouTube iframe, because the
 * player owns its own keyboard handling and we must not intercept it.
 */

const VOLUME_STEP = 0.1;

function focusInYouTube(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLIFrameElement && active.classList.contains('yt-iframe');
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export function useKeyboardControls(tv: TelevisionApi): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      // The first-run notice is modal: nothing behind it responds yet.
      if (!tv.state.noticeSeen) return;
      // Holding a toggle key must not flip it on and off.
      if (e.repeat && ['p', 'm'].includes(e.key.toLowerCase())) return;
      if (focusInYouTube()) return;

      // The volume range and buttons handle their own keys; don't double-act.
      if (isTypingTarget(e.target) && e.key !== 'p' && e.key !== 'P') return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          tv.channelUp();
          break;
        case 'ArrowDown':
          e.preventDefault();
          tv.channelDown();
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          tv.power();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          tv.toggleMute();
          break;
        case '-':
        case '_':
          e.preventDefault();
          tv.setVolume(tv.settings.volume - VOLUME_STEP);
          break;
        case '=':
        case '+':
          e.preventDefault();
          tv.setVolume(tv.settings.volume + VOLUME_STEP);
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tv]);
}

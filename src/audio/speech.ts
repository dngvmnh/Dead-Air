/**
 * Presenters' voices, from the browser's own speech synthesis. No recordings and
 * nothing sent anywhere by this code. Slowed and pitched down, a stock voice
 * sounds like a person reading something they were told to read. It bypasses the
 * master limiter, so its level stays below the volume the viewer set.
 */

export interface SpeechOptions {
  /** 0..1 from the viewer's volume and mute. Zero stays silent. */
  volume: number;
  rate?: number;
  pitch?: number;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

function englishVoice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = s.getVoices();
  return voices.find((v) => v.lang.startsWith('en') && v.localService) ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
}

/** Say a line, replacing whatever was being said. */
export function say(text: string, { volume, rate = 0.92, pitch = 0.8 }: SpeechOptions): void {
  const s = synth();
  if (!s || volume <= 0) return;
  s.cancel();
  const line = new SpeechSynthesisUtterance(text);
  const voice = englishVoice(s);
  if (voice) line.voice = voice;
  line.volume = Math.min(1, volume) * 0.85;
  line.rate = rate;
  line.pitch = pitch;
  s.speak(line);
}

export function hush(): void {
  synth()?.cancel();
}

/** Roughly how long a line takes to say, for steps that wait for it. */
export function spokenMs(text: string): number {
  return Math.min(5500, Math.max(1800, text.length * 75));
}

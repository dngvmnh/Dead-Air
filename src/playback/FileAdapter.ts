/**
 * Plays a self-hosted film through the CRT (design §6). The broadcast clock still
 * owns the timeline: it decides what is on and where, and it ends the item. The
 * clip loops only as a guard, so a clock slightly longer than the file holds the
 * picture rather than freezing it.
 */

import type { Item } from '../core/types.ts';
import type { AdapterEvent, PlaybackAdapter, SceneContext } from './PlaybackAdapter.ts';

export interface FileAdapterDeps {
  createVideo?: () => HTMLVideoElement;
}

function defaultVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.loop = true;
  return video;
}

export class FileAdapter implements PlaybackAdapter {
  readonly surface = 'canvas' as const;
  /** Exposed so the audio engine can route it through the analog chain. */
  readonly video: HTMLVideoElement;

  private readonly listeners = new Set<(e: AdapterEvent) => void>();
  private ctx: SceneContext | null = null;
  private url: string | null = null;
  /** Bumped on every load and stop, so a slow load cannot start a stale clip. */
  private loadToken = 0;

  constructor(deps: FileAdapterDeps = {}) {
    this.video = (deps.createVideo ?? defaultVideo)();
    this.video.addEventListener('error', () => {
      if (this.url !== null) this.emit({ type: 'error', fatal: true });
    });
  }

  load(item: Item, offsetMs: number, ctx: SceneContext): Promise<void> {
    if (item.source !== 'file') {
      return Promise.reject(new Error(`FileAdapter cannot play a ${item.source} item`));
    }
    const token = (this.loadToken += 1);
    this.ctx = ctx;
    ctx.setLook?.(item.look);
    const seek = (): void => {
      if (token !== this.loadToken) return;
      const duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
      const seconds = offsetMs / 1000;
      this.video.currentTime = duration > 0 ? seconds % duration : seconds;
      ctx.setSource(this.video);
    };
    if (this.url === item.url && this.video.readyState >= 1) {
      seek();
      return Promise.resolve();
    }
    this.url = item.url;
    return new Promise((resolve) => {
      const done = (): void => {
        this.video.removeEventListener('loadedmetadata', done);
        seek();
        resolve();
      };
      this.video.addEventListener('loadedmetadata', done);
      this.video.src = item.url;
      this.video.load();
    });
  }

  async play(): Promise<void> {
    const token = this.loadToken;
    try {
      await this.video.play();
      if (token === this.loadToken) this.emit({ type: 'playing' });
    } catch {
      if (token !== this.loadToken) return;
      // Autoplay refused. A muted picture beats a dead channel.
      this.video.muted = true;
      this.emit({ type: 'blocked' });
      await this.video.play().catch(() => this.emit({ type: 'error', fatal: true }));
    }
  }

  pause(): void {
    this.video.pause();
    this.emit({ type: 'paused', byUser: true });
  }

  stop(): void {
    this.loadToken += 1;
    this.video.pause();
    this.ctx?.setSource(null);
  }

  /** Level is set on the master bus once routed; this covers an unrouted element. */
  setVolume(volume01: number, muted: boolean): void {
    this.video.volume = Math.min(1, Math.max(0, volume01));
    this.video.muted = muted;
  }

  positionMs(): number {
    return this.video.currentTime * 1000;
  }

  on(listener: (e: AdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: AdapterEvent): void {
    for (const l of this.listeners) l(e);
  }
}

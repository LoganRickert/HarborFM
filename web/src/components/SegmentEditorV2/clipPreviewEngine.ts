/**
 * Clip-faithful advanced editor preview.
 *
 * One HTMLAudioElement per unique take file (well under browser limits for
 * typical HarborFM sessions). Transport clock is timeline ms via rAF.
 * Soft trims jump the playhead; clip blade/edge edits are heard immediately
 * without remaking the master mix.
 *
 * Takes free-run once started. We only seek on user seek, soft-trim jump,
 * clip enter, or large drift. Calling currentTime / play() every frame is
 * what made early builds choppy.
 */
import {
  clipEndMs,
  clipStartMs,
  sourceOffsetMsOf,
  type EditorClip,
} from './clipOps';
import { takeStreamUrl } from '../../api/segments';

/** Only re-seek when wall clock and element diverge this far (seconds). */
const DRIFT_SEC = 0.25;

export type ClipPreviewClip = Pick<
  EditorClip,
  'uiId' | 'filePath' | 'startMs' | 'endMs' | 'lengthMs' | 'sourceOffsetMs' | 'volume' | 'muted'
>;

function takeBasename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath;
}

function isInTrim(sec: number, trimRanges: Array<[number, number]>): boolean {
  for (const [start, end] of trimRanges) {
    if (sec >= start && sec < end) return true;
  }
  return false;
}

/** Jump to end of containing soft trim, if any. */
export function skipOutOfTrimSec(
  sec: number,
  trimRanges: Array<[number, number]>,
): number {
  for (const [start, end] of trimRanges) {
    if (sec >= start && sec < end) return end;
  }
  return sec;
}

export type ClipPreviewEngineOpts = {
  episodeId: string;
  segmentId: string;
  getClips: () => ClipPreviewClip[];
  getTrimRanges: () => Array<[number, number]>;
  getDurationMs: () => number;
  onPlayheadMs: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onError?: (message: string) => void;
};

type ActiveTakeState = {
  clipUiId: string;
  sourceSec: number;
  volume: number;
};

export class ClipPreviewEngine {
  private opts: ClipPreviewEngineOpts;
  private takes = new Map<string, HTMLAudioElement>();
  /** Take basename -> clip uiId currently driving that element. */
  private activeClipByTake = new Map<string, string>();
  private playing = false;
  private playheadMs = 0;
  private playbackRate = 1;
  private raf = 0;
  private lastTickPerf = 0;
  private disposed = false;

  constructor(opts: ClipPreviewEngineOpts) {
    this.opts = opts;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  getPlayheadMs(): number {
    return this.playheadMs;
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  setPlaybackRate(rate: number): void {
    const next =
      Number.isFinite(rate) && rate > 0 ? Math.min(4, Math.max(0.25, rate)) : 1;
    this.playbackRate = next;
    for (const el of this.takes.values()) {
      el.playbackRate = next;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    for (const el of this.takes.values()) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.takes.clear();
    this.activeClipByTake.clear();
  }

  setPlayheadMs(ms: number, opts?: { resumeIfPlaying?: boolean }): void {
    const durationMs = Math.max(0, this.opts.getDurationMs());
    let next = Math.max(0, Math.min(ms, durationMs));
    next =
      skipOutOfTrimSec(next / 1000, this.opts.getTrimRanges()) * 1000;
    this.playheadMs = next;
    this.opts.onPlayheadMs(next);
    // Seek into place paused first, then resume if needed.
    this.syncTakes({ forceSeek: true, allowPlay: false });
    if (opts?.resumeIfPlaying && this.playing) {
      this.syncTakes({ forceSeek: false, allowPlay: true });
    }
  }

  play(): void {
    if (this.disposed) return;
    const durationMs = Math.max(0, this.opts.getDurationMs());
    if (durationMs <= 0) return;
    let start = this.playheadMs;
    if (start >= durationMs - 50) start = 0;
    start = skipOutOfTrimSec(start / 1000, this.opts.getTrimRanges()) * 1000;
    this.playheadMs = start;
    this.opts.onPlayheadMs(start);
    this.playing = true;
    this.opts.onPlayingChange(true);
    this.lastTickPerf = performance.now();
    this.preloadTakes(this.opts.getClips());
    this.syncTakes({ forceSeek: true, allowPlay: true });
    this.startRaf();
  }

  pause(): void {
    this.playing = false;
    this.opts.onPlayingChange(false);
    this.stopRaf();
    for (const el of this.takes.values()) {
      if (!el.paused) el.pause();
    }
    this.activeClipByTake.clear();
    this.opts.onPlayheadMs(this.playheadMs);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Call when clips / trims / duration change while playing. */
  resync(): void {
    if (this.disposed) return;
    this.preloadTakes(this.opts.getClips());
    this.setPlayheadMs(this.playheadMs, { resumeIfPlaying: this.playing });
  }

  private preloadTakes(clips: ClipPreviewClip[]): void {
    const seen = new Set<string>();
    for (const clip of clips) {
      const key = takeBasename(clip.filePath);
      if (seen.has(key)) continue;
      seen.add(key);
      this.ensureTake(clip.filePath);
    }
  }

  private startRaf(): void {
    this.stopRaf();
    const tick = (now: number) => {
      if (this.disposed || !this.playing) return;
      const dt = Math.max(0, Math.min(0.1, (now - this.lastTickPerf) / 1000));
      this.lastTickPerf = now;
      let nextSec = this.playheadMs / 1000 + dt * this.playbackRate;
      const trims = this.opts.getTrimRanges();
      const skipped = skipOutOfTrimSec(nextSec, trims);
      if (skipped > nextSec + 0.0005) {
        nextSec = skipped;
        this.playheadMs = nextSec * 1000;
        this.opts.onPlayheadMs(this.playheadMs);
        // Soft-trim jump: must re-seek all active takes.
        this.syncTakes({ forceSeek: true, allowPlay: true });
      } else {
        this.playheadMs = nextSec * 1000;
        this.opts.onPlayheadMs(this.playheadMs);
        this.syncTakes({ forceSeek: false, allowPlay: true });
      }
      const durationMs = this.opts.getDurationMs();
      if (this.playheadMs >= durationMs - 20) {
        this.playheadMs = durationMs;
        this.opts.onPlayheadMs(this.playheadMs);
        this.pause();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopRaf(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private ensureTake(filePath: string): HTMLAudioElement {
    const key = takeBasename(filePath);
    let el = this.takes.get(key);
    if (el) return el;
    el = new Audio();
    el.preload = 'auto';
    // Same-origin / proxied /api: cookies send without CORS crossOrigin.
    el.src = takeStreamUrl(
      this.opts.episodeId,
      this.opts.segmentId,
      key,
    );
    el.playbackRate = this.playbackRate;
    el.addEventListener('error', () => {
      this.opts.onError?.(`Could not load take audio: ${key}`);
    });
    this.takes.set(key, el);
    return el;
  }

  private syncTakes(opts: { forceSeek: boolean; allowPlay: boolean }): void {
    const tMs = this.playheadMs;
    const tSec = tMs / 1000;
    const trims = this.opts.getTrimRanges();
    if (isInTrim(tSec, trims)) {
      for (const el of this.takes.values()) {
        if (!el.paused) el.pause();
      }
      this.activeClipByTake.clear();
      return;
    }

    const clips = this.opts.getClips();
    const activeByTake = new Map<string, ActiveTakeState>();

    for (const clip of clips) {
      if (clip.muted === true) continue;
      const start = clipStartMs(clip);
      const end = clipEndMs(clip);
      if (tMs < start || tMs >= end) continue;
      const key = takeBasename(clip.filePath);
      const sourceSec =
        sourceOffsetMsOf(clip) / 1000 + (tMs - start) / 1000;
      const volume =
        typeof clip.volume === 'number' && Number.isFinite(clip.volume)
          ? Math.max(0, Math.min(1, clip.volume))
          : 1;
      const prev = activeByTake.get(key);
      if (!prev || volume >= prev.volume) {
        activeByTake.set(key, {
          clipUiId: clip.uiId,
          sourceSec,
          volume,
        });
      }
    }

    const needed = new Set(activeByTake.keys());
    for (const [key, el] of this.takes) {
      if (!needed.has(key)) {
        if (!el.paused) el.pause();
        this.activeClipByTake.delete(key);
      }
    }

    for (const [key, state] of activeByTake) {
      const el = this.ensureTake(key);
      if (el.playbackRate !== this.playbackRate) el.playbackRate = this.playbackRate;
      if (el.volume !== state.volume) el.volume = state.volume;

      const prevClipId = this.activeClipByTake.get(key);
      const enteredNewClip = prevClipId !== state.clipUiId;
      const drift = Math.abs(el.currentTime - state.sourceSec);
      // On clip enter, skip seek when already within a small window (abutting
      // slices of the same take) so we do not interrupt decode.
      const shouldSeek =
        opts.forceSeek ||
        (enteredNewClip && drift > 0.05) ||
        drift > DRIFT_SEC;

      if (shouldSeek) {
        try {
          el.currentTime = Math.max(0, state.sourceSec);
        } catch {
          // ignore seek before metadata
        }
      }

      this.activeClipByTake.set(key, state.clipUiId);

      if (opts.allowPlay && this.playing) {
        // Only kick play when actually paused. Calling play() every frame
        // stalls decode and sounds choppy.
        if (el.paused) {
          void el.play().catch(() => {
            // Autoplay / decode errors: leave silent for this take.
          });
        }
      } else if (!el.paused) {
        el.pause();
      }
    }
  }
}

/**
 * Clip-faithful advanced editor preview.
 *
 * One HTMLAudioElement per unique take file (well under browser limits for
 * typical HarborFM sessions). Transport clock is timeline ms via rAF.
 * Soft trims jump the playhead; clip blade/edge edits are heard immediately
 * without remaking the master mix.
 *
 * Each take routes through a Web Audio graph for live track FX:
 * MediaElementSource → Gate gain → EQ (3× Biquad) → DynamicsCompressor →
 * Makeup gain → Volume gain → destination.
 *
 * Takes free-run once started. We only seek on user seek, soft-trim jump,
 * clip enter, or large drift. Calling currentTime / play() every frame is
 * what made early builds choppy.
 */
import type {
  SegmentTrackComp,
  SegmentTrackEqBand,
  SegmentTrackGate,
} from '@harborfm/shared';
import {
  clipEndMs,
  clipStartMs,
  sourceOffsetMsOf,
  type EditorClip,
} from './clipOps';
import { takeStreamUrl } from '../../api/segments';
import {
  EQ_HIGH_HZ,
  EQ_LOW_HZ,
  EQ_MID_HZ,
  EQ_MID_Q,
  eqBandsToUi,
} from './trackFx';

/** Only re-seek when wall clock and element diverge this far (seconds). */
const DRIFT_SEC = 0.25;

export type ClipPreviewClip = Pick<
  EditorClip,
  | 'uiId'
  | 'filePath'
  | 'startMs'
  | 'endMs'
  | 'lengthMs'
  | 'sourceOffsetMs'
  | 'volume'
  | 'muted'
> & {
  eqBands?: SegmentTrackEqBand[];
  gate?: SegmentTrackGate;
  comp?: SegmentTrackComp;
};

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
  eqBands?: SegmentTrackEqBand[];
  gate?: SegmentTrackGate;
  comp?: SegmentTrackComp;
};

type TakeFxGraph = {
  source: MediaElementAudioSourceNode;
  gateGain: GainNode;
  analyser: AnalyserNode;
  lowShelf: BiquadFilterNode;
  peaking: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  makeupGain: GainNode;
  volumeGain: GainNode;
  /** Gate envelope state (preview approximation of ffmpeg agate). */
  gateOpen: boolean;
  gateHoldUntil: number;
  gateRaf: number;
  gateParams: SegmentTrackGate | null;
};

type TakeEntry = {
  el: HTMLAudioElement;
  fx: TakeFxGraph | null;
};

function dbToLinearGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

function linearToDbSafe(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return -100;
  return 20 * Math.log10(linear);
}

export class ClipPreviewEngine {
  private opts: ClipPreviewEngineOpts;
  private takes = new Map<string, TakeEntry>();
  /** Take basename -> clip uiId currently driving that element. */
  private activeClipByTake = new Map<string, string>();
  private playing = false;
  private playheadMs = 0;
  private playbackRate = 1;
  private raf = 0;
  private lastTickPerf = 0;
  private disposed = false;
  private audioCtx: AudioContext | null = null;
  /** Avoid spamming probes/toasts when many takes fail at once (e.g. rate limit). */
  private lastTakeLoadErrorAt = 0;

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
    for (const entry of this.takes.values()) {
      entry.el.playbackRate = next;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    for (const entry of this.takes.values()) {
      this.teardownFx(entry);
      entry.el.pause();
      entry.el.removeAttribute('src');
      entry.el.load();
    }
    this.takes.clear();
    this.activeClipByTake.clear();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
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
    void this.resumeAudioCtx();
    this.preloadTakes(this.opts.getClips());
    this.syncTakes({ forceSeek: true, allowPlay: true });
    this.startRaf();
  }

  pause(): void {
    this.playing = false;
    this.opts.onPlayingChange(false);
    this.stopRaf();
    for (const entry of this.takes.values()) {
      if (!entry.el.paused) entry.el.pause();
      this.stopGateRaf(entry);
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

  private ensureAudioCtx(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx;
    const Ctx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return null;
    this.audioCtx = new Ctx();
    return this.audioCtx;
  }

  private async resumeAudioCtx(): Promise<void> {
    const ctx = this.ensureAudioCtx();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // ignore
      }
    }
  }

  private teardownFx(entry: TakeEntry): void {
    this.stopGateRaf(entry);
    if (!entry.fx) return;
    try {
      entry.fx.source.disconnect();
      entry.fx.gateGain.disconnect();
      entry.fx.analyser.disconnect();
      entry.fx.lowShelf.disconnect();
      entry.fx.peaking.disconnect();
      entry.fx.highShelf.disconnect();
      entry.fx.compressor.disconnect();
      entry.fx.makeupGain.disconnect();
      entry.fx.volumeGain.disconnect();
    } catch {
      // already disconnected
    }
    entry.fx = null;
  }

  private stopGateRaf(entry: TakeEntry): void {
    if (entry.fx?.gateRaf) {
      cancelAnimationFrame(entry.fx.gateRaf);
      entry.fx.gateRaf = 0;
    }
  }

  private ensureFx(entry: TakeEntry): TakeFxGraph | null {
    if (entry.fx) return entry.fx;
    const ctx = this.ensureAudioCtx();
    if (!ctx) return null;
    try {
      const source = ctx.createMediaElementSource(entry.el);
      const gateGain = ctx.createGain();
      gateGain.gain.value = 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      const lowShelf = ctx.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = EQ_LOW_HZ;
      const peaking = ctx.createBiquadFilter();
      peaking.type = 'peaking';
      peaking.frequency.value = EQ_MID_HZ;
      peaking.Q.value = EQ_MID_Q;
      const highShelf = ctx.createBiquadFilter();
      highShelf.type = 'highshelf';
      highShelf.frequency.value = EQ_HIGH_HZ;
      const compressor = ctx.createDynamicsCompressor();
      const makeupGain = ctx.createGain();
      makeupGain.gain.value = 1;
      const volumeGain = ctx.createGain();
      volumeGain.gain.value = 1;

      // Parallel tap for level metering; main chain carries audio.
      source.connect(analyser);
      source.connect(gateGain);
      gateGain.connect(lowShelf);
      lowShelf.connect(peaking);
      peaking.connect(highShelf);
      highShelf.connect(compressor);
      compressor.connect(makeupGain);
      makeupGain.connect(volumeGain);
      volumeGain.connect(ctx.destination);

      entry.fx = {
        source,
        gateGain,
        analyser,
        lowShelf,
        peaking,
        highShelf,
        compressor,
        makeupGain,
        volumeGain,
        gateOpen: true,
        gateHoldUntil: 0,
        gateRaf: 0,
        gateParams: null,
      };
      // MediaElementSource owns output; keep element volume at unity.
      entry.el.volume = 1;
      return entry.fx;
    } catch (err) {
      this.opts.onError?.(
        err instanceof Error
          ? err.message
          : 'Could not create track audio preview graph',
      );
      return null;
    }
  }

  private applyFxParams(fx: TakeFxGraph, state: ActiveTakeState): void {
    const eq = eqBandsToUi(state.eqBands);
    fx.lowShelf.gain.value = eq.lowDb;
    fx.peaking.gain.value = eq.midDb;
    fx.highShelf.gain.value = eq.highDb;

    const comp = state.comp;
    if (comp) {
      fx.compressor.threshold.value = linearToDbSafe(comp.threshold);
      fx.compressor.ratio.value = Math.min(20, Math.max(1, comp.ratio));
      fx.compressor.attack.value = Math.min(1, Math.max(0, comp.attackMs / 1000));
      fx.compressor.release.value = Math.min(
        1,
        Math.max(0, comp.releaseMs / 1000),
      );
      fx.compressor.knee.value = Math.min(40, Math.max(0, comp.kneeDb ?? 2.828));
      fx.makeupGain.gain.value = dbToLinearGain(comp.makeupDb ?? 0);
    } else {
      // Bypass-ish: high threshold, 1:1 ratio
      fx.compressor.threshold.value = 0;
      fx.compressor.ratio.value = 1;
      fx.compressor.knee.value = 0;
      fx.compressor.attack.value = 0.003;
      fx.compressor.release.value = 0.25;
      fx.makeupGain.gain.value = 1;
    }

    fx.volumeGain.gain.value = Math.max(0, state.volume);

    if (state.gate) {
      fx.gateParams = state.gate;
      this.startGateFollower(fx);
    } else {
      fx.gateParams = null;
      this.stopGateFollower(fx);
      fx.gateGain.gain.value = 1;
    }
  }

  private stopGateFollower(fx: TakeFxGraph): void {
    if (fx.gateRaf) {
      cancelAnimationFrame(fx.gateRaf);
      fx.gateRaf = 0;
    }
    fx.gateOpen = true;
    fx.gateHoldUntil = 0;
  }

  private startGateFollower(fx: TakeFxGraph): void {
    if (fx.gateRaf) return;
    const data = new Float32Array(fx.analyser.fftSize);

    const tick = () => {
      if (this.disposed || !this.playing || !fx.gateParams) {
        fx.gateRaf = 0;
        return;
      }
      const gate = fx.gateParams;
      const thresholdDb = linearToDbSafe(gate.threshold);
      const attackSec = Math.max(0.0005, gate.attackMs / 1000);
      const releaseSec = Math.max(0.001, gate.releaseMs / 1000);
      const holdMs = Math.max(0, gate.holdMs ?? 0);
      const closedGain = Math.max(0, Math.min(1, gate.range ?? 0));

      fx.analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]!);
        if (v > peak) peak = v;
      }
      const levelDb = linearToDbSafe(peak);
      const now = performance.now();
      const above = levelDb >= thresholdDb;

      if (above) {
        fx.gateOpen = true;
        fx.gateHoldUntil = now + holdMs;
        const t = fx.gateGain.context.currentTime;
        fx.gateGain.gain.cancelScheduledValues(t);
        fx.gateGain.gain.setTargetAtTime(1, t, attackSec / 3);
      } else if (fx.gateOpen && now < fx.gateHoldUntil) {
        // hold open
      } else if (fx.gateOpen) {
        fx.gateOpen = false;
        const t = fx.gateGain.context.currentTime;
        fx.gateGain.gain.cancelScheduledValues(t);
        fx.gateGain.gain.setTargetAtTime(closedGain, t, releaseSec / 3);
      }

      fx.gateRaf = requestAnimationFrame(tick);
    };
    fx.gateRaf = requestAnimationFrame(tick);
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

  private ensureTake(filePath: string): TakeEntry {
    const key = takeBasename(filePath);
    let entry = this.takes.get(key);
    if (entry) return entry;
    const el = new Audio();
    el.preload = 'auto';
    // Same-origin / proxied /api: cookies send without CORS crossOrigin.
    el.src = takeStreamUrl(
      this.opts.episodeId,
      this.opts.segmentId,
      key,
    );
    el.playbackRate = this.playbackRate;
    el.addEventListener('error', () => {
      void this.reportTakeLoadError(key, el.src);
    });
    entry = { el, fx: null };
    this.takes.set(key, entry);
    return entry;
  }

  /** Classify media load failures (429 vs missing) so scrubbing rate limits are not shown as "not found". */
  private async reportTakeLoadError(key: string, url: string): Promise<void> {
    if (this.disposed) return;
    const now = Date.now();
    if (now - this.lastTakeLoadErrorAt < 2500) return;
    this.lastTakeLoadErrorAt = now;

    let message = `Could not load take audio: ${key}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
      });
      if (this.disposed) return;
      if (res.status === 429) {
        message = 'Too many audio requests. Wait a moment, then try again.';
      } else if (res.status === 404) {
        message = `Take audio not found: ${key}`;
      } else if (!res.ok) {
        message = `Could not load take audio (${res.status}): ${key}`;
      }
    } catch {
      /* keep default */
    }
    this.opts.onError?.(message);
  }

  private syncTakes(opts: { forceSeek: boolean; allowPlay: boolean }): void {
    const tMs = this.playheadMs;
    const tSec = tMs / 1000;
    const trims = this.opts.getTrimRanges();
    if (isInTrim(tSec, trims)) {
      for (const entry of this.takes.values()) {
        if (!entry.el.paused) entry.el.pause();
        this.stopGateRaf(entry);
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
          ? Math.max(0, clip.volume)
          : 1;
      const prev = activeByTake.get(key);
      if (!prev || volume >= prev.volume) {
        activeByTake.set(key, {
          clipUiId: clip.uiId,
          sourceSec,
          volume,
          eqBands: clip.eqBands,
          gate: clip.gate,
          comp: clip.comp,
        });
      }
    }

    const needed = new Set(activeByTake.keys());
    for (const [key, entry] of this.takes) {
      if (!needed.has(key)) {
        if (!entry.el.paused) entry.el.pause();
        this.stopGateRaf(entry);
        this.activeClipByTake.delete(key);
      }
    }

    for (const [key, state] of activeByTake) {
      const entry = this.ensureTake(key);
      const el = entry.el;
      if (el.playbackRate !== this.playbackRate) el.playbackRate = this.playbackRate;

      const fx = this.ensureFx(entry);
      if (fx) {
        this.applyFxParams(fx, state);
      } else {
        // Fallback without Web Audio (rare): clamp element volume to 0..1
        el.volume = Math.max(0, Math.min(1, state.volume));
      }

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
        this.stopGateRaf(entry);
      }
    }
  }
}

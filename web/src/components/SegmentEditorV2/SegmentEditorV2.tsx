import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X,
  Scissors,
  Trash2,
  Save,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  RefreshCw,
  Headphones,
  SlidersHorizontal,
  Plus,
  MousePointer2,
  Split,
  ArrowLeftToLine,
  ArrowRightToLine,
  Undo2,
  Redo2,
  CircleAlert,
  MapPin,
  Settings,
} from 'lucide-react';
import type { Marker } from '@harborfm/shared';
import type { EpisodeSegment } from '../../api/segments';
import {
  addSegmentTrackMedia,
  getSegmentTracks,
  saveSegmentTracks,
  startRemakeSegmentTracks,
  getSegmentTracksApplyStatus,
  takeWaveformUrl,
  fetchSegmentWaveformsBulk,
  updateSegment,
} from '../../api/segments';
import { pollUntil } from '../../utils/projectZipTransfer';
import { setSegmentEditorMode } from '../../utils/segmentEditorMode';
import { WaveformCanvas, type WaveformData } from '../../pages/EpisodeEditor/WaveformCanvas';
import { formatDuration } from '../../pages/EpisodeEditor/utils';
import { mergeTrimRanges } from '../SegmentModal/utils/transcriptTrimUtils';
import {
  bladeSplitClip,
  clipEndMs,
  clipLengthMs,
  clipStartMs,
  editorLaneKey,
  laneIsHostLane,
  groupClipsByLane,
  resizeClipOnLane,
  slideClipOnLane,
  sourceOffsetMsOf,
  timelineDurationMs,
  toApiClips,
  toEditorClips,
  type EditorClip,
} from './clipOps';
import { ClipPreviewEngine } from './clipPreviewEngine';
import { ClipWaveform } from './ClipWaveform';
import { AddTrackDialog } from './AddTrackDialog';
import { MarkerEditDialog, MARKER_COLORS } from './MarkerEditDialog';
import { TrackSettingsDialog } from './TrackSettingsDialog';
import {
  applyTrackSettingsToClip,
  applyTrackSettingsToLane,
  buildLaneFxDefaults,
  clipToTrackSettings,
  readLaneTrackSettings,
  resetClipFxToTrackSettings,
  type TrackSettingsUi,
} from './trackFx';
import {
  collectClipPeaks,
  collectLanePeaks,
  MIN_AUTO_PEAKS,
} from './trackFxAnalyze';
import {
  cloneEditorSnapshot,
  createEditorHistory,
  type EditorHistorySnapshot,
} from './editorHistory';
import { UnsavedChangesConfirmDialog } from '../UnsavedChangesConfirmDialog';
import { useDialogCloseGuard } from '../../hooks/useDialogCloseGuard';
import styles from '../../pages/EpisodeEditor.module.css';

function markersEqual(a: Marker[], b: Marker[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (m, i) =>
        m.time === b[i]!.time &&
        (m.title ?? '') === (b[i]!.title ?? '') &&
        (m.color ?? '') === (b[i]!.color ?? '') &&
        (m.markerType ?? '') === (b[i]!.markerType ?? '') &&
        (m.duration ?? null) === (b[i]!.duration ?? null),
    )
  );
}

function sortMarkers(list: Marker[]): Marker[] {
  return [...list].sort((a, b) => a.time - b.time);
}

export type AdvancedTool = 'select' | 'blade';

export interface SegmentEditorV2Props {
  episodeId: string;
  segment: EpisodeSegment;
  segmentId: string;
  segmentName: string;
  segmentWaveformData?: WaveformData | null;
  onClose: () => void;
  onSwitchToSimple: () => void;
  readOnly?: boolean;
}

const DEFAULT_VIEW_MS = 60_000;
const MIN_VIEW_MS = 2_000;
const LABEL_COL_PX = 168;
/** Preview playback speeds (toolbar + E cycles through these). */
const PREVIEW_RATES = [1, 1.5, 2] as const;
type PreviewRate = (typeof PREVIEW_RATES)[number];

/** Nice ruler intervals (ms), coarsest last. */
const RULER_STEPS_MS = [
  100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000,
  300_000, 600_000, 900_000, 1_800_000, 3_600_000,
] as const;

function formatTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const sec = Math.floor(r);
  const tenths = Math.floor((r - sec) * 10);
  return `${m}:${String(sec).padStart(2, '0')}.${tenths}`;
}

/** Compact labels once ticks are whole seconds / minutes. */
function formatRulerTime(ms: number, stepMs: number): string {
  const totalSec = Math.max(0, ms) / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = Math.floor(totalSec % 60);
  if (stepMs >= 60_000) {
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:00`;
    return `${m}:00`;
  }
  if (stepMs >= 1_000) {
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
  return formatTime(ms);
}

function pickRulerStepMs(viewWindowMs: number, widthPx: number): number {
  const targetPx = 96;
  const ideal = (viewWindowMs * targetPx) / Math.max(1, widthPx);
  for (const step of RULER_STEPS_MS) {
    if (step >= ideal) return step;
  }
  return RULER_STEPS_MS[RULER_STEPS_MS.length - 1]!;
}

function fetchTakeWaveform(
  episodeId: string,
  segmentId: string,
  filePath: string,
): Promise<WaveformData | null> {
  return fetch(takeWaveformUrl(episodeId, segmentId, filePath), {
    credentials: 'include',
  }).then(async (r) => {
    if (!r.ok) return null;
    return (await r.json()) as WaveformData;
  });
}

export function SegmentEditorV2({
  episodeId,
  segment,
  segmentId,
  segmentName,
  segmentWaveformData,
  onClose,
  onSwitchToSimple,
  readOnly = false,
}: SegmentEditorV2Props) {
  const queryClient = useQueryClient();
  const tracksColRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<ClipPreviewEngine | null>(null);
  const scrubbingRef = useRef(false);
  const scrubResumeRef = useRef(false);
  const panningRef = useRef<{
    startX: number;
    startViewMs: number;
    /** Ruler left-drag: click without move still seeks. */
    fromRuler?: boolean;
    moved?: boolean;
  } | null>(null);
  /** When false, do not auto-scroll the view to keep the playhead on screen
   * (user has panned away). Re-enabled on seek / scrub / play. */
  const followPlayheadRef = useRef(true);
  const clipsRef = useRef<EditorClip[]>([]);
  const durationMsRef = useRef(1000);
  const laneSoloRef = useRef<Record<string, boolean>>({});
  /** Throttle playhead React updates while playing (engine still ticks at rAF). */
  const playheadUiAtRef = useRef(0);
  const playheadPendingRef = useRef<number | null>(null);
  const playheadFlushTimerRef = useRef(0);
  const historyRef = useRef(createEditorHistory());
  const selectedIdRef = useRef<string | null>(null);
  const rippleStartSecRef = useRef<number | null>(null);
  /** Skip the trailing click after a horizontal clip slide. */
  const suppressClipClickRef = useRef(false);
  const viewWindowMsRef = useRef(DEFAULT_VIEW_MS);

  const [clips, setClips] = useState<EditorClip[]>([]);
  const [baseline, setBaseline] = useState<string>('');
  const [trimRanges, setTrimRanges] = useState<Array<[number, number]>>(
    () => mergeTrimRanges(segment.trimRanges ?? []),
  );
  const [trimsBaseline, setTrimsBaseline] = useState(() =>
    JSON.stringify(mergeTrimRanges(segment.trimRanges ?? [])),
  );
  const [markers, setMarkers] = useState<Marker[]>(() =>
    sortMarkers(segment.markers ?? []),
  );
  const [markersBaseline, setMarkersBaseline] = useState<Marker[]>(() =>
    sortMarkers(segment.markers ?? []),
  );
  const [editMarkerIndex, setEditMarkerIndex] = useState<number | null>(null);
  /** Pending soft-trim / ripple start (seconds), null when unset. */
  const [rippleStartSec, setRippleStartSec] = useState<number | null>(null);
  /** Bumps when undo/redo stack changes so toolbar disabled state updates. */
  const [historyTick, setHistoryTick] = useState(0);
  const [tool, setTool] = useState<AdvancedTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<PreviewRate>(1);
  const playbackRateRef = useRef<PreviewRate>(1);
  playbackRateRef.current = playbackRate;
  const [laneSolo, setLaneSolo] = useState<Record<string, boolean>>({});
  const [renamingLaneKey, setRenamingLaneKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameOriginalRef = useRef('');
  const [addTrackOpen, setAddTrackOpen] = useState(false);
  const [addingTrack, setAddingTrack] = useState(false);
  const [trackSettingsLaneKey, setTrackSettingsLaneKey] = useState<string | null>(
    null,
  );
  const [clipSettingsUiId, setClipSettingsUiId] = useState<string | null>(null);
  /** Per-lane track FX; clip overrides do not update these. */
  const [laneFxDefaults, setLaneFxDefaults] = useState<
    Record<string, TrackSettingsUi>
  >({});
  const laneFxDefaultsRef = useRef(laneFxDefaults);
  laneFxDefaultsRef.current = laneFxDefaults;
  const [viewStartMs, setViewStartMs] = useState(0);
  const [viewWindowMs, setViewWindowMs] = useState(DEFAULT_VIEW_MS);
  const [tracksColWidth, setTracksColWidth] = useState(800);
  const [error, setErrorState] = useState<string | null>(null);
  const [errorToken, setErrorToken] = useState(0);
  const [errorFading, setErrorFading] = useState(false);
  const setError = useCallback((message: string | null) => {
    if (message == null) {
      setErrorState(null);
      setErrorFading(false);
      return;
    }
    setErrorFading(false);
    setErrorState(message);
    setErrorToken((t) => t + 1);
  }, []);
  const [saving, setSaving] = useState(false);
  const [remaking, setRemaking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [waveforms, setWaveforms] = useState<Record<string, WaveformData | null>>({});
  const [mixWaveform, setMixWaveform] = useState<WaveformData | null>(
    segmentWaveformData ?? null,
  );
  const trimRangesRef = useRef(trimRanges);
  trimRangesRef.current = trimRanges;
  const markersRef = useRef(markers);
  markersRef.current = markers;
  clipsRef.current = clips;
  laneSoloRef.current = laneSolo;
  selectedIdRef.current = selectedId;
  rippleStartSecRef.current = rippleStartSec;

  const { data, isLoading, isError, error: queryError, refetch } = useQuery({
    queryKey: ['segment-tracks', episodeId, segmentId],
    queryFn: () => getSegmentTracks(episodeId, segmentId),
    retry: false,
  });

  const currentHistorySnapshot = useCallback((): EditorHistorySnapshot => {
    return cloneEditorSnapshot({
      clips: clipsRef.current,
      trimRanges: trimRangesRef.current,
      markers: markersRef.current,
      selectedId: selectedIdRef.current,
      rippleStartSec: rippleStartSecRef.current,
      laneFxDefaults: laneFxDefaultsRef.current,
    });
  }, []);

  const pushHistory = useCallback(() => {
    historyRef.current.push(currentHistorySnapshot());
    setHistoryTick((t) => t + 1);
  }, [currentHistorySnapshot]);

  const applyHistorySnapshot = useCallback((snap: EditorHistorySnapshot) => {
    setClips(snap.clips);
    setTrimRanges(snap.trimRanges);
    setMarkers(snap.markers);
    setSelectedId(snap.selectedId);
    setRippleStartSec(snap.rippleStartSec);
    setLaneFxDefaults(snap.laneFxDefaults ?? {});
    setEditMarkerIndex(null);
    setError(null);
  }, [setError]);

  const handleUndo = useCallback(() => {
    if (readOnly) return;
    const prev = historyRef.current.undo(currentHistorySnapshot());
    if (!prev) return;
    applyHistorySnapshot(prev);
    setHistoryTick((t) => t + 1);
  }, [readOnly, currentHistorySnapshot, applyHistorySnapshot]);

  const handleRedo = useCallback(() => {
    if (readOnly) return;
    const next = historyRef.current.redo(currentHistorySnapshot());
    if (!next) return;
    applyHistorySnapshot(next);
    setHistoryTick((t) => t + 1);
  }, [readOnly, currentHistorySnapshot, applyHistorySnapshot]);

  const canUndo = historyTick >= 0 && historyRef.current.canUndo();
  const canRedo = historyTick >= 0 && historyRef.current.canRedo();

  useEffect(() => {
    if (!data) return;
    const next = toEditorClips(data.clips);
    setClips(next);
    setLaneFxDefaults(buildLaneFxDefaults(next));
    setBaseline(JSON.stringify(toApiClips(next)));
    setLoadError(null);
    historyRef.current.clear();
    setHistoryTick((t) => t + 1);
    const total = Math.max(
      timelineDurationMs(next),
      data.timelineDurationMs ?? 0,
      Math.round((segment.durationSec ?? 0) * 1000),
      1000,
    );
    setViewStartMs(0);
    setViewWindowMs(Math.min(DEFAULT_VIEW_MS, total));
  }, [data, segment.durationSec]);

  useEffect(() => {
    if (isError) {
      setLoadError(
        queryError instanceof Error
          ? queryError.message
          : 'Failed to load multitrack clips',
      );
    }
  }, [isError, queryError]);

  useEffect(() => {
    const el = tracksColRef.current;
    if (!el) return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setTracksColWidth(Math.round(w));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  // Mix waveform for the transport (reuse batched prop when present).
  useEffect(() => {
    if (segmentWaveformData?.data?.length) {
      setMixWaveform(segmentWaveformData);
      return;
    }
    const dur = segment.durationSec ?? 0;
    if (!segment.waveformExists || dur <= 0) {
      setMixWaveform(null);
      return;
    }
    let cancelled = false;
    void fetchSegmentWaveformsBulk(episodeId, [segmentId])
      .then(({ waveforms: map }) => {
        if (cancelled) return;
        const wf = map[segmentId];
        setMixWaveform(wf?.data?.length ? (wf as WaveformData) : null);
      })
      .catch(() => {
        if (!cancelled) setMixWaveform(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    episodeId,
    segmentId,
    segment.waveformExists,
    segment.durationSec,
    segmentWaveformData,
  ]);

  const trackTakeFilesKey = useMemo(() => {
    const files = new Set<string>();
    for (const t of data?.takes ?? []) {
      const base = t.filePath.replace(/\\/g, '/').split('/').pop() || t.filePath;
      if (base) files.add(base);
    }
    for (const c of clips) {
      const base = c.filePath.replace(/\\/g, '/').split('/').pop() || c.filePath;
      if (base) files.add(base);
    }
    return [...files].sort().join('\0');
  }, [data?.takes, clips]);

  // Load take waveforms for every clip file (generate on server if missing).
  useEffect(() => {
    const files = trackTakeFilesKey ? trackTakeFilesKey.split('\0') : [];
    if (files.length === 0) return;
    let cancelled = false;
    void Promise.all(
      files.map(async (filePath) => {
        const wf = await fetchTakeWaveform(episodeId, segmentId, filePath);
        if (!wf?.data?.length) return [filePath, null] as const;
        return [filePath, wf] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, WaveformData | null> = {};
      for (const [path, wf] of entries) {
        map[path] = wf;
        const base = path.replace(/\\/g, '/').split('/').pop() || path;
        if (base !== path) map[base] = wf;
      }
      setWaveforms((prev) => ({ ...prev, ...map }));
    });
    return () => {
      cancelled = true;
    };
  }, [trackTakeFilesKey, episodeId, segmentId]);

  const clipsDirty = useMemo(
    () => JSON.stringify(toApiClips(clips)) !== baseline,
    [clips, baseline],
  );
  const trimsDirty = useMemo(
    () => JSON.stringify(mergeTrimRanges(trimRanges)) !== trimsBaseline,
    [trimRanges, trimsBaseline],
  );
  const markersDirty = useMemo(
    () => !markersEqual(markers, markersBaseline),
    [markers, markersBaseline],
  );
  const dirty = clipsDirty || trimsDirty || markersDirty;

  const mixDurationSec = Math.max(0.01, segment.durationSec ?? 0);
  const mixDurationMs = Math.max(1000, Math.round(mixDurationSec * 1000));
  /** Clip layout may extend slightly past the remade mix; lanes use the longer span. */
  const durationMs = Math.max(
    timelineDurationMs(clips),
    data?.timelineDurationMs ?? 0,
    mixDurationMs,
    1000,
  );
  durationMsRef.current = durationMs;

  /** Jump playhead out of a soft-trim range (same rule as simple editor). */
  const skipOutOfTrimMs = useCallback((ms: number) => {
    const sec = ms / 1000;
    for (const [start, end] of trimRangesRef.current) {
      if (sec >= start && sec < end) return end * 1000;
    }
    return ms;
  }, []);

  useEffect(() => {
    const next = mergeTrimRanges(segment.trimRanges ?? []);
    setTrimRanges(next);
    setTrimsBaseline(JSON.stringify(next));
    setRippleStartSec(null);
  }, [segment.id, segment.trimRanges]);

  useEffect(() => {
    const next = sortMarkers(segment.markers ?? []);
    setMarkers(next);
    setMarkersBaseline(next.map((m) => ({ ...m })));
    setEditMarkerIndex(null);
  }, [segment.id, segment.markers]);

  // Clip-faithful preview: schedule take streams from the visible clip layout.
  useEffect(() => {
    const flushPlayheadUi = (ms: number) => {
      if (scrubbingRef.current) return;
      playheadUiAtRef.current = performance.now();
      playheadPendingRef.current = null;
      setPlayheadMs(ms);
    };
    const engine = new ClipPreviewEngine({
      episodeId,
      segmentId,
      getClips: () => {
        const list = clipsRef.current;
        const soloActive = Object.values(laneSoloRef.current).some(Boolean);
        if (!soloActive) return list;
        return list.map((c) => {
          const key = editorLaneKey(c);
          if (laneSoloRef.current[key]) return c;
          return { ...c, muted: true };
        });
      },
      getTrimRanges: () => trimRangesRef.current,
      getDurationMs: () => durationMsRef.current,
      onPlayheadMs: (ms) => {
        if (scrubbingRef.current) return;
        // Keep UI at ~15fps while playing so the full editor does not re-render
        // every animation frame (that was a major source of choppy audio).
        const now = performance.now();
        if (now - playheadUiAtRef.current >= 66) {
          flushPlayheadUi(ms);
          return;
        }
        playheadPendingRef.current = ms;
        if (!playheadFlushTimerRef.current) {
          playheadFlushTimerRef.current = window.setTimeout(() => {
            playheadFlushTimerRef.current = 0;
            const pending = playheadPendingRef.current;
            if (pending != null) flushPlayheadUi(pending);
          }, 66);
        }
      },
      onPlayingChange: setIsPlaying,
      onError: (message) => setError(message),
    });
    engine.setPlaybackRate(playbackRateRef.current);
    previewRef.current = engine;
    return () => {
      if (playheadFlushTimerRef.current) {
        window.clearTimeout(playheadFlushTimerRef.current);
        playheadFlushTimerRef.current = 0;
      }
      engine.dispose();
      if (previewRef.current === engine) previewRef.current = null;
    };
  }, [episodeId, segmentId, setError]);

  useEffect(() => {
    previewRef.current?.resync();
  }, [clips, trimRanges, durationMs, laneSolo]);

  // Transient action errors: fade out, then clear after 5s.
  useEffect(() => {
    if (!error) {
      setErrorFading(false);
      return;
    }
    setErrorFading(false);
    const fadeTimer = window.setTimeout(() => setErrorFading(true), 4500);
    const clearTimer = window.setTimeout(() => {
      setErrorState(null);
      setErrorFading(false);
    }, 5000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [error, errorToken]);

  const viewEndMs = Math.min(durationMs, viewStartMs + viewWindowMs);
  /** Actual visible span (matches simple editor TimelineWaveform). Never use
   * viewWindowMs alone when the window is clamped by duration. */
  const visibleWindowMs = Math.max(1, viewEndMs - viewStartMs);
  viewWindowMsRef.current = visibleWindowMs;

  const clampViewStart = useCallback(
    (next: number) => {
      const maxStart = Math.max(0, durationMs - viewWindowMs);
      return Math.max(0, Math.min(next, maxStart));
    },
    [durationMs, viewWindowMs],
  );

  // Keep playhead in view when it drifts outside, and during playback pan once
  // it crosses the right 90% of the view (same rule as the simple editor).
  // Skipped when the user has panned/scrolled away on purpose.
  useEffect(() => {
    if (scrubbingRef.current || panningRef.current || !followPlayheadRef.current) {
      return;
    }
    const win = visibleWindowMs;
    if (win <= 1) return;

    if (playheadMs < viewStartMs) {
      const next = clampViewStart(playheadMs - win * 0.1);
      if (Math.abs(next - viewStartMs) >= 1) setViewStartMs(next);
      return;
    }

    const pastRightEdge = playheadMs > viewEndMs;
    const nearRightEdge = isPlaying && playheadMs >= viewStartMs + 0.9 * win;
    if (!pastRightEdge && !nearRightEdge) return;

    const next = clampViewStart(playheadMs - win * 0.1);
    if (Math.abs(next - viewStartMs) < 1) return;
    setViewStartMs(next);
  }, [
    playheadMs,
    viewStartMs,
    viewEndMs,
    visibleWindowMs,
    isPlaying,
    clampViewStart,
  ]);

  const lanes = useMemo(() => {
    const grouped = groupClipsByLane(clips);
    const takeMeta = new Map(
      (data?.takes ?? []).map((t) => [t.filePath, t] as const),
    );
    const built = [...grouped.entries()].map(([laneKey, laneClips]) => {
      const fromClip = laneClips[0];
      const meta = fromClip
        ? takeMeta.get(
            fromClip.filePath.replace(/\\/g, '/').split('/').pop() ||
              fromClip.filePath,
          )
        : undefined;
      const participant =
        meta?.participantName?.trim() ||
        (typeof fromClip?.participantName === 'string'
          ? fromClip.participantName.trim()
          : '') ||
        '';
      const isSoundboard =
        meta?.source === 'soundboard' || fromClip?.source === 'soundboard';
      // Named call hosts (and take-meta names) stay above imports / soundboard.
      // Basename-only labels and source import/library do not count as hosts.
      const isHost = laneIsHostLane(laneKey, laneClips, {
        participantLabel: participant,
        isSoundboard,
      });
      // Prefer a single "Soundboard" lane label; keep a custom rename if the user set one.
      const label = isSoundboard
        ? participant && !/^soundboard(\s*:|$)/i.test(participant)
          ? participant
          : 'Soundboard'
        : participant ||
          (fromClip
            ? fromClip.filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') ||
              fromClip.filePath
            : laneKey);
      return {
        laneKey,
        label,
        clips: laneClips,
        isHost,
        earliestMs: clipStartMs(laneClips[0]!),
      };
    });
    // Call hosts first A–Z, then soundboard / other A–Z.
    built.sort((a, b) => {
      if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
      const byLabel = a.label.localeCompare(b.label, undefined, {
        sensitivity: 'base',
      });
      if (byLabel !== 0) return byLabel;
      return a.earliestMs - b.earliestMs || a.laneKey.localeCompare(b.laneKey);
    });
    return built.map(({ laneKey, label, clips: laneClips }) => ({
      laneKey,
      label,
      clips: laneClips,
    }));
  }, [clips, data?.takes]);

  const selected = clips.find((c) => c.uiId === selectedId) ?? null;

  const seekAudio = useCallback((ms: number) => {
    followPlayheadRef.current = true;
    const skipped = skipOutOfTrimMs(ms);
    setPlayheadMs(skipped);
    const engine = previewRef.current;
    if (engine) {
      engine.setPlayheadMs(skipped, { resumeIfPlaying: engine.isPlaying });
    }
  }, [skipOutOfTrimMs]);

  const handleSeekSec = useCallback(
    (timeSec: number) => {
      seekAudio(Math.max(0, timeSec * 1000));
    },
    [seekAudio],
  );

  const handleMixScrubStart = useCallback(() => {
    // Pause while scrubbing the full-mix waveform, but do not set scrubbingRef:
    // that flag also freezes timeline view-follow, and the mix strip is the full
    // duration while lanes are zoomed, so the view must pan with the playhead.
    scrubResumeRef.current = previewRef.current?.isPlaying ?? false;
    if (scrubResumeRef.current) previewRef.current?.pause();
  }, []);

  const handleMixScrubEnd = useCallback(() => {
    const resume = scrubResumeRef.current;
    scrubResumeRef.current = false;
    if (resume) {
      const engine = previewRef.current;
      if (engine) {
        followPlayheadRef.current = true;
        engine.setPlayheadMs(engine.getPlayheadMs());
        engine.play();
      }
    }
  }, []);

  const cyclePlaybackRate = useCallback(() => {
    setPlaybackRate((prev) => {
      const idx = PREVIEW_RATES.indexOf(prev);
      const next = PREVIEW_RATES[(idx + 1) % PREVIEW_RATES.length]!;
      previewRef.current?.setPlaybackRate(next);
      return next;
    });
  }, []);

  const togglePlay = useCallback(() => {
    const engine = previewRef.current;
    if (!engine) return;
    if (engine.isPlaying) {
      engine.pause();
      return;
    }
    followPlayheadRef.current = true;
    engine.setPlayheadMs(playheadMs);
    engine.play();
  }, [playheadMs]);

  const clientXToMs = useCallback(
    (clientX: number) => {
      const el = tracksColRef.current;
      if (!el) return playheadMs;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return viewStartMs + ratio * visibleWindowMs;
    },
    [playheadMs, viewStartMs, visibleWindowMs],
  );

  const beginScrub = useCallback(
    (clientX: number) => {
      followPlayheadRef.current = true;
      scrubResumeRef.current = previewRef.current?.isPlaying ?? false;
      if (scrubResumeRef.current) previewRef.current?.pause();
      scrubbingRef.current = true;
      const ms = skipOutOfTrimMs(clientXToMs(clientX));
      setPlayheadMs(ms);
      previewRef.current?.setPlayheadMs(ms);
    },
    [clientXToMs, skipOutOfTrimMs],
  );

  const applyPanDeltaPx = useCallback(
    (dxPx: number, baseViewMs: number, widthPx: number) => {
      const width = Math.max(1, widthPx);
      // Drag right → earlier time (hand tool).
      const deltaMs = (-dxPx / width) * viewWindowMs;
      setViewStartMs(clampViewStart(baseViewMs + deltaMs));
    },
    [viewWindowMs, clampViewStart],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pan = panningRef.current;
      if (pan) {
        const dx = e.clientX - pan.startX;
        if (Math.abs(dx) > 3) {
          pan.moved = true;
          // User is navigating away; stop auto-centering on the playhead.
          followPlayheadRef.current = false;
        }
        const el = tracksColRef.current;
        const width = el?.getBoundingClientRect().width || 1;
        applyPanDeltaPx(dx, pan.startViewMs, width);
        return;
      }
      if (!scrubbingRef.current) return;
      const ms = skipOutOfTrimMs(clientXToMs(e.clientX));
      setPlayheadMs(ms);
      previewRef.current?.setPlayheadMs(ms);
    };
    const onUp = () => {
      const pan = panningRef.current;
      const resume = scrubResumeRef.current;
      scrubResumeRef.current = false;
      scrubbingRef.current = false;
      if (pan?.moved) {
        followPlayheadRef.current = false;
      }
      panningRef.current = null;
      document.body.style.removeProperty('cursor');
      // Ruler click (no drag): seek playhead like before.
      if (pan?.fromRuler && !pan.moved) {
        followPlayheadRef.current = true;
        const ms = skipOutOfTrimMs(clientXToMs(pan.startX));
        setPlayheadMs(ms);
        previewRef.current?.setPlayheadMs(ms, {
          resumeIfPlaying: previewRef.current.isPlaying,
        });
        return;
      }
      if (resume) {
        const engine = previewRef.current;
        if (engine) {
          followPlayheadRef.current = true;
          engine.setPlayheadMs(engine.getPlayheadMs());
          engine.play();
        }
      }
    };
    // Block browser autoscroll / middle-click paste while over the timeline.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const wrap = (e.target as HTMLElement | null)?.closest?.(
        `.${styles.segmentEditorV2TimelineWrap}`,
      );
      if (!wrap) return;
      e.preventDefault();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('mousedown', onMouseDown, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [clientXToMs, applyPanDeltaPx, skipOutOfTrimMs]);

  const beginRulerPan = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      document.body.style.cursor = 'grabbing';
      panningRef.current = {
        startX: e.clientX,
        startViewMs: viewStartMs,
        fromRuler: e.button === 0,
        moved: false,
      };
    },
    [viewStartMs],
  );

  const handleTimelinePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    document.body.style.cursor = 'grabbing';
    panningRef.current = { startX: e.clientX, startViewMs: viewStartMs };
  };

  const zoomBy = (factor: number, anchorMs?: number) => {
    const anchor = anchorMs ?? playheadMs;
    const nextWindow = Math.min(
      durationMs,
      Math.max(MIN_VIEW_MS, viewWindowMs * factor),
    );
    const frac =
      viewWindowMs > 0
        ? (anchor - viewStartMs) / viewWindowMs
        : 0.5;
    let nextStart = anchor - frac * nextWindow;
    nextStart = Math.max(0, Math.min(nextStart, Math.max(0, durationMs - nextWindow)));
    setViewWindowMs(nextWindow);
    setViewStartMs(nextStart);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const el = tracksColRef.current;
    const width = el?.getBoundingClientRect().width || 1;
    // Middle button held: always pan (never zoom). Some browsers emit
    // ctrl+wheel during middle-drag, which looked like zoom before.
    if (panningRef.current || (e.buttons & 4) !== 0) {
      e.preventDefault();
      followPlayheadRef.current = false;
      const deltaPx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      setViewStartMs((s) => clampViewStart(s + (deltaPx / width) * viewWindowMs));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      zoomBy(factor, clientXToMs(e.clientX));
      return;
    }
    // Horizontal pan (or shift+wheel)
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      e.preventDefault();
      followPlayheadRef.current = false;
      const delta = (e.shiftKey ? e.deltaY : e.deltaX) * (viewWindowMs / 400);
      setViewStartMs((s) => clampViewStart(s + delta));
    }
  };

  const handleBladeAtPlayhead = useCallback(() => {
    if (readOnly || !selected) return;
    const split = bladeSplitClip(selected, playheadMs);
    if (!split) {
      setError('Playhead must be inside the selected clip to blade.');
      return;
    }
    setError(null);
    pushHistory();
    setClips((prev) => {
      const idx = prev.findIndex((c) => c.uiId === selected.uiId);
      if (idx < 0) return prev;
      const next = [...prev];
      next.splice(idx, 1, split[0], split[1]);
      return next;
    });
    setSelectedId(split[1].uiId);
  }, [readOnly, selected, playheadMs, pushHistory, setError]);

  const handleDeleteSelected = useCallback(() => {
    if (readOnly || !selected) return;
    pushHistory();
    setClips((prev) => prev.filter((c) => c.uiId !== selected.uiId));
    setSelectedId(null);
  }, [readOnly, selected, pushHistory]);

  const handleClipClick = (clip: EditorClip, e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressClipClickRef.current) {
      suppressClipClickRef.current = false;
      return;
    }
    if (tool === 'blade') {
      const at = clientXToMs(e.clientX);
      setPlayheadMs(at);
      seekAudio(at);
      const split = bladeSplitClip(clip, at);
      if (!split) {
        setError('Click inside the clip to blade.');
        return;
      }
      setError(null);
      pushHistory();
      setClips((prev) => {
        const idx = prev.findIndex((c) => c.uiId === clip.uiId);
        if (idx < 0) return prev;
        const next = [...prev];
        next.splice(idx, 1, split[0], split[1]);
        return next;
      });
      setSelectedId(split[1].uiId);
      return;
    }
    setSelectedId(clip.uiId);
    if (tool === 'select') {
      const at = clientXToMs(e.clientX);
      setPlayheadMs(at);
      seekAudio(at);
    }
  };

  const busy = saving || remaking || addingTrack;

  const takeDurationMsForClip = useCallback(
    (clip: EditorClip): number => {
      const takeFile =
        clip.filePath.replace(/\\/g, '/').split('/').pop() || clip.filePath;
      const wf = waveforms[takeFile] ?? waveforms[clip.filePath];
      let fromWf = 0;
      if (wf && wf.length > 0) {
        const spp = wf.samples_per_pixel ?? 256;
        const sr = wf.sample_rate ?? 48000;
        if (sr > 0) {
          fromWf = Math.round((wf.length * spp * 1000) / sr);
        }
      }
      let fromClips = 0;
      for (const c of clipsRef.current) {
        const base =
          c.filePath.replace(/\\/g, '/').split('/').pop() || c.filePath;
        if (base !== takeFile && c.filePath !== clip.filePath) continue;
        fromClips = Math.max(
          fromClips,
          sourceOffsetMsOf(c) + clipLengthMs(c),
        );
      }
      return Math.max(
        fromWf,
        fromClips,
        sourceOffsetMsOf(clip) + clipLengthMs(clip),
        1,
      );
    },
    [waveforms],
  );

  const beginClipResize = useCallback(
    (clip: EditorClip, edge: 'left' | 'right', e: React.PointerEvent) => {
      if (readOnly || busy || tool !== 'select' || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      setSelectedId(clip.uiId);
      setError(null);
      suppressClipClickRef.current = true;

      const startX = e.clientX;
      const uiId = clip.uiId;
      const origStart = clipStartMs(clip);
      const origEnd = clipEndMs(clip);
      const takeDur = takeDurationMsForClip(clip);
      const baseClips = clipsRef.current.map((c) => ({ ...c }));
      let historyPushed = false;

      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      document.body.style.cursor = 'col-resize';

      const onMove = (ev: PointerEvent) => {
        const el = tracksColRef.current;
        const width = el?.getBoundingClientRect().width || 1;
        const dx = ev.clientX - startX;
        if (!historyPushed && Math.abs(dx) > 1) {
          historyPushed = true;
          pushHistory();
        }
        const deltaMs = (dx / width) * viewWindowMsRef.current;
        const edgeMs =
          edge === 'left' ? origStart + deltaMs : origEnd + deltaMs;
        setClips(resizeClipOnLane(baseClips, uiId, edge, edgeMs, takeDur));
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.body.style.removeProperty('cursor');
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [readOnly, busy, tool, pushHistory, takeDurationMsForClip, setError],
  );

  const beginClipSlide = useCallback(
    (clip: EditorClip, e: React.PointerEvent) => {
      if (readOnly || busy || tool !== 'select' || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      setSelectedId(clip.uiId);
      setError(null);

      const startX = e.clientX;
      const origStartMs = clipStartMs(clip);
      const uiId = clip.uiId;
      // Apply each move against the pre-drag layout so overlaps can be restored
      // while dragging back (undo only commits when the gesture starts).
      const baseClips = clipsRef.current.map((c) => ({ ...c }));
      let moved = false;
      let historyPushed = false;

      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      const onMove = (ev: PointerEvent) => {
        const el = tracksColRef.current;
        const width = el?.getBoundingClientRect().width || 1;
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) <= 3) return;
        if (!moved) {
          moved = true;
          suppressClipClickRef.current = true;
          followPlayheadRef.current = false;
          document.body.style.cursor = 'grabbing';
        }
        if (!historyPushed) {
          historyPushed = true;
          pushHistory();
        }
        const deltaMs = (dx / width) * viewWindowMsRef.current;
        const newStart = Math.max(0, origStartMs + deltaMs);
        setClips(slideClipOnLane(baseClips, uiId, newStart));
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.body.style.removeProperty('cursor');
        if (!moved) {
          // Click without drag: seek like before (click handler also runs).
          suppressClipClickRef.current = false;
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [readOnly, busy, tool, pushHistory, setError],
  );

  const toggleLaneSolo = useCallback((laneKey: string) => {
    setLaneSolo((prev) => ({ ...prev, [laneKey]: !prev[laneKey] }));
  }, []);

  const trackSettingsLane = useMemo(() => {
    if (!trackSettingsLaneKey) return null;
    return lanes.find((l) => l.laneKey === trackSettingsLaneKey) ?? null;
  }, [lanes, trackSettingsLaneKey]);

  const trackSettings = useMemo(() => {
    if (!trackSettingsLaneKey) return null;
    return (
      laneFxDefaults[trackSettingsLaneKey] ??
      readLaneTrackSettings(clips, trackSettingsLaneKey)
    );
  }, [clips, trackSettingsLaneKey, laneFxDefaults]);

  const trackSettingsLanePeaks = useMemo(() => {
    if (!trackSettingsLaneKey) return null;
    const peaks = collectLanePeaks(clips, trackSettingsLaneKey, waveforms);
    return peaks.length >= MIN_AUTO_PEAKS ? peaks : null;
  }, [clips, trackSettingsLaneKey, waveforms]);

  // If Track Settings opens without peaks, force-fetch/generate that lane's takes.
  useEffect(() => {
    if (!trackSettingsLaneKey || trackSettingsLanePeaks) return;
    const laneClips = clips.filter(
      (c) => editorLaneKey(c) === trackSettingsLaneKey,
    );
    const files = [
      ...new Set(
        laneClips.map(
          (c) =>
            c.filePath.replace(/\\/g, '/').split('/').pop() || c.filePath,
        ),
      ),
    ].filter(Boolean);
    if (!files.length) return;
    let cancelled = false;
    void Promise.all(
      files.map(async (filePath) => {
        const wf = await fetchTakeWaveform(episodeId, segmentId, filePath);
        return [filePath, wf?.data?.length ? wf : null] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setWaveforms((prev) => {
        const next = { ...prev };
        for (const [path, wf] of entries) {
          next[path] = wf;
          const base = path.replace(/\\/g, '/').split('/').pop() || path;
          if (base !== path) next[base] = wf;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    trackSettingsLaneKey,
    trackSettingsLanePeaks,
    clips,
    episodeId,
    segmentId,
  ]);

  const applyLaneTrackSettings = useCallback(
    (next: TrackSettingsUi) => {
      if (readOnly || !trackSettingsLaneKey) return;
      const laneKey = trackSettingsLaneKey;
      setLaneFxDefaults((prev) => ({ ...prev, [laneKey]: { ...next, eq: { ...next.eq } } }));
      setClips((prev) => applyTrackSettingsToLane(prev, laneKey, next));
    },
    [readOnly, trackSettingsLaneKey],
  );

  const clipSettingsClip = useMemo(() => {
    if (!clipSettingsUiId) return null;
    return clips.find((c) => c.uiId === clipSettingsUiId) ?? null;
  }, [clips, clipSettingsUiId]);

  const clipSettings = useMemo(() => {
    if (!clipSettingsClip) return null;
    return clipToTrackSettings(clipSettingsClip);
  }, [clipSettingsClip]);

  const clipSettingsPeaks = useMemo(() => {
    if (!clipSettingsClip) return null;
    const peaks = collectClipPeaks(clipSettingsClip, waveforms);
    return peaks.length >= MIN_AUTO_PEAKS ? peaks : null;
  }, [clipSettingsClip, waveforms]);

  const clipSettingsLabel = useMemo(() => {
    if (!clipSettingsClip) return '';
    const lane = lanes.find((l) =>
      l.clips.some((c) => c.uiId === clipSettingsClip.uiId),
    );
    const laneLabel = lane?.label?.trim() || 'Clip';
    const start = clipStartMs(clipSettingsClip);
    const end = clipEndMs(clipSettingsClip);
    return `${laneLabel} ${formatTime(start)}-${formatTime(end)}`;
  }, [clipSettingsClip, lanes]);

  useEffect(() => {
    if (!clipSettingsUiId || clipSettingsPeaks) return;
    const clip = clips.find((c) => c.uiId === clipSettingsUiId);
    if (!clip) return;
    const filePath =
      clip.filePath.replace(/\\/g, '/').split('/').pop() || clip.filePath;
    if (!filePath) return;
    let cancelled = false;
    void fetchTakeWaveform(episodeId, segmentId, filePath).then((wf) => {
      if (cancelled) return;
      setWaveforms((prev) => {
        const next = { ...prev };
        const data = wf?.data?.length ? wf : null;
        next[filePath] = data;
        const base = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
        if (base !== filePath) next[base] = data;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    clipSettingsUiId,
    clipSettingsPeaks,
    clips,
    episodeId,
    segmentId,
  ]);

  const applyClipTrackSettings = useCallback(
    (next: TrackSettingsUi) => {
      if (readOnly || !clipSettingsUiId) return;
      const uiId = clipSettingsUiId;
      const clip = clipsRef.current.find((c) => c.uiId === uiId);
      if (clip && clip.fxOverride !== true) {
        // Capture track baseline before the first manual clip override.
        const laneKey = editorLaneKey(clip);
        setLaneFxDefaults((prev) => {
          if (prev[laneKey]) return prev;
          return {
            ...prev,
            [laneKey]: readLaneTrackSettings(clipsRef.current, laneKey),
          };
        });
      }
      setClips((prev) => applyTrackSettingsToClip(prev, uiId, next));
    },
    [readOnly, clipSettingsUiId],
  );

  const resetClipSettingsToTrack = useCallback(() => {
    if (readOnly || !clipSettingsUiId) return;
    const uiId = clipSettingsUiId;
    const clip = clipsRef.current.find((c) => c.uiId === uiId);
    if (!clip) return;
    const laneKey = editorLaneKey(clip);
    const trackFx =
      laneFxDefaultsRef.current[laneKey] ??
      readLaneTrackSettings(clipsRef.current, laneKey);
    setClips((prev) => resetClipFxToTrackSettings(prev, uiId, trackFx));
  }, [readOnly, clipSettingsUiId]);

  const canDeleteClipSettings = useMemo(
    () => clips.length > 1 && Boolean(clipSettingsUiId),
    [clips.length, clipSettingsUiId],
  );

  const handleDeleteClipSettings = useCallback(() => {
    if (readOnly || !clipSettingsUiId) return;
    if (!clipsRef.current.some((c) => c.uiId === clipSettingsUiId)) {
      setClipSettingsUiId(null);
      return;
    }
    if (!clipsRef.current.some((c) => c.uiId !== clipSettingsUiId)) {
      setError('Keep at least one clip on the timeline.');
      return;
    }
    pushHistory();
    const uiId = clipSettingsUiId;
    setClips((prev) => prev.filter((c) => c.uiId !== uiId));
    setSelectedId((cur) => (cur === uiId ? null : cur));
    setClipSettingsUiId(null);
  }, [readOnly, clipSettingsUiId, pushHistory, setError]);

  const openClipSettings = useCallback(
    (clip: EditorClip) => {
      if (readOnly) return;
      setTrackSettingsLaneKey(null);
      setSelectedId(clip.uiId);
      setClipSettingsUiId(clip.uiId);
    },
    [readOnly],
  );

  const canDeleteTrackSettingsLane = useMemo(() => {
    if (!trackSettingsLaneKey) return false;
    return clips.some((c) => editorLaneKey(c) !== trackSettingsLaneKey);
  }, [clips, trackSettingsLaneKey]);

  const handleDeleteTrackSettingsLane = useCallback(() => {
    if (readOnly || !trackSettingsLaneKey) return;
    if (!clipsRef.current.some((c) => editorLaneKey(c) !== trackSettingsLaneKey)) {
      return;
    }
    const laneKey = trackSettingsLaneKey;
    pushHistory();
    const next = clipsRef.current.filter((c) => editorLaneKey(c) !== laneKey);
    setClips(next);
    setSelectedId((sel) => {
      if (!sel) return sel;
      return next.some((c) => c.uiId === sel) ? sel : null;
    });
    setLaneSolo((prev) => {
      if (!(laneKey in prev)) return prev;
      const { [laneKey]: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });
    setLaneFxDefaults((prev) => {
      if (!(laneKey in prev)) return prev;
      const { [laneKey]: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });
    setTrackSettingsLaneKey(null);
  }, [readOnly, trackSettingsLaneKey, pushHistory]);

  const beginRenameLane = (laneKey: string, label: string) => {
    if (readOnly) return;
    setRenamingLaneKey(laneKey);
    setRenameDraft(label);
    renameOriginalRef.current = label;
  };

  const commitRenameLane = useCallback(() => {
    if (!renamingLaneKey) return;
    const name = renameDraft.trim();
    const key = renamingLaneKey;
    const original = renameOriginalRef.current.trim();
    setRenamingLaneKey(null);
    if (!name || readOnly) return;
    // Blur without edits must not rewrite clips (that promoted file takes into
    // host: lanes and reshuffled order).
    if (name === original) return;
    pushHistory();
    setClips((prev) =>
      prev.map((c) =>
        editorLaneKey(c) === key ? { ...c, participantName: name } : c,
      ),
    );
  }, [renamingLaneKey, renameDraft, readOnly, pushHistory]);

  const insertMediaAtPlayhead = useCallback(
    async (opts: { file?: File; libraryAssetId?: string; trackName?: string }) => {
      setAddingTrack(true);
      setError(null);
      try {
        const media = await addSegmentTrackMedia(episodeId, segmentId, opts);
        const start = Math.max(0, playheadMs);
        const lengthMs = Math.max(1, media.durationMs);
        const uiId = `clip_${Math.random().toString(36).slice(2, 10)}`;
        const clip: EditorClip = {
          uiId,
          segmentId: uiId,
          filePath: media.filePath,
          startMs: start,
          lengthMs,
          endMs: start + lengthMs,
          sourceOffsetMs: 0,
          participantName: media.participantName,
          volume: 1,
          muted: false,
          source: opts.libraryAssetId ? 'library' : 'import',
        };
        pushHistory();
        setClips((prev) => [...prev, clip]);
        setLaneFxDefaults((prev) => {
          const key = editorLaneKey(clip);
          if (prev[key]) return prev;
          return { ...prev, [key]: clipToTrackSettings(clip) };
        });
        setSelectedId(uiId);
        // Load waveform for the new take without refetching clips (that would
        // wipe unsaved local edits).
        void fetchTakeWaveform(episodeId, segmentId, media.filePath).then((wf) => {
          if (wf?.data?.length) {
            const base =
              media.filePath.replace(/\\/g, '/').split('/').pop() ||
              media.filePath;
            setWaveforms((prev) => ({
              ...prev,
              [media.filePath]: wf,
              [base]: wf,
            }));
          }
        });
      } finally {
        setAddingTrack(false);
      }
    },
    [episodeId, segmentId, playheadMs, pushHistory, setError],
  );

  const handleStartRipple = useCallback(() => {
    if (readOnly || busy) return;
    pushHistory();
    setRippleStartSec(playheadMs / 1000);
    setError(null);
  }, [readOnly, busy, playheadMs, pushHistory, setError]);

  const handleEndRipple = useCallback(() => {
    if (readOnly || busy) return;
    if (rippleStartSec == null) {
      setError('Set Start Trim at the playhead first.');
      return;
    }
    const a = rippleStartSec;
    const b = playheadMs / 1000;
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (end - start < 0.05) {
      setError('Trim range is too short. Move the playhead, then End Trim.');
      return;
    }
    pushHistory();
    setTrimRanges((prev) => mergeTrimRanges([...prev, [start, end]]));
    setRippleStartSec(null);
    setError(null);
  }, [readOnly, busy, rippleStartSec, playheadMs, pushHistory, setError]);

  const handleCancelRipple = () => {
    if (rippleStartSec == null) return;
    pushHistory();
    setRippleStartSec(null);
    setError(null);
  };

  const nudgePlayheadMs = useCallback(
    (deltaMs: number) => {
      const current = previewRef.current?.getPlayheadMs() ?? playheadMs;
      const next = Math.max(0, Math.min(durationMsRef.current, current + deltaMs));
      seekAudio(next);
    },
    [playheadMs, seekAudio],
  );

  /** Select the next/prev clip under the playhead (lane order), with a none gap. */
  const cycleSelectionAtPlayhead = useCallback(
    (direction: 1 | -1 = 1) => {
      const at = previewRef.current?.getPlayheadMs() ?? playheadMs;
      const under: EditorClip[] = [];
      for (const lane of lanes) {
        for (const clip of lane.clips) {
          const start = clipStartMs(clip);
          const end = clipEndMs(clip);
          if (at >= start && at < end) under.push(clip);
        }
      }
      if (!under.length) {
        setSelectedId(null);
        return;
      }
      const cur = selectedIdRef.current;
      const idx = cur ? under.findIndex((c) => c.uiId === cur) : -1;
      if (direction === 1) {
        // After the last clip under the playhead, clear selection; next F picks the first.
        if (idx >= under.length - 1) {
          setSelectedId(null);
          return;
        }
        setSelectedId(under[idx + 1]!.uiId);
        return;
      }
      // Backward: none → last; first → none; else previous.
      if (idx <= 0) {
        if (idx === 0) {
          setSelectedId(null);
          return;
        }
        setSelectedId(under[under.length - 1]!.uiId);
        return;
      }
      setSelectedId(under[idx - 1]!.uiId);
    },
    [lanes, playheadMs],
  );

  const handleSave = useCallback(async () => {
    if (readOnly || busy) return;
    if (!dirty) return;
    if (clipsDirty && clips.length === 0) {
      setError('At least one clip is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (clipsDirty) {
        const saved = await saveSegmentTracks(
          episodeId,
          segmentId,
          toApiClips(clips),
        );
        const next = toEditorClips(saved.clips);
        setClips(next);
        setLaneFxDefaults((prev) => {
          const built = buildLaneFxDefaults(next);
          // Keep sticky track defaults for lanes that are fully overridden.
          const merged = { ...built };
          for (const [key, value] of Object.entries(prev)) {
            const laneHasInherited = next.some(
              (c) => editorLaneKey(c) === key && c.fxOverride !== true,
            );
            if (!laneHasInherited && value) merged[key] = value;
          }
          return merged;
        });
        setBaseline(JSON.stringify(toApiClips(next)));
      }
      if (trimsDirty || markersDirty) {
        const merged = mergeTrimRanges(trimRanges);
        const nextMarkers = sortMarkers(markers);
        await updateSegment(episodeId, segmentId, {
          ...(trimsDirty ? { trimRanges: merged } : {}),
          ...(markersDirty ? { markers: nextMarkers } : {}),
        });
        if (trimsDirty) {
          setTrimRanges(merged);
          setTrimsBaseline(JSON.stringify(merged));
        }
        if (markersDirty) {
          setMarkers(nextMarkers);
          setMarkersBaseline(nextMarkers.map((m) => ({ ...m })));
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [
    readOnly,
    busy,
    dirty,
    clipsDirty,
    clips,
    trimsDirty,
    markersDirty,
    trimRanges,
    markers,
    episodeId,
    segmentId,
    queryClient,
    setError,
  ]);

  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      return (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          if (!readOnly && !busy) handleUndo();
          return;
        }
        if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          if (!readOnly && !busy) handleRedo();
          return;
        }
        if (key === 's' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          if (!readOnly && !busy) void handleSave();
          return;
        }
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Space toggles preview; prevent the dialog/button from scrolling or activating.
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        // Blur focused toolbar controls so Space does not leave a stuck :focus ring
        // (and so disabled buttons do not bounce focus onto the dialog shell).
        if (e.target instanceof HTMLElement && e.target.closest('button')) {
          e.target.blur();
        }
        if (busy || segment.recordFailed || clips.length === 0) return;
        togglePlay();
        return;
      }

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (key === 'a') {
        e.preventDefault();
        e.stopPropagation();
        if (busy || segment.recordFailed || clips.length === 0) return;
        nudgePlayheadMs(e.shiftKey ? -1_000 : -5_000);
        return;
      }

      if (key === 'd') {
        e.preventDefault();
        e.stopPropagation();
        if (busy || segment.recordFailed || clips.length === 0) return;
        nudgePlayheadMs(e.shiftKey ? 1_000 : 5_000);
        return;
      }

      if (key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        if (busy || segment.recordFailed || clips.length === 0) return;
        nudgePlayheadMs(-200);
        return;
      }

      if (key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        if (busy || segment.recordFailed || clips.length === 0) return;
        nudgePlayheadMs(200);
        return;
      }

      if (key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        if (busy || clips.length === 0) return;
        cycleSelectionAtPlayhead(e.shiftKey ? -1 : 1);
        return;
      }

      if (key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        if (busy || segment.recordFailed || clips.length === 0) return;
        cyclePlaybackRate();
        return;
      }

      if (readOnly || busy) return;

      if (key === 's') {
        e.preventDefault();
        e.stopPropagation();
        handleBladeAtPlayhead();
        return;
      }

      if (key === 'r') {
        e.preventDefault();
        e.stopPropagation();
        if (rippleStartSecRef.current == null) handleStartRipple();
        else handleEndRipple();
        return;
      }

      if (key === 'x' || e.key === 'Backspace' || e.key === 'Delete') {
        if (!selectedId) return;
        e.preventDefault();
        e.stopPropagation();
        handleDeleteSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    readOnly,
    busy,
    selectedId,
    handleDeleteSelected,
    handleBladeAtPlayhead,
    handleStartRipple,
    handleEndRipple,
    handleUndo,
    handleRedo,
    handleSave,
    nudgePlayheadMs,
    cycleSelectionAtPlayhead,
    cyclePlaybackRate,
    togglePlay,
    clips.length,
    segment.recordFailed,
  ]);

  const handleRemoveTrim = (index: number) => {
    if (readOnly || busy) return;
    pushHistory();
    setTrimRanges((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddMarkerAtPlayhead = () => {
    if (readOnly || busy) return;
    const maxSec = durationMs / 1000;
    const time = Math.min(Math.max(0, playheadMs / 1000), maxSec);
    pushHistory();
    const created: Marker = { time, color: MARKER_COLORS[0] };
    const next = sortMarkers([...markers, created]);
    setMarkers(next);
    setEditMarkerIndex(next.indexOf(created));
  };

  const handleSaveMarkerEdit = (updated: Marker) => {
    if (editMarkerIndex == null) return;
    pushHistory();
    const next = [...markers];
    next[editMarkerIndex] = updated;
    const sorted = sortMarkers(next);
    setMarkers(sorted);
    setEditMarkerIndex(null);
  };

  const handleRemoveMarkerEdit = () => {
    if (editMarkerIndex == null) return;
    pushHistory();
    setMarkers(markers.filter((_, i) => i !== editMarkerIndex));
    setEditMarkerIndex(null);
  };

  const handleRemake = async () => {
    if (readOnly || busy) return;
    if (dirty) {
      setError('Save changes before remaking the mix.');
      return;
    }
    if (previewRef.current?.isPlaying) previewRef.current.pause();
    setRemaking(true);
    setError(null);
    try {
      await startRemakeSegmentTracks(episodeId, segmentId);
      await pollUntil(() => getSegmentTracksApplyStatus(episodeId, segmentId), {
        pendingStatuses: ['remaking'],
        successStatuses: ['done', 'idle'],
        failedStatus: 'failed',
      });
      await queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
      await queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remake mix');
    } finally {
      setRemaking(false);
    }
  };

  const leaveActionRef = useRef<'close' | 'simple'>('close');

  const performLeave = useCallback(() => {
    if (leaveActionRef.current === 'simple') {
      setSegmentEditorMode('simple');
      onSwitchToSimple();
      return;
    }
    onClose();
  }, [onClose, onSwitchToSimple]);

  const {
    confirmOpen: leaveConfirmOpen,
    requestClose: requestLeave,
    onOpenChange: handleLeaveOpenChange,
    handleConfirmOpenChange: handleLeaveConfirmOpenChange,
    handleDiscard: handleLeaveDiscard,
    dialogContentProps: leaveGuardContentProps,
  } = useDialogCloseGuard({
    isDirty: Boolean(dirty && !readOnly),
    onClose: performLeave,
  });

  const requestCloseEditor = useCallback(() => {
    if (busy) return;
    leaveActionRef.current = 'close';
    requestLeave();
  }, [busy, requestLeave]);

  const requestSwitchSimple = useCallback(() => {
    if (busy) return;
    leaveActionRef.current = 'simple';
    requestLeave();
  }, [busy, requestLeave]);

  const playheadInView =
    playheadMs >= viewStartMs && playheadMs <= viewEndMs;
  const playheadPct = playheadInView
    ? ((playheadMs - viewStartMs) / visibleWindowMs) * 100
    : null;

  const msToPct = (ms: number) => ((ms - viewStartMs) / visibleWindowMs) * 100;

  const rulerStepMs = useMemo(
    () => pickRulerStepMs(visibleWindowMs, tracksColWidth),
    [visibleWindowMs, tracksColWidth],
  );

  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = rulerStepMs;
    const first = Math.ceil(viewStartMs / step) * step;
    for (let t = first; t <= viewEndMs + 0.5; t += step) ticks.push(t);
    return ticks;
  }, [viewStartMs, viewEndMs, rulerStepMs]);

  return (
    <Dialog.Root
      open
      onOpenChange={(o) => {
        if (!o && !busy) handleLeaveOpenChange(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={styles.segmentEditorV2Dialog}
          aria-describedby="segment-editor-v2-desc"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => {
            e.preventDefault();
            leaveGuardContentProps.onPointerDownOutside(e);
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
            leaveGuardContentProps.onInteractOutside(e);
          }}
          onEscapeKeyDown={(e) => {
            if (busy) {
              e.preventDefault();
              return;
            }
            leaveGuardContentProps.onEscapeKeyDown(e);
          }}
        >
          <div className={styles.segmentEditorV2Header}>
            <div className={styles.segmentEditorV2HeaderLeft}>
              <Dialog.Title className={styles.dialogTitle}>
                Advanced Editor: {segmentName || 'Section'}
              </Dialog.Title>
              <Dialog.Description id="segment-editor-v2-desc" className={styles.srOnly}>
                Multitrack clip timeline. Blade, trim, and delete clips. Soft trims skip on
                playback like the simple editor. Save the layout, then remake the mix.
              </Dialog.Description>
            </div>
            <div className={styles.segmentEditorV2HeaderActions}>
              <button
                type="button"
                className={styles.generateFieldBtn}
                onClick={requestSwitchSimple}
                disabled={busy}
              >
                Simple Editor
              </button>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={busy}
                onClick={requestCloseEditor}
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>
          </div>

          {isLoading && (
            <p className={styles.episodeTranscriptStatus}>Loading tracks...</p>
          )}
          {!isLoading && !data && (
            <p className={styles.error} role="alert">
              {loadError ||
                'No multitrack recordings for this segment. Use the simple editor, or restore/import tracks first.'}
            </p>
          )}

          {data && (
            <>
              <div
                className={styles.segmentEditorV2Toolbar}
                onMouseDown={(e) => {
                  // Keep mouse clicks from focusing toolbar buttons. Otherwise a control
                  // that disables after click hands focus to Dialog.Content and the
                  // dialog border flashes like a selection ring.
                  if (e.target instanceof HTMLElement && e.target.closest('button')) {
                    e.preventDefault();
                  }
                }}
              >
                <div className={styles.segmentEditorV2ToolGroup} role="group" aria-label="Tools">
                  <button
                    type="button"
                    className={tool === 'select' ? styles.segmentEditorV2ToolActive : styles.segmentEditorV2Tool}
                    onClick={() => setTool('select')}
                    disabled={readOnly || busy}
                    title="Select tool"
                    aria-label="Select tool"
                  >
                    <MousePointer2 size={14} aria-hidden />
                    Select
                  </button>
                  <button
                    type="button"
                    className={tool === 'blade' ? styles.segmentEditorV2ToolActive : styles.segmentEditorV2Tool}
                    onClick={() => setTool('blade')}
                    disabled={readOnly || busy}
                    title="Blade tool"
                    aria-label="Blade tool"
                  >
                    <Scissors size={14} aria-hidden />
                    Blade
                  </button>
                </div>
                <div className={styles.segmentEditorV2ToolGroup}>
                  <button
                    type="button"
                    className={styles.segmentEditorV2Tool}
                    onClick={handleBladeAtPlayhead}
                    disabled={readOnly || busy || !selected}
                    title="Blade selected clip at the playhead"
                    aria-label="Blade at Playhead"
                  >
                    <Split size={14} aria-hidden />
                    Blade at Playhead
                  </button>
                </div>
                <div className={styles.segmentEditorV2ToolGroup} role="group" aria-label="Soft trims">
                  <button
                    type="button"
                    className={
                      rippleStartSec != null
                        ? styles.segmentEditorV2ToolActive
                        : styles.segmentEditorV2Tool
                    }
                    onClick={handleStartRipple}
                    disabled={readOnly || busy}
                    title="Mark soft-trim start at the playhead"
                    aria-label="Start Trim"
                  >
                    <ArrowLeftToLine size={14} aria-hidden />
                    Start Trim
                  </button>
                  <button
                    type="button"
                    className={styles.segmentEditorV2Tool}
                    onClick={handleEndRipple}
                    disabled={readOnly || busy || rippleStartSec == null}
                    title="Mark soft-trim end at the playhead"
                    aria-label="End Trim"
                  >
                    <ArrowRightToLine size={14} aria-hidden />
                    End Trim
                  </button>
                  {rippleStartSec != null && (
                    <button
                      type="button"
                      className={styles.segmentEditorV2Tool}
                      onClick={handleCancelRipple}
                      disabled={busy}
                      title="Clear pending trim start"
                      aria-label="Cancel Trim"
                    >
                      <X size={14} aria-hidden />
                      Cancel Trim
                    </button>
                  )}
                </div>
                <div className={styles.segmentEditorV2ToolGroup} role="group" aria-label="Markers">
                  <button
                    type="button"
                    className={styles.segmentEditorV2Tool}
                    onClick={handleAddMarkerAtPlayhead}
                    disabled={readOnly || busy || !clips.length}
                    title="Add marker at the playhead"
                    aria-label="Marker"
                  >
                    <MapPin size={14} aria-hidden />
                    Marker
                  </button>
                  <button
                    type="button"
                    className={
                      playbackRate === 1
                        ? styles.segmentEditorV2Tool
                        : styles.segmentEditorV2ToolActive
                    }
                    onClick={cyclePlaybackRate}
                    disabled={busy || segment.recordFailed || !clips.length}
                    title="Cycle preview speed (E): 1x, 1.5x, 2x"
                    aria-label={`Playback speed ${playbackRate}x`}
                  >
                    {playbackRate}x
                  </button>
                </div>
                <div className={styles.segmentEditorV2ToolGroup} role="group" aria-label="Zoom">
                  <button
                    type="button"
                    className={`${styles.segmentEditorV2Tool} ${styles.segmentEditorV2ToolIcon}`}
                    onClick={() => zoomBy(1 / 1.4)}
                    title="Zoom in"
                    aria-label="Zoom in"
                  >
                    <ZoomIn size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={`${styles.segmentEditorV2Tool} ${styles.segmentEditorV2ToolIcon}`}
                    onClick={() => zoomBy(1.4)}
                    title="Zoom out"
                    aria-label="Zoom out"
                  >
                    <ZoomOut size={14} aria-hidden />
                  </button>
                </div>
                {!readOnly && (
                  <div className={styles.segmentEditorV2ToolbarEnd}>
                    <button
                      type="button"
                      className={`${styles.segmentEditorV2Tool} ${styles.segmentEditorV2SaveBtn}`}
                      onClick={() => void handleSave()}
                      disabled={busy || !dirty}
                      title="Save clip layout, soft trims, and markers"
                    >
                      <Save size={14} aria-hidden />
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className={styles.segmentEditorV2Tool}
                      onClick={() => void handleRemake()}
                      disabled={busy || dirty}
                      title={
                        dirty
                          ? 'Save changes before remaking the mix'
                          : 'Remake segment mix from the saved clip layout'
                      }
                    >
                      <RefreshCw size={14} aria-hidden />
                      {remaking ? 'Remaking...' : 'Remake'}
                    </button>
                  </div>
                )}
              </div>

              <div className={styles.segmentEditorV2Transport}>
                <button
                  type="button"
                  className={`${styles.segmentBtn} ${styles.segmentEditorV2PlayBtn}`}
                  onClick={togglePlay}
                  disabled={segment.recordFailed || !clips.length}
                  title={isPlaying ? 'Pause' : 'Play'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
                </button>
                <div className={styles.segmentEditorV2TransportWave}>
                  {mixWaveform?.data?.length ? (
                    <div className={styles.segmentEditorV2TransportWaveInner}>
                      <WaveformCanvas
                        data={mixWaveform}
                        durationSec={mixDurationSec}
                        currentTime={playheadMs / 1000}
                        onSeek={handleSeekSec}
                        onPlayPause={togglePlay}
                        onScrubStart={handleMixScrubStart}
                        onScrubEnd={handleMixScrubEnd}
                      />
                      {/* Soft trims on the remade mix timebase (same as simple editor). */}
                      {trimRanges.map(([startSec, endSec], i) => {
                        if (endSec <= 0 || startSec >= mixDurationSec) return null;
                        const visStart = Math.max(0, startSec);
                        const visEnd = Math.min(mixDurationSec, endSec);
                        const left = (visStart / mixDurationSec) * 100;
                        const width = ((visEnd - visStart) / mixDurationSec) * 100;
                        return (
                          <div
                            key={`mix-trim-${i}-${startSec}-${endSec}`}
                            className={styles.segmentEditorV2TrimOverlay}
                            style={{
                              left: `${left}%`,
                              width: `${Math.max(width, 0.05)}%`,
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className={styles.segmentEditorV2TransportWaveEmpty}>
                      Mix waveform unavailable (preview still plays takes)
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div
                  className={`${styles.segmentEditorV2Error} ${
                    errorFading ? styles.segmentEditorV2ErrorFading : ''
                  }`}
                  role="alert"
                >
                  <CircleAlert
                    size={18}
                    strokeWidth={2}
                    className={styles.segmentEditorV2ErrorIcon}
                    aria-hidden
                  />
                  <p className={styles.segmentEditorV2ErrorMessage}>{error}</p>
                </div>
              )}

              <div
                className={styles.segmentEditorV2TimelineWrap}
                onWheel={handleWheel}
                onPointerDown={handleTimelinePointerDown}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) e.preventDefault();
                }}
              >
                <div
                  className={styles.segmentEditorV2TimelineGrid}
                  style={{ ['--v2-label-col' as string]: `${LABEL_COL_PX}px` }}
                >
                  <div className={styles.segmentEditorV2MarkersLabel}>Markers</div>
                  <div
                    className={styles.segmentEditorV2MarkersLane}
                    aria-label="Marker timeline"
                  >
                    {markers.map((m, i) => {
                      const markerMs = m.time * 1000;
                      if (markerMs < viewStartMs || markerMs > viewEndMs) return null;
                      const left = msToPct(markerMs);
                      const color = m.color ?? MARKER_COLORS[0];
                      const markerType = m.markerType ?? '';
                      const shapeClass =
                        markerType === 'chapter'
                          ? styles.markerHandleChapter
                          : markerType === 'soundbite'
                            ? styles.markerHandleSoundbite
                            : '';
                      const isSoundbite = markerType === 'soundbite';
                      const isSelected = editMarkerIndex === i;
                      return (
                        <button
                          key={`marker-${i}-${m.time}`}
                          type="button"
                          className={`${styles.markerHandle} ${shapeClass} ${
                            isSelected ? styles.markerHandleSelected : ''
                          }`}
                          style={
                            isSoundbite
                              ? { left: `${left}%`, color }
                              : {
                                  left: `${left}%`,
                                  borderColor: color,
                                  backgroundColor: isSelected ? color : 'transparent',
                                }
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            if (readOnly || busy) return;
                            setEditMarkerIndex(i);
                          }}
                          title={m.title ?? `Marker at ${formatDuration(Math.floor(m.time))}`}
                          aria-label={
                            m.title
                              ? `Edit marker: ${m.title}`
                              : `Edit marker at ${formatDuration(Math.floor(m.time))}`
                          }
                          disabled={readOnly || busy}
                        >
                          {isSoundbite && (
                            <svg
                              className={styles.markerHandleSoundbiteSvg}
                              viewBox="0 0 12 11"
                              aria-hidden
                            >
                              <polygon
                                points="6,1 1,10 11,10"
                                fill={isSelected ? 'currentColor' : 'none'}
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div
                    className={styles.segmentEditorV2LabelSpacer}
                    aria-label="Playhead time and total duration"
                  >
                    {formatDuration(Math.floor(playheadMs / 1000))}
                    {' / '}
                    {formatDuration(Math.floor(durationMs / 1000))}
                  </div>
                  <div
                    className={styles.segmentEditorV2Ruler}
                    onPointerDown={beginRulerPan}
                    title="Drag to pan. Click to move playhead."
                  >
                    {rulerTicks.map((t) => {
                      const pct = msToPct(t);
                      const edge =
                        pct <= 0.5
                          ? 'start'
                          : pct >= 99.5
                            ? 'end'
                            : 'mid';
                      return (
                        <span
                          key={t}
                          className={
                            edge === 'start'
                              ? `${styles.segmentEditorV2RulerTick} ${styles.segmentEditorV2RulerTickStart}`
                              : edge === 'end'
                                ? `${styles.segmentEditorV2RulerTick} ${styles.segmentEditorV2RulerTickEnd}`
                                : styles.segmentEditorV2RulerTick
                          }
                          style={{ left: `${pct}%` }}
                        >
                          {formatRulerTime(t, rulerStepMs)}
                        </span>
                      );
                    })}
                  </div>

                  <div className={styles.segmentEditorV2LaneLabels}>
                    {lanes.map((lane) => {
                      const muted = lane.clips.every((c) => c.muted === true);
                      const soloed = Boolean(laneSolo[lane.laneKey]);
                      return (
                        <div
                          key={lane.laneKey}
                          className={`${styles.segmentEditorV2LaneLabel} ${
                            muted ? styles.segmentEditorV2LaneLabelMuted : ''
                          }`}
                        >
                          {renamingLaneKey === lane.laneKey ? (
                            <input
                              className={styles.segmentEditorV2LaneNameInput}
                              value={renameDraft}
                              autoFocus
                              aria-label="Track name"
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onBlur={() => commitRenameLane()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitRenameLane();
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setRenamingLaneKey(null);
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <button
                              type="button"
                              className={styles.segmentEditorV2LaneNameBtn}
                              title={lane.label}
                              disabled={readOnly || busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                beginRenameLane(lane.laneKey, lane.label);
                              }}
                            >
                              {lane.label}
                            </button>
                          )}
                          <div className={styles.segmentEditorV2LaneControls}>
                            <button
                              type="button"
                              className={
                                muted
                                  ? styles.segmentEditorV2LaneCtrlActive
                                  : styles.segmentEditorV2LaneCtrl
                              }
                              title="Track settings"
                              aria-label="Track settings"
                              disabled={busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                setClipSettingsUiId(null);
                                setTrackSettingsLaneKey(lane.laneKey);
                              }}
                            >
                              <SlidersHorizontal size={14} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className={
                                soloed
                                  ? styles.segmentEditorV2LaneCtrlActive
                                  : styles.segmentEditorV2LaneCtrl
                              }
                              title={soloed ? 'Unsolo track' : 'Solo track'}
                              aria-label={soloed ? 'Unsolo track' : 'Solo track'}
                              aria-pressed={soloed}
                              disabled={busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleLaneSolo(lane.laneKey);
                              }}
                            >
                              <Headphones size={14} aria-hidden />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {!readOnly && (
                      <button
                        type="button"
                        className={styles.segmentEditorV2AddTrackBtn}
                        onClick={() => setAddTrackOpen(true)}
                        disabled={busy}
                        title="Add Track"
                      >
                        <Plus size={14} aria-hidden /> Add Track
                      </button>
                    )}
                  </div>

                  <div
                    ref={tracksColRef}
                    className={styles.segmentEditorV2TracksCol}
                    onPointerDown={(e) => {
                      if (e.button === 1) return; // pan handled on wrap
                      if (e.button !== 0) return;
                      if ((e.target as HTMLElement).closest(`.${styles.segmentEditorV2Clip}`)) {
                        return;
                      }
                      e.preventDefault();
                      beginScrub(e.clientX);
                    }}
                  >
                    {playheadPct != null && (
                      <div
                        className={styles.segmentEditorV2Playhead}
                        style={{ left: `${playheadPct}%` }}
                      />
                    )}
                    {trimRanges.map(([startSec, endSec], i) => {
                      const start = startSec * 1000;
                      const end = endSec * 1000;
                      if (end <= viewStartMs || start >= viewEndMs) return null;
                      const visStart = Math.max(start, viewStartMs);
                      const visEnd = Math.min(end, viewEndMs);
                      const left = msToPct(visStart);
                      const width = ((visEnd - visStart) / visibleWindowMs) * 100;
                      return (
                        <div
                          key={`trim-${i}-${startSec}-${endSec}`}
                          className={styles.segmentEditorV2TrimOverlay}
                          style={{ left: `${left}%`, width: `${Math.max(width, 0.15)}%` }}
                        >
                          {!readOnly && (
                            <button
                              type="button"
                              className={styles.timelineTrimRemoveBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveTrim(i);
                              }}
                              title="Remove soft trim"
                              aria-label="Remove soft trim"
                            >
                              <X size={14} strokeWidth={2.5} aria-hidden />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {rippleStartSec != null &&
                      rippleStartSec * 1000 >= viewStartMs &&
                      rippleStartSec * 1000 <= viewEndMs && (
                        <div
                          className={styles.segmentEditorV2RippleStart}
                          style={{ left: `${msToPct(rippleStartSec * 1000)}%` }}
                          aria-hidden
                        />
                      )}
                    {lanes.map((lane) => (
                      <div
                        key={lane.laneKey}
                        className={`${styles.segmentEditorV2LaneTrack} ${
                          lane.clips.every((c) => c.muted === true)
                            ? styles.segmentEditorV2LaneTrackMuted
                            : ''
                        }`}
                      >
                        {lane.clips.map((clip) => {
                          const start = clipStartMs(clip);
                          const end = clipEndMs(clip);
                          if (end <= viewStartMs || start >= viewEndMs) return null;
                          const visStart = Math.max(start, viewStartMs);
                          const visEnd = Math.min(end, viewEndMs);
                          const left = msToPct(visStart);
                          const width = ((visEnd - visStart) / visibleWindowMs) * 100;
                          const selectedCls =
                            clip.uiId === selectedId
                              ? styles.segmentEditorV2ClipSelected
                              : '';
                          const takeFile =
                            clip.filePath.replace(/\\/g, '/').split('/').pop() ||
                            clip.filePath;
                          const wf = waveforms[takeFile] ?? waveforms[clip.filePath];
                          const src0 = sourceOffsetMsOf(clip) / 1000;
                          // Visible source slice when the view crops the clip
                          const cropLeftMs = visStart - start;
                          const cropRightMs = end - visEnd;
                          const srcStart = src0 + cropLeftMs / 1000;
                          const srcEnd =
                            src0 + clipLengthMs(clip) / 1000 - cropRightMs / 1000;
                          return (
                            <button
                              key={clip.uiId}
                              type="button"
                              className={`${styles.segmentEditorV2Clip} ${selectedCls} ${
                                !readOnly && tool === 'select'
                                  ? styles.segmentEditorV2ClipDraggable
                                  : ''
                              }`}
                              style={{
                                left: `${left}%`,
                                width: `${Math.max(width, 0.15)}%`,
                              }}
                              onClick={(e) => handleClipClick(clip, e)}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                if (tool !== 'select' || readOnly) return;
                                openClipSettings(clip);
                              }}
                              onPointerDown={(e) => {
                                if (e.button === 1) return; // allow middle-pan to bubble
                                if (!readOnly && tool === 'select' && e.button === 0) {
                                  beginClipSlide(clip, e);
                                  return;
                                }
                                e.stopPropagation();
                              }}
                              title={`${lane.label} ${formatTime(start)}-${formatTime(end)}`}
                            >
                              {wf ? (
                                <ClipWaveform
                                  data={wf}
                                  sourceStartSec={srcStart}
                                  sourceEndSec={Math.max(srcStart + 0.01, srcEnd)}
                                />
                              ) : null}
                              {clip.uiId === selectedId &&
                                !readOnly &&
                                tool === 'select' && (
                                  <>
                                    <span
                                      className={styles.segmentEditorV2ClipHandleLeft}
                                      onPointerDown={(e) => beginClipResize(clip, 'left', e)}
                                      title="Drag to trim or extend start"
                                      aria-label="Resize clip start"
                                      role="slider"
                                      aria-valuemin={0}
                                      aria-valuenow={Math.round(start)}
                                    />
                                    <span
                                      className={styles.segmentEditorV2ClipHandleRight}
                                      onPointerDown={(e) => beginClipResize(clip, 'right', e)}
                                      title="Drag to trim or extend end"
                                      aria-label="Resize clip end"
                                      role="slider"
                                      aria-valuemin={Math.round(start + 1)}
                                      aria-valuenow={Math.round(end)}
                                    />
                                  </>
                                )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                    {!readOnly && (
                      <div className={styles.segmentEditorV2LaneTrackSpacer} aria-hidden />
                    )}
                  </div>
                </div>
              </div>

              <AddTrackDialog
                open={addTrackOpen}
                onOpenChange={setAddTrackOpen}
                busy={addingTrack}
                onUpload={(file, trackName) =>
                  insertMediaAtPlayhead({ file, trackName })
                }
                onPickLibrary={(libraryAssetId, trackName) =>
                  insertMediaAtPlayhead({ libraryAssetId, trackName })
                }
              />

              {trackSettingsLane && trackSettings ? (
                <TrackSettingsDialog
                  open
                  onOpenChange={(open) => {
                    if (!open) setTrackSettingsLaneKey(null);
                  }}
                  trackName={trackSettingsLane.label}
                  settings={trackSettings}
                  onChange={applyLaneTrackSettings}
                  onBeforeFirstEdit={pushHistory}
                  onDeleteTrack={handleDeleteTrackSettingsLane}
                  canDeleteTrack={canDeleteTrackSettingsLane}
                  lanePeaks={trackSettingsLanePeaks}
                  readOnly={readOnly}
                  scope="track"
                />
              ) : null}

              {clipSettingsClip && clipSettings ? (
                <TrackSettingsDialog
                  open
                  onOpenChange={(open) => {
                    if (!open) setClipSettingsUiId(null);
                  }}
                  trackName={clipSettingsLabel}
                  settings={clipSettings}
                  onChange={applyClipTrackSettings}
                  onBeforeFirstEdit={pushHistory}
                  onDeleteTrack={handleDeleteClipSettings}
                  canDeleteTrack={canDeleteClipSettings}
                  lanePeaks={clipSettingsPeaks}
                  readOnly={readOnly}
                  scope="clip"
                  onReset={resetClipSettingsToTrack}
                />
              ) : null}

              <MarkerEditDialog
                open={editMarkerIndex != null && markers[editMarkerIndex] != null}
                onOpenChange={(open) => {
                  if (!open) setEditMarkerIndex(null);
                }}
                marker={
                  editMarkerIndex != null ? (markers[editMarkerIndex] ?? null) : null
                }
                maxTimeSec={durationMs / 1000}
                onSave={handleSaveMarkerEdit}
                onRemove={handleRemoveMarkerEdit}
              />
            </>
          )}

          <div
            className={styles.segmentEditorV2Footer}
            onMouseDown={(e) => {
              if (e.target instanceof HTMLElement && e.target.closest('button')) {
                e.preventDefault();
              }
            }}
          >
            <div className={styles.segmentEditorV2FooterLeft} role="group" aria-label="Edit actions">
              <button
                type="button"
                className={styles.segmentEditorV2Tool}
                onClick={handleUndo}
                disabled={readOnly || busy || !canUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
              >
                <Undo2 size={14} aria-hidden />
                Undo
              </button>
              <button
                type="button"
                className={styles.segmentEditorV2Tool}
                onClick={handleRedo}
                disabled={readOnly || busy || !canRedo}
                title="Redo (Ctrl+Y)"
                aria-label="Redo"
              >
                <Redo2 size={14} aria-hidden />
                Redo
              </button>
              <button
                type="button"
                className={styles.segmentEditorV2Tool}
                onClick={handleDeleteSelected}
                disabled={readOnly || busy || !selected}
                title="Delete selected clip (X)"
                aria-label="Delete selected clip"
              >
                <Trash2 size={14} aria-hidden />
                Delete
              </button>
              <button
                type="button"
                className={styles.segmentEditorV2Tool}
                onClick={() => {
                  if (selected) openClipSettings(selected);
                }}
                disabled={readOnly || busy || !selected}
                title="Clip settings for the selected clip"
                aria-label="Clip settings"
              >
                <Settings size={14} aria-hidden />
                Settings
              </button>
            </div>
            <p className={styles.segmentEditorV2Hotkeys}>
              Space Pause · A/D ±5s · Shift+A/D ±1s · F / Shift+F cycle clip · E speed · S
              blade · R start/end trim · X delete
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      <UnsavedChangesConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={handleLeaveConfirmOpenChange}
        onDiscard={handleLeaveDiscard}
        description="You have unsaved changes. Discard them and continue?"
      />
    </Dialog.Root>
  );
}

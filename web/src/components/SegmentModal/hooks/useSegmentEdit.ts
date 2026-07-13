import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { segmentStreamUrl, updateSegment, fetchSegmentWaveformsBulk } from '../../../api/segments';
import type { EpisodeSegment } from '../../../api/segments';
import type { Marker, AudioEq } from '@harborfm/shared';
import type { WaveformData } from '../../../pages/EpisodeEditor/WaveformCanvas';
import type { TimelineMode } from '../../../pages/EpisodeEditor/TimelineWaveform';
import { useSegmentAudio } from './useSegmentAudio';
import { mergeTrimRanges } from '../utils/transcriptTrimUtils';

export function useSegmentEdit(
  episodeId: string,
  segment: EpisodeSegment,
  segmentWaveformData?: WaveformData | null,
  options?: { initialTimelineMode?: TimelineMode; isEditTabVisible?: boolean }
) {
  const queryClient = useQueryClient();
  const segmentEditAudioRef = useRef<HTMLAudioElement>(null);
  const initialMode = options?.initialTimelineMode ?? 'drag';
  const isEditTabVisible = options?.isEditTabVisible ?? true;

  const [waveformData, setWaveformData] = useState<WaveformData | null>(segmentWaveformData ?? null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimRanges, setTrimRanges] = useState<Array<[number, number]>>(segment.trimRanges ?? []);
  const [markers, setMarkers] = useState<Marker[]>(segment.markers ?? []);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>(initialMode);
  const [selectedMarkerIndex, setSelectedMarkerIndex] = useState<number | null>(null);
  /** Draft edits for selected marker; applied when user clicks Done. */
  const [markerDraft, setMarkerDraft] = useState<{ title: string; color: string; markerType: '' | 'chapter' } | null>(null);
  const [viewStartSec, setViewStartSec] = useState(0);
  const [viewEndSec, setViewEndSec] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const defaultEq = () => ({
    lowDb: segment.audioEq?.lowDb ?? 0,
    midDb: segment.audioEq?.midDb ?? 0,
    highDb: segment.audioEq?.highDb ?? 0,
  });
  const [appliedAudioEq, setAppliedAudioEq] = useState(defaultEq);
  const [draftAudioEq, setDraftAudioEq] = useState(defaultEq);
  const [audioEditActive, setAudioEditActive] = useState(false);
  const audioGraphRef = useRef<{
    context: AudioContext;
    source: MediaElementAudioSourceNode;
    lowShelf: BiquadFilterNode;
    peaking: BiquadFilterNode;
    highShelf: BiquadFilterNode;
  } | null>(null);

  const durationSec = segment.durationSec ?? 0;
  useSegmentAudio(segmentEditAudioRef, trimRanges, setCurrentTime, setIsPlaying, isEditTabVisible);

  useEffect(() => {
    const el = segmentEditAudioRef.current;
    if (el) el.playbackRate = playbackRate;
  }, [playbackRate, isEditTabVisible]);

  // Scroll view when playhead nears right edge during playback (separate from play logic)
  useEffect(() => {
    if (!isPlaying) return;
    const win = viewEndSec - viewStartSec;
    if (win <= 0.01) return;
    if (currentTime < viewStartSec + 0.9 * win) return;
    let newStart = currentTime - 0.1 * win;
    let newEnd = newStart + win;
    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(win, durationSec);
    }
    if (newEnd > durationSec) {
      newEnd = durationSec;
      newStart = Math.max(0, durationSec - win);
    }
    if (Math.abs(newStart - viewStartSec) < 0.001 && Math.abs(newEnd - viewEndSec) < 0.001) {
      return;
    }
    setViewStartSec(newStart);
    setViewEndSec(newEnd);
  }, [isPlaying, currentTime, viewStartSec, viewEndSec, durationSec]);

  // Preload audio - use rAF to run after paint so audio element exists when Edit tab mounts
  useEffect(() => {
    if (!isEditTabVisible) return;
    const id = requestAnimationFrame(() => {
      const el = segmentEditAudioRef.current;
      if (!el || !segment.audioPath || durationSec <= 0) return;
      el.src = segmentStreamUrl(episodeId, segment.id, segment.audioPath);
    });
    return () => cancelAnimationFrame(id);
  }, [episodeId, segment.id, segment.audioPath, durationSec, isEditTabVisible]);

  useEffect(() => {
    setTrimRanges(segment.trimRanges ?? []);
    setMarkers(segment.markers ?? []);
    const dur = segment.durationSec ?? 0;
    const initialWindow = Math.min(60, Math.max(0.01, dur));
    setViewStartSec(0);
    setViewEndSec(initialWindow);
  }, [segment.id, segment.trimRanges, segment.markers, segment.durationSec]);

  useEffect(() => {
    const eq = {
      lowDb: segment.audioEq?.lowDb ?? 0,
      midDb: segment.audioEq?.midDb ?? 0,
      highDb: segment.audioEq?.highDb ?? 0,
    };
    setAppliedAudioEq(eq);
    if (!audioEditActive) setDraftAudioEq(eq);
  }, [segment.id, segment.audioEq, audioEditActive]);

  useEffect(() => {
    if (segmentWaveformData) {
      setWaveformData(segmentWaveformData);
      return;
    }
    const dur = segment.durationSec ?? 0;
    if (!segment.waveformExists || dur <= 0) return;
    fetchSegmentWaveformsBulk(episodeId, [segment.id])
      .then(({ waveforms }) => {
        const wf = waveforms[segment.id];
        setWaveformData(wf?.data?.length ? (wf as WaveformData) : null);
      })
      .catch(() => setWaveformData(null));
  }, [episodeId, segment.id, segment.waveformExists, segment.durationSec, segmentWaveformData]);

  const MARKER_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899'] as const;

  useEffect(() => {
    if (selectedMarkerIndex == null || !markers[selectedMarkerIndex]) {
      setMarkerDraft(null);
      return;
    }
    const m = markers[selectedMarkerIndex]!;
    setMarkerDraft({
      title: m.title ?? '',
      color: m.color ?? MARKER_COLORS[0],
      markerType: (m.markerType ?? '') as '' | 'chapter',
    });
    // Only re-init when selection changes, not when markers change (preserve user's draft until Done)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMarkerIndex]);

  const trimRangesEqual = (a: Array<[number, number]>, b: Array<[number, number]>) =>
    a.length === b.length && a.every((r, i) => r[0] === b[i]![0] && r[1] === b[i]![1]);
  const markersEqual = (a: Marker[], b: Marker[]) =>
    a.length === b.length && a.every((m, i) =>
      m.time === b[i]!.time &&
      (m.title ?? '') === (b[i]!.title ?? '') &&
      (m.color ?? '') === (b[i]!.color ?? '') &&
      (m.markerType ?? '') === (b[i]!.markerType ?? ''));
  const audioEqEqual = (
    a: { lowDb: number; midDb: number; highDb: number },
    b: AudioEq | null | undefined
  ) => {
    const bl = b?.lowDb ?? 0;
    const bm = b?.midDb ?? 0;
    const bh = b?.highDb ?? 0;
    return a.lowDb === bl && a.midDb === bm && a.highDb === bh;
  };
  const hasEditUnsavedChanges =
    !trimRangesEqual(trimRanges, segment.trimRanges ?? []) ||
    !markersEqual(markers, segment.markers ?? []) ||
    !audioEqEqual(appliedAudioEq, segment.audioEq);

  const updateMutation = useMutation({
    mutationFn: (payload: {
      trimRanges?: Array<[number, number]>;
      markers?: Marker[];
      audioEq?: AudioEq | null;
    }) => updateSegment(episodeId, segment.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
    },
    onError: () => {},
  });

  function handleSave() {
    if (!hasEditUnsavedChanges) return;
    const audioEqPayload =
      appliedAudioEq.lowDb === 0 && appliedAudioEq.midDb === 0 && appliedAudioEq.highDb === 0
        ? null
        : appliedAudioEq;
    updateMutation.mutate({
      trimRanges: mergeTrimRanges(trimRanges),
      markers,
      audioEq: audioEqPayload,
    });
  }

  function ensureAudioGraph() {
    const el = segmentEditAudioRef.current;
    if (!el || audioGraphRef.current) return audioGraphRef.current;
    const Ctx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const context = new Ctx();
    const source = context.createMediaElementSource(el);
    const lowShelf = context.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 200;
    const peaking = context.createBiquadFilter();
    peaking.type = 'peaking';
    peaking.frequency.value = 1000;
    peaking.Q.value = 1;
    const highShelf = context.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 4000;
    source.connect(lowShelf);
    lowShelf.connect(peaking);
    peaking.connect(highShelf);
    highShelf.connect(context.destination);
    audioGraphRef.current = { context, source, lowShelf, peaking, highShelf };
    return audioGraphRef.current;
  }

  useEffect(() => {
    const g = audioGraphRef.current;
    if (!g) return;
    const { lowShelf, peaking, highShelf } = g;
    if (audioEditActive) {
      lowShelf.gain.value = draftAudioEq.lowDb;
      peaking.gain.value = draftAudioEq.midDb;
      highShelf.gain.value = draftAudioEq.highDb;
    } else {
      lowShelf.gain.value = appliedAudioEq.lowDb;
      peaking.gain.value = appliedAudioEq.midDb;
      highShelf.gain.value = appliedAudioEq.highDb;
    }
  }, [audioEditActive, draftAudioEq.lowDb, draftAudioEq.midDb, draftAudioEq.highDb, appliedAudioEq.lowDb, appliedAudioEq.midDb, appliedAudioEq.highDb]);

  function toggleSegmentPlay() {
    if (segment.recordFailed) return;
    const el = segmentEditAudioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      const hasAppliedEq =
        appliedAudioEq.lowDb !== 0 || appliedAudioEq.midDb !== 0 || appliedAudioEq.highDb !== 0;
      if (audioEditActive || hasAppliedEq) {
        const g = ensureAudioGraph();
        if (g) {
          g.context.resume().then(() => {});
          if (audioEditActive) {
            g.lowShelf.gain.value = draftAudioEq.lowDb;
            g.peaking.gain.value = draftAudioEq.midDb;
            g.highShelf.gain.value = draftAudioEq.highDb;
          } else {
            g.lowShelf.gain.value = appliedAudioEq.lowDb;
            g.peaking.gain.value = appliedAudioEq.midDb;
            g.highShelf.gain.value = appliedAudioEq.highDb;
          }
        }
      }
      const startAt = currentTime;
      const mediaDuration = el.duration || durationSec;
      const atEnd = mediaDuration > 0 && startAt >= mediaDuration - 0.05;
      const url = segmentStreamUrl(episodeId, segment.id, segment.audioPath);
      const applySeekAndPlay = () => {
        const seekTo = atEnd ? 0 : Math.min(startAt, mediaDuration);
        setIsPlaying(true);
        el.currentTime = seekTo;
        setCurrentTime(el.currentTime);
        el.play().catch(() => setIsPlaying(false));
      };
      const absUrl = new URL(url, window.location.origin).href;
      if (el.src === absUrl && el.readyState >= 2) {
        applySeekAndPlay();
        return;
      }
      const onCanPlay = () => {
        el.removeEventListener('canplay', onCanPlay);
        applySeekAndPlay();
      };
      el.addEventListener('canplay', onCanPlay, { once: true });
      el.src = url;
    }
  }

  function handleSeek(time: number) {
    const el = segmentEditAudioRef.current;
    if (el) {
      el.currentTime = time;
      setCurrentTime(time);
    }
  }

  function handleAddMarker(time: number) {
    const newMarkers = [...markers, { time }].sort((a, b) => a.time - b.time);
    setMarkers(newMarkers);
  }

  function handleRemoveTrimRange(index: number) {
    setTrimRanges(trimRanges.filter((_, i) => i !== index));
  }

  function handleMarkerTitleChange(_index: number, title: string) {
    setMarkerDraft((d) => (d ? { ...d, title } : null));
  }

  function handleMarkerColorChange(_index: number, color: string) {
    setMarkerDraft((d) => (d ? { ...d, color } : null));
  }

  function handleMarkerTypeChange(_index: number, markerType: '' | 'chapter') {
    setMarkerDraft((d) => (d ? { ...d, markerType: markerType } : null));
  }

  function handleMarkerDone() {
    if (selectedMarkerIndex == null || !markerDraft) {
      setSelectedMarkerIndex(null);
      setMarkerDraft(null);
      return;
    }
    const next = [...markers];
    const m = next[selectedMarkerIndex]!;
    next[selectedMarkerIndex] = {
      ...m,
      title: markerDraft.title || undefined,
      color: markerDraft.color || undefined,
      markerType: markerDraft.markerType || undefined,
    };
    setMarkers(next);
    setSelectedMarkerIndex(null);
    setMarkerDraft(null);
  }

  function handleRemoveMarker(index: number) {
    setMarkers(markers.filter((_, i) => i !== index));
    if (selectedMarkerIndex === index) {
      setSelectedMarkerIndex(null);
      setMarkerDraft(null);
    } else if (selectedMarkerIndex != null && selectedMarkerIndex > index) {
      setSelectedMarkerIndex(selectedMarkerIndex - 1);
    }
  }

  function handleViewChange(start: number, end: number) {
    setViewStartSec(start);
    setViewEndSec(end);
  }

  function handleZoomIn() {
    const playhead = currentTime;
    const win = viewEndSec - viewStartSec;
    const newWin = Math.max(1, win / 2);
    let newStart = playhead - newWin / 2;
    let newEnd = playhead + newWin / 2;
    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(newWin, durationSec);
    }
    if (newEnd > durationSec) {
      newEnd = durationSec;
      newStart = Math.max(0, durationSec - newWin);
    }
    setViewStartSec(newStart);
    setViewEndSec(newEnd);
  }

  function handleBackToStart() {
    handleSeek(0);
  }

  function handleFastForwardToggle() {
    setPlaybackRate((r) => (r === 1 ? 2 : 1));
  }

  function handleZoomOut() {
    const playhead = currentTime;
    const win = viewEndSec - viewStartSec;
    const newWin = Math.min(durationSec, win * 2);
    let newStart = playhead - newWin / 2;
    let newEnd = playhead + newWin / 2;
    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(newWin, durationSec);
    }
    if (newEnd > durationSec) {
      newEnd = durationSec;
      newStart = Math.max(0, durationSec - newWin);
    }
    setViewStartSec(newStart);
    setViewEndSec(newEnd);
  }

  return {
    segmentEditAudioRef,
    waveformData,
    isPlaying,
    currentTime,
    trimRanges,
    setTrimRanges,
    markers,
    setMarkers,
    selection,
    setSelection,
    timelineMode,
    setTimelineMode,
    selectedMarkerIndex,
    setSelectedMarkerIndex,
    viewStartSec,
    viewEndSec,
    durationSec,
    mergeTrimRanges,
    hasEditUnsavedChanges,
    handleSave,
    toggleSegmentPlay,
    handleSeek,
    handleAddMarker,
    handleRemoveTrimRange,
    handleMarkerTitleChange,
    handleMarkerColorChange,
    handleMarkerTypeChange,
    handleMarkerDone,
    handleRemoveMarker,
    markerDraft,
    handleViewChange,
    handleZoomIn,
    handleZoomOut,
    handleBackToStart,
    handleFastForwardToggle,
    playbackRate,
    updateMutation,
    appliedAudioEq,
    setAppliedAudioEq,
    draftAudioEq,
    setDraftAudioEq,
    audioEditActive,
    setAudioEditActive,
  };
}

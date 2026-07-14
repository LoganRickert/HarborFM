import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  segmentStreamUrl,
  updateSegment,
  removeSilenceFromSegment,
  applyNoiseSuppressionToSegment,
  fetchSegmentWaveformsBulk,
} from '../../api/segments';
import type { EpisodeSegment } from '../../api/segments';
import type { Marker, AudioEq } from '@harborfm/shared';
import type { WaveformData } from './WaveformCanvas';
import { Play, Pause, X, Scissors, Eraser, Volume2, MapPin, ZoomIn, ZoomOut, Move, Trash2, Check, Save, Music2 } from 'lucide-react';

const MARKER_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899'] as const;
import { RemoveMarkerConfirmDialog } from '../../components/SegmentModal/dialogs/RemoveMarkerConfirmDialog';
import * as Dialog from '@radix-ui/react-dialog';
import { TimelineWaveform, type TimelineMode } from './TimelineWaveform';
import { formatDuration } from './utils';
import styles from '../EpisodeEditor.module.css';
import sharedStyles from '../../components/PodcastDetail/shared.module.css';

export interface SegmentEditorModalProps {
  episodeId: string;
  segment: EpisodeSegment;
  waveformData?: WaveformData | null;
  onClose: () => void;
  readOnly?: boolean;
}

export function SegmentEditorModal({
  episodeId,
  segment,
  waveformData: waveformDataProp,
  onClose,
  readOnly = false,
}: SegmentEditorModalProps) {
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(waveformDataProp ?? null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimRanges, setTrimRanges] = useState<Array<[number, number]>>(segment.trimRanges ?? []);
  const [markers, setMarkers] = useState<Marker[]>(segment.markers ?? []);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('drag');
  const [selectedMarkerIndex, setSelectedMarkerIndex] = useState<number | null>(null);
  const [removingSilence, setRemovingSilence] = useState(false);
  const [applyingNoiseSuppression, setApplyingNoiseSuppression] = useState(false);
  const [removeSilenceConfirmOpen, setRemoveSilenceConfirmOpen] = useState(false);
  const [noiseSuppressionConfirmOpen, setNoiseSuppressionConfirmOpen] = useState(false);
  const [removeMarkerConfirmIndex, setRemoveMarkerConfirmIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewStartSec, setViewStartSec] = useState(0);
  const [viewEndSec, setViewEndSec] = useState(0);

  const defaultEq = (): { lowDb: number; midDb: number; highDb: number } => ({
    lowDb: segment.audioEq?.lowDb ?? 0,
    midDb: segment.audioEq?.midDb ?? 0,
    highDb: segment.audioEq?.highDb ?? 0,
  });
  const [appliedAudioEq, setAppliedAudioEq] = useState(() => defaultEq());
  const [draftAudioEq, setDraftAudioEq] = useState(() => defaultEq());
  const [audioEditActive, setAudioEditActive] = useState(false);
  const audioGraphRef = useRef<{
    context: AudioContext;
    source: MediaElementAudioSourceNode;
    lowShelf: BiquadFilterNode;
    peaking: BiquadFilterNode;
    highShelf: BiquadFilterNode;
  } | null>(null);

  const durationSec = segment.durationSec ?? 0;

  useEffect(() => {
    const initialWindow = Math.min(60, Math.max(0.01, durationSec));
    setViewStartSec(0);
    setViewEndSec(initialWindow);
  }, [segment.id, durationSec]);
  const effectiveDuration =
    trimRanges.length > 0
      ? durationSec - trimRanges.reduce((sum, [s, e]) => sum + (e - s), 0)
      : durationSec;

  useEffect(() => {
    setTrimRanges(segment.trimRanges ?? []);
    setMarkers(segment.markers ?? []);
  }, [segment.id, segment.trimRanges, segment.markers]);

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
    if (waveformDataProp) {
      setWaveformData(waveformDataProp);
      return;
    }
    if (!segment.waveformExists || durationSec <= 0) return;
    fetchSegmentWaveformsBulk(episodeId, [segment.id])
      .then(({ waveforms }) => {
        const wf = waveforms[segment.id];
        setWaveformData(wf?.data?.length ? (wf as WaveformData) : null);
      })
      .catch(() => setWaveformData(null));
  }, [episodeId, segment.id, segment.waveformExists, durationSec, waveformDataProp]);

  const updateMutation = useMutation({
    mutationFn: (payload: { trimRanges?: Array<[number, number]>; markers?: Marker[]; audioEq?: AudioEq | null }) =>
      updateSegment(episodeId, segment.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to update');
    },
  });

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      el.currentTime = 0;
      setCurrentTime(0);
    };
    const onTimeUpdate = () => {
      const t = el.currentTime;
      setCurrentTime(t);
      if (trimRanges.length > 0) {
        for (const [start, end] of trimRanges) {
          if (t >= start && t < end) {
            el.currentTime = end;
            setCurrentTime(end);
            break;
          }
        }
      }
    };
    const onLoadedMetadata = () => setCurrentTime(el.currentTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [trimRanges]);

  function ensureAudioGraph() {
    const el = audioRef.current;
    if (!el || audioGraphRef.current) return audioGraphRef.current;
    const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
      lowShelf.gain.value = 0;
      peaking.gain.value = 0;
      highShelf.gain.value = 0;
    }
  }, [audioEditActive, draftAudioEq.lowDb, draftAudioEq.midDb, draftAudioEq.highDb]);

  function togglePlay() {
    if (segment.recordFailed) return;
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      if (audioEditActive) {
        const g = ensureAudioGraph();
        if (g) {
          g.context.resume().then(() => {});
          g.lowShelf.gain.value = draftAudioEq.lowDb;
          g.peaking.gain.value = draftAudioEq.midDb;
          g.highShelf.gain.value = draftAudioEq.highDb;
        }
      }
      setIsPlaying(true);
      el.src = segmentStreamUrl(episodeId, segment.id, segment.audioPath);
      el.play().catch(() => setIsPlaying(false));
    }
  }

  function handleSeek(time: number) {
    const el = audioRef.current;
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

  function handleMarkerTitleChange(index: number, title: string) {
    const next = [...markers];
    next[index] = { ...next[index]!, title: title || undefined };
    setMarkers(next);
  }

  function handleMarkerColorChange(index: number, color: string) {
    const next = [...markers];
    next[index] = { ...next[index]!, color: color || undefined };
    setMarkers(next);
  }

  function handleMarkerTypeChange(index: number, markerType: '' | 'chapter') {
    const next = [...markers];
    next[index] = { ...next[index]!, markerType: markerType || undefined };
    setMarkers(next);
  }

  function handleRemoveMarker(index: number) {
    setMarkers(markers.filter((_, i) => i !== index));
    if (selectedMarkerIndex === index) setSelectedMarkerIndex(null);
    else if (selectedMarkerIndex != null && selectedMarkerIndex > index) setSelectedMarkerIndex(selectedMarkerIndex - 1);
  }

  const trimRangesEqual = (a: Array<[number, number]>, b: Array<[number, number]>) =>
    a.length === b.length && a.every((r, i) => r[0] === b[i]![0] && r[1] === b[i]![1]);
  const markersEqual = (a: Marker[], b: Marker[]) =>
    a.length === b.length && a.every((m, i) => m.time === b[i]!.time && (m.title ?? '') === (b[i]!.title ?? '') && (m.color ?? '') === (b[i]!.color ?? '') && (m.markerType ?? '') === (b[i]!.markerType ?? ''));
  const audioEqEqual = (a: { lowDb: number; midDb: number; highDb: number }, b: AudioEq | null | undefined) => {
    const bl = b?.lowDb ?? 0;
    const bm = b?.midDb ?? 0;
    const bh = b?.highDb ?? 0;
    return a.lowDb === bl && a.midDb === bm && a.highDb === bh;
  };
  const serverTrimRanges = segment.trimRanges ?? [];
  const serverMarkers = segment.markers ?? [];
  const hasUnsavedChanges =
    !trimRangesEqual(trimRanges, serverTrimRanges) ||
    !markersEqual(markers, serverMarkers) ||
    !audioEqEqual(appliedAudioEq, segment.audioEq);

  /** Merge overlapping or adjacent trim ranges. E.g. [[0,5],[4,10],[15,20]] to [[0,10],[15,20]]. */
  function mergeTrimRanges(ranges: Array<[number, number]>): Array<[number, number]> {
    if (ranges.length <= 1) return ranges;
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [[sorted[0]![0], sorted[0]![1]]];
    for (let i = 1; i < sorted.length; i++) {
      const [start, end] = sorted[i]!;
      const last = merged[merged.length - 1]!;
      if (start <= last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }
    }
    return merged;
  }

  function handleSave() {
    if (!hasUnsavedChanges) return;
    setError(null);
    const mergedRanges = mergeTrimRanges(trimRanges);
    const audioEqPayload =
      appliedAudioEq.lowDb === 0 && appliedAudioEq.midDb === 0 && appliedAudioEq.highDb === 0
        ? null
        : appliedAudioEq;
    updateMutation.mutate({ trimRanges: mergedRanges, markers, audioEq: audioEqPayload });
  }

  function handleTrimRangesChange(newRanges: Array<[number, number]>) {
    setTrimRanges(newRanges);
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

  function handleRemoveSilenceClick() {
    setRemoveSilenceConfirmOpen(true);
  }

  function handleRemoveSilenceConfirm() {
    setRemoveSilenceConfirmOpen(false);
    setRemovingSilence(true);
    setError(null);
    removeSilenceFromSegment(episodeId, segment.id, 1.5, -55)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
        onClose();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to remove silence'))
      .finally(() => setRemovingSilence(false));
  }

  function handleNoiseSuppressionClick() {
    setNoiseSuppressionConfirmOpen(true);
  }

  function handleNoiseSuppressionConfirm() {
    setNoiseSuppressionConfirmOpen(false);
    setApplyingNoiseSuppression(true);
    setError(null);
    applyNoiseSuppressionToSegment(episodeId, segment.id, -45)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
        onClose();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to apply noise suppression'))
      .finally(() => setApplyingNoiseSuppression(false));
  }

  const showWaveform = waveformData && waveformData.data?.length;

  return (
    <>
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.segmentEditorDialog} ${sharedStyles.dialogContentScrollable} ${sharedStyles.dialogShowDetailsGrid}`}
          aria-describedby={undefined}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              {segment.name ?? 'Segment'} - {formatDuration(effectiveDuration)}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <div className={styles.dialogBodyScroll}>
            {showWaveform ? (
            <div className={styles.segmentTimelineSection}>
              {!readOnly && (
                <div className={styles.timelineToolbarRow}>
                  <div className={styles.timelineToolbarGroup}>
                    <button
                      type="button"
                      className={`${styles.segmentBtn} ${styles.timelineToolbarModeBtn} ${timelineMode === 'drag' ? styles.timelineToolbarBtnActive : ''}`}
                      onClick={() => setTimelineMode('drag')}
                      title="Drag mode"
                      aria-pressed={timelineMode === 'drag'}
                    >
                      <Move size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={`${styles.segmentBtn} ${styles.timelineToolbarModeBtn} ${timelineMode === 'trim' ? styles.timelineToolbarBtnActive : ''}`}
                      onClick={() => setTimelineMode('trim')}
                      title="Trim mode: click to add, drag handles to adjust, click X to remove"
                      aria-pressed={timelineMode === 'trim'}
                    >
                      <Scissors size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={`${styles.segmentBtn} ${styles.timelineToolbarModeBtn} ${audioEditActive ? styles.timelineToolbarBtnActive : ''}`}
                      onClick={() => {
                        setAudioEditActive(true);
                        setDraftAudioEq(appliedAudioEq);
                      }}
                      title="Audio: adjust low, mids, and highs"
                      aria-pressed={audioEditActive}
                    >
                      <Music2 size={16} aria-hidden />
                    </button>
                  </div>
                  <div className={styles.timelineToolbarSeparator} />
                  <div className={styles.timelineToolbarGroup}>
                    <button
                      type="button"
                      className={`${styles.segmentBtn} ${styles.timelineToolbarActionBtn}`}
                      onClick={() => handleAddMarker(currentTime)}
                      disabled={durationSec <= 0}
                      title="Add marker at playhead"
                    >
                      <MapPin size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={`${styles.segmentBtn} ${styles.timelineToolbarActionBtn}`}
                      onClick={handleZoomIn}
                      disabled={viewEndSec - viewStartSec <= 1}
                      title="Zoom in"
                    >
                      <ZoomIn size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={`${styles.segmentBtn} ${styles.timelineToolbarActionBtn}`}
                      onClick={handleZoomOut}
                      disabled={viewEndSec - viewStartSec >= durationSec - 0.01}
                      title="Zoom out"
                    >
                      <ZoomOut size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              )}
              <div className={styles.segmentTimelineGrid}>
                <div />
                <div className={styles.segmentTimelineTimeRow}>
                  <span>{formatDuration(Math.floor(viewStartSec))}</span>
                  <span>{formatDuration(Math.floor(currentTime))} / {formatDuration(Math.floor(viewEndSec))}</span>
                </div>
                <div className={styles.segmentTimelinePlayBtnWrap}>
                  <button
                    type="button"
                    className={`${styles.segmentBtn} ${styles.segmentTimelinePlayBtn}`}
                    onClick={togglePlay}
                    disabled={segment.recordFailed}
                    title={segment.recordFailed ? undefined : (isPlaying ? 'Pause' : 'Play')}
                    aria-label={segment.recordFailed ? undefined : (isPlaying ? 'Pause' : 'Play')}
                  >
                    {isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
                  </button>
                </div>
                <div className={styles.segmentTimelineWrap}>
                  <TimelineWaveform
                    data={waveformData!}
                    durationSec={durationSec}
                    currentTime={currentTime}
                    viewStartSec={viewStartSec}
                    viewEndSec={viewEndSec}
                    onViewChange={readOnly ? undefined : handleViewChange}
                    trimRanges={trimRanges}
                    markers={markers}
                    selection={selection}
                    onSeek={handleSeek}
                    onPlayPause={togglePlay}
                    onTrimRangesChange={readOnly ? undefined : handleTrimRangesChange}
                    onSelectionChange={readOnly ? undefined : setSelection}
                    onAddMarker={readOnly ? undefined : handleAddMarker}
                    onRemoveTrimRange={readOnly ? undefined : handleRemoveTrimRange}
                    mode={audioEditActive ? 'drag' : timelineMode}
                    readOnly={readOnly}
                  />
                </div>
                {!readOnly && durationSec > 0 && markers.length > 0 && <div />}
                {!readOnly && durationSec > 0 && markers.length > 0 && (
                  <div className={styles.markerHandlesRow}>
                    {markers
                      .map((m, i) => ({ m, i }))
                      .filter(({ m }) => m.time >= viewStartSec && m.time <= viewEndSec)
                      .map(({ m, i }) => {
                        const left = ((m.time - viewStartSec) / (viewEndSec - viewStartSec)) * 100;
                        const color = m.color ?? MARKER_COLORS[0];
                        const isSelected = selectedMarkerIndex === i;
                        const markerType = m.markerType ?? '';
                        const shapeClass =
                          markerType === 'chapter'
                            ? styles.markerHandleChapter
                            : markerType === 'soundbite'
                              ? styles.markerHandleSoundbite
                              : '';
                        const isSoundbite = markerType === 'soundbite';
                        return (
                          <button
                            key={i}
                            type="button"
                            className={`${styles.markerHandle} ${shapeClass} ${isSelected ? styles.markerHandleSelected : ''}`}
                            style={
                              isSoundbite
                                ? {
                                    left: `${left}%`,
                                    color,
                                  }
                                : {
                                    left: `${left}%`,
                                    borderColor: color,
                                    backgroundColor: isSelected ? color : 'transparent',
                                  }
                            }
                            onClick={() => setSelectedMarkerIndex(selectedMarkerIndex === i ? null : i)}
                            title={m.title ?? `Marker at ${m.time.toFixed(1)}s`}
                            aria-pressed={selectedMarkerIndex === i}
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
                )}
              </div>
            </div>
            ) : (
              <div className={styles.segmentProgressTrack} style={{ minHeight: 48 }}>
                {durationSec > 0 ? 'Loading waveform…' : 'No waveform available'}
              </div>
            )}
            {!showWaveform && durationSec > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className={styles.segmentBtn}
                  onClick={togglePlay}
                  disabled={segment.recordFailed}
                  aria-label={isPlaying ? 'Pause segment' : 'Play segment'}
                >
                  {isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
                </button>
                <span className={styles.segmentMeta}>
                  {formatDuration(Math.floor(currentTime))} / {formatDuration(durationSec)}
                </span>
              </div>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {!readOnly && (
              <div className={styles.segmentEditorToolbar}>
                {selectedMarkerIndex != null && markers[selectedMarkerIndex] != null ? (
                  <>
                  <div className={styles.markerTitleEditRow}>
                    <input
                      type="text"
                      className={styles.input}
                      value={markers[selectedMarkerIndex]!.title ?? ''}
                      onChange={(e) => handleMarkerTitleChange(selectedMarkerIndex, e.target.value)}
                      placeholder="Marker label"
                      aria-label="Marker label"
                    />
                    <button
                      type="button"
                      className={`${styles.segmentEditorToolbarBtn} ${styles.markerDoneBtn}`}
                      onClick={() => setSelectedMarkerIndex(null)}
                      title="Done"
                      aria-label="Done"
                    >
                      <Check size={18} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={`${styles.segmentEditorToolbarBtn} ${styles.markerDeleteBtn}`}
                      onClick={() => setRemoveMarkerConfirmIndex(selectedMarkerIndex)}
                      title="Remove marker"
                      aria-label="Remove marker"
                    >
                      <Trash2 size={18} aria-hidden />
                    </button>
                  </div>
                  <div className={styles.markerColorRow}>
                    {MARKER_COLORS.map((color) => {
                      const isSelected = (markers[selectedMarkerIndex]!.color ?? MARKER_COLORS[0]) === color;
                      return (
                        <button
                          key={color}
                          type="button"
                          className={`${styles.markerColorBtn} ${isSelected ? styles.markerColorBtnSelected : ''}`}
                          style={{
                            borderColor: color,
                            backgroundColor: isSelected ? color : 'transparent',
                          }}
                          onClick={() => handleMarkerColorChange(selectedMarkerIndex, color)}
                          title={`Set marker color to ${color}`}
                          aria-label="Set marker color"
                          aria-pressed={isSelected}
                        />
                      );
                    })}
                  </div>
                  <div className={styles.markerTypeRow} role="group" aria-label="Marker type">
                    {(['', 'chapter'] as const).map((t) => (
                      <button
                        key={t || 'none'}
                        type="button"
                        className={(markers[selectedMarkerIndex]!.markerType ?? '') === t ? styles.statusToggleActive : styles.statusToggleBtn}
                        onClick={() => handleMarkerTypeChange(selectedMarkerIndex, t)}
                        aria-pressed={(markers[selectedMarkerIndex]!.markerType ?? '') === t}
                        aria-label={t === '' ? 'None' : 'Chapter'}
                      >
                        {t === '' ? 'None' : 'Chapter'}
                      </button>
                    ))}
                  </div>
                  </>
                ) : audioEditActive ? (
                  <>
                    <div className={styles.audioEqRow}>
                      <label className={styles.audioEqLabel}>
                        <span>Low</span>
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={0.5}
                          value={draftAudioEq.lowDb}
                          onChange={(e) =>
                            setDraftAudioEq((prev) => ({ ...prev, lowDb: Number(e.target.value) }))
                          }
                          aria-label="Low (bass) gain dB"
                        />
                        <span className={styles.audioEqValue}>{draftAudioEq.lowDb} dB</span>
                      </label>
                      <label className={styles.audioEqLabel}>
                        <span>Mids</span>
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={0.5}
                          value={draftAudioEq.midDb}
                          onChange={(e) =>
                            setDraftAudioEq((prev) => ({ ...prev, midDb: Number(e.target.value) }))
                          }
                          aria-label="Mids gain dB"
                        />
                        <span className={styles.audioEqValue}>{draftAudioEq.midDb} dB</span>
                      </label>
                      <label className={styles.audioEqLabel}>
                        <span>High</span>
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={0.5}
                          value={draftAudioEq.highDb}
                          onChange={(e) =>
                            setDraftAudioEq((prev) => ({ ...prev, highDb: Number(e.target.value) }))
                          }
                          aria-label="High (treble) gain dB"
                        />
                        <span className={styles.audioEqValue}>{draftAudioEq.highDb} dB</span>
                      </label>
                    </div>
                    <div className={styles.audioEqActions}>
                      <button
                        type="button"
                        className={styles.cancel}
                        onClick={() => {
                          setDraftAudioEq(appliedAudioEq);
                          setAudioEditActive(false);
                        }}
                        aria-label="Cancel audio changes"
                      >
                        Cancel
                      </button>
                      <div style={{ flex: 1 }} />
                      <button
                        type="button"
                        className={sharedStyles.dialogConfirm}
                        onClick={() => {
                          setAppliedAudioEq(draftAudioEq);
                          setAudioEditActive(false);
                        }}
                        aria-label="Apply audio EQ"
                      >
                        <Check size={18} strokeWidth={2} aria-hidden />
                        Apply
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.segmentEditorToolbarBtn}
                      onClick={handleRemoveSilenceClick}
                      disabled={removingSilence || applyingNoiseSuppression || segment.recordFailed}
                    >
                      {removingSilence ? 'Removing…' : (
                        <>
                          <Eraser size={16} aria-hidden />
                          Remove Silence
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className={styles.segmentEditorToolbarBtn}
                      onClick={handleNoiseSuppressionClick}
                      disabled={removingSilence || applyingNoiseSuppression || segment.recordFailed}
                    >
                      {applyingNoiseSuppression ? 'Applying…' : (
                        <>
                          <Volume2 size={16} aria-hidden />
                          Noise Suppression
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {!readOnly && selectedMarkerIndex == null && !audioEditActive && (
            <div className={`${sharedStyles.dialogFooter} ${sharedStyles.dialogFooterCancelLeft}`}>
              <button type="button" className={styles.cancel} onClick={onClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden />
                Close
              </button>
              <div style={{ flex: 1 }} />
              {hasUnsavedChanges && (
                <button
                  type="button"
                  className={sharedStyles.dialogConfirm}
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  aria-label="Save"
                >
                  <Save size={18} strokeWidth={2} aria-hidden />
                  {updateMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          )}
          <audio ref={audioRef} style={{ display: 'none' }} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={removeSilenceConfirmOpen} onOpenChange={(open) => !open && setRemoveSilenceConfirmOpen(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentOnModal}`}
          onEscapeKeyDown={(e) => e.stopPropagation()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Remove Silence</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description asChild>
            <div className={styles.dialogDescription}>
              Are you sure you want to remove all silence periods longer than 2 seconds? This will update the audio file.
              <div className={styles.removeSilenceNote}>This will remove all markers and trims.</div>
            </div>
          </Dialog.Description>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <button
              type="button"
              className={styles.cancel}
              onClick={() => setRemoveSilenceConfirmOpen(false)}
              aria-label="Cancel removing silence"
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={handleRemoveSilenceConfirm}
              disabled={removingSilence}
              aria-label="Confirm remove silence"
            >
              {removingSilence ? 'Removing…' : 'Confirm'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={noiseSuppressionConfirmOpen} onOpenChange={(open) => !open && setNoiseSuppressionConfirmOpen(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentOnModal}`}
          onEscapeKeyDown={(e) => e.stopPropagation()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Noise Suppression</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            Apply FFT-based noise suppression to reduce background noise? This will update the audio file. Transcript timings are unchanged.
          </Dialog.Description>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <button
              type="button"
              className={styles.cancel}
              onClick={() => setNoiseSuppressionConfirmOpen(false)}
              aria-label="Cancel noise suppression"
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={handleNoiseSuppressionConfirm}
              disabled={applyingNoiseSuppression}
              aria-label="Confirm noise suppression"
            >
              {applyingNoiseSuppression ? 'Applying…' : 'Confirm'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <RemoveMarkerConfirmDialog
      open={removeMarkerConfirmIndex != null}
      onOpenChange={(open) => !open && setRemoveMarkerConfirmIndex(null)}
      onConfirm={() => {
        if (removeMarkerConfirmIndex != null) {
          handleRemoveMarker(removeMarkerConfirmIndex);
          setRemoveMarkerConfirmIndex(null);
        }
      }}
    />
  </>
);
}

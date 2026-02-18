import { useRef, useEffect, useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { WaveformCanvas, type WaveformData } from './WaveformCanvas';
import styles from '../EpisodeEditor.module.css';

export type TimelineMode = 'drag' | 'trim';

export interface TimelineWaveformProps {
  data: WaveformData;
  durationSec: number;
  currentTime: number;
  /** Visible time window [start, end] in seconds. */
  viewStartSec: number;
  viewEndSec: number;
  onViewChange?: (viewStartSec: number, viewEndSec: number) => void;
  trimRanges: Array<[number, number]>;
  markers: Array<{ time: number; title?: string }>;
  selection: { start: number; end: number } | null;
  onSeek: (timeSec: number) => void;
  onPlayPause?: () => void;
  onTrimRangesChange?: (ranges: Array<[number, number]>) => void;
  onSelectionChange?: (selection: { start: number; end: number } | null) => void;
  onAddMarker?: (time: number) => void;
  onRemoveTrimRange?: (index: number) => void;
  mode?: TimelineMode;
  readOnly?: boolean;
  className?: string;
}

export function TimelineWaveform({
  data,
  durationSec,
  currentTime,
  viewStartSec,
  viewEndSec,
  onViewChange,
  trimRanges,
  markers,
  selection,
  onSeek,
  onPlayPause,
  onTrimRangesChange,
  onSelectionChange,
  onAddMarker,
  onRemoveTrimRange,
  mode = 'drag',
  readOnly = false,
  className,
}: TimelineWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** Set when we handled pointer up (seek or pan); prevents click from triggering a second seek. */
  const didHandlePointerRef = useRef(false);
  const draggingRef = useRef<'select' | 'trim-start' | 'trim-end' | 'pan' | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const [dragging, setDragging] = useState<'select' | 'trim-start' | 'trim-end' | 'pan' | null>(null);
  const [dragRangeIndex, setDragRangeIndex] = useState<number | null>(null);
  const [dragStartTime, setDragStartTime] = useState(0);
  const [panStartView, setPanStartView] = useState<{ start: number; end: number } | null>(null);
  const [panStartX, setPanStartX] = useState(0);

  const viewWindow = Math.max(0.01, viewEndSec - viewStartSec);

  const clientXToTime = useCallback((clientX: number): number => {
    const el = containerRef.current;
    if (!el || durationSec <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const time = viewStartSec + frac * viewWindow;
    return Math.round(time * 100) / 100;
  }, [durationSec, viewStartSec, viewWindow]);

  function timeToLeftPercent(time: number): number {
    return ((time - viewStartSec) / viewWindow) * 100;
  }

  function timeToWidthPercent(start: number, end: number): number {
    return ((end - start) / viewWindow) * 100;
  }

  const [pendingTrimStart, setPendingTrimStart] = useState<number | null>(null);
  const panHasMovedRef = useRef(false);

  function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
    if (ranges.length <= 1) return ranges;
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [[sorted[0]![0], sorted[0]![1]]];
    for (let i = 1; i < sorted.length; i++) {
      const [s, e] = sorted[i]!;
      const last = merged[merged.length - 1]!;
      if (s <= last[1]) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    return merged;
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      const el = containerRef.current;
      if (!el || durationSec <= 0) return;
      const time = clientXToTime(e.clientX);

      if (onAddMarker && e.detail === 2) {
        onAddMarker(time);
        return;
      }

      // Pan: alt/middle in any mode, or drag in drag mode (click = seek, drag = pan)
      const forcePan = onViewChange && (e.altKey || e.button === 1);
      if (forcePan || (mode === 'drag' && onViewChange)) {
        panHasMovedRef.current = false;
        setDragging('pan');
        setPanStartView({ start: viewStartSec, end: viewEndSec });
        setPanStartX(e.clientX);
        setDragStartTime(time);
        return;
      }

      if (mode === 'trim' && onTrimRangesChange && onSelectionChange && !dragging) {
        if (pendingTrimStart !== null) {
          const start = Math.min(pendingTrimStart, time);
          const end = Math.max(pendingTrimStart, time);
          if (end - start >= 0.01) {
            onTrimRangesChange(mergeRanges([...trimRanges, [start, end]]));
          }
          setPendingTrimStart(null);
          onSelectionChange(null);
          return;
        }
        setDragging('select');
        setDragStartTime(time);
        setPendingTrimStart(time);
        onSelectionChange({ start: time, end: time });
      }
    },
    [durationSec, readOnly, dragging, viewStartSec, viewEndSec, onSelectionChange, onAddMarker, onViewChange, mode, onTrimRangesChange, pendingTrimStart, trimRanges, clientXToTime]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const el = containerRef.current;
      if (!el || durationSec <= 0) return;
      const rect = el.getBoundingClientRect();
      const time = clientXToTime(e.clientX);

      if (dragging === 'pan' && panStartView && onViewChange) {
        panHasMovedRef.current = true;
        const deltaX = e.clientX - panStartX;
        const winSize = panStartView.end - panStartView.start;
        const deltaSec = (deltaX / rect.width) * winSize;
        let newStart = panStartView.start - deltaSec;
        let newEnd = panStartView.end - deltaSec;
        if (newStart < 0) {
          newStart = 0;
          newEnd = winSize;
        }
        if (newEnd > durationSec) {
          newEnd = durationSec;
          newStart = durationSec - winSize;
        }
        onViewChange(newStart, newEnd);
        return;
      }
      if (dragging === 'select' && onSelectionChange) {
        const start = Math.min(dragStartTime, time);
        const end = Math.max(dragStartTime, time);
        onSelectionChange({ start, end });
      } else if ((dragging === 'trim-start' || dragging === 'trim-end') && dragRangeIndex !== null && onTrimRangesChange) {
        const newRanges = [...trimRanges];
        const [s, end] = newRanges[dragRangeIndex]!;
        if (dragging === 'trim-start') {
          const newStart = Math.max(0, Math.min(end - 0.01, time));
          newRanges[dragRangeIndex] = [newStart, end];
        } else {
          const newEnd = Math.max(s + 0.01, Math.min(durationSec, time));
          newRanges[dragRangeIndex] = [s, newEnd];
        }
        onTrimRangesChange(newRanges);
      }
    },
    [dragging, dragRangeIndex, trimRanges, durationSec, dragStartTime, panStartView, panStartX, onSelectionChange, onTrimRangesChange, onViewChange, clientXToTime]
  );

  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);
  useEffect(() => {
    if (mode === 'drag') setPendingTrimStart(null);
  }, [mode]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  const trimRangesRef = useRef(trimRanges);
  useEffect(() => {
    trimRangesRef.current = trimRanges;
  }, [trimRanges]);

  const handlePointerUp = useCallback(() => {
    if (draggingRef.current === 'pan' && mode === 'drag') {
      if (onSeek && !panHasMovedRef.current) {
        onSeek(dragStartTime);
      }
      // Prevent click from seeking to release position after a pan (drag)
      didHandlePointerRef.current = true;
    }
    if (draggingRef.current === 'trim-start' || draggingRef.current === 'trim-end') {
      // Prevent click from deleting trim range when user was just adjusting a handle
      didHandlePointerRef.current = true;
    }
    if (
      draggingRef.current === 'select' &&
      selectionRef.current &&
      selectionRef.current.start !== selectionRef.current.end
    ) {
      if (mode === 'trim' && onTrimRangesChange && trimRangesRef.current) {
        const { start, end } = selectionRef.current;
        if (end - start >= 0.01) {
          const newRanges = [...trimRangesRef.current, [start, end] as [number, number]].sort((a, b) => a[0] - b[0]) as Array<[number, number]>;
          onTrimRangesChange(mergeRanges(newRanges));
        }
        setPendingTrimStart(null);
        onSelectionChange?.(null);
      }
      didHandlePointerRef.current = true;
    }
    setDragging(null);
    setDragRangeIndex(null);
    setPanStartView(null);
    panHasMovedRef.current = false;
  }, [mode, onSeek, onTrimRangesChange, onSelectionChange, dragStartTime]);

  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (didHandlePointerRef.current) {
      didHandlePointerRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onUp = () => handlePointerUp();
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, handlePointerUp]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onViewChange) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const playhead = currentTime;
      const factor = e.deltaY > 0 ? 1.2 : 0.8;
      let newWindow = viewWindow * factor;
      newWindow = Math.max(1, Math.min(durationSec, newWindow));
      let newStart = playhead - newWindow / 2;
      let newEnd = playhead + newWindow / 2;
      if (newStart < 0) {
        newStart = 0;
        newEnd = Math.min(newWindow, durationSec);
      }
      if (newEnd > durationSec) {
        newEnd = durationSec;
        newStart = Math.max(0, durationSec - newWindow);
      }
      onViewChange(newStart, newEnd);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewStartSec, viewWindow, durationSec, currentTime, onViewChange]);

  return (
    <div
      ref={containerRef}
      className={`${className ?? styles.waveformTrack} ${styles.timelineWaveformWrap}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClickCapture={handleClickCapture}
      style={{ touchAction: 'none' }}
    >
      <WaveformCanvas
        data={data}
        durationSec={durationSec}
        currentTime={currentTime}
        viewStartSec={viewStartSec}
        viewEndSec={viewEndSec}
        onSeek={mode === 'drag' ? onSeek : () => {}}
        onPlayPause={onPlayPause}
        className={styles.timelineWaveformBase}
      />
      {/* Trim range overlays - positioned relative to visible window */}
      {durationSec > 0 &&
        trimRanges.map(([start, end], i) => {
          if (end <= viewStartSec || start >= viewEndSec) return null;
          const visStart = Math.max(start, viewStartSec);
          const visEnd = Math.min(end, viewEndSec);
          const left = timeToLeftPercent(visStart);
          const width = timeToWidthPercent(visStart, visEnd);
          return (
            <div
              key={i}
              className={styles.timelineTrimOverlay}
              style={{
                left: `${left}%`,
                width: `${width}%`,
              }}
              onPointerDown={(e) => {
                // Let pan gestures (middle-click, alt+drag) pass through
                if (e.altKey || e.button === 1) return;
                // Let clicks on overlay body (seek/selection) pass through; only stop when clicking X or handles
                if (e.target === e.currentTarget) return;
                e.stopPropagation();
              }}
            >
              {mode === 'trim' && !readOnly && onRemoveTrimRange && (
                <button
                  type="button"
                  className={styles.timelineTrimRemoveBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveTrimRange(i);
                  }}
                  title="Remove trim"
                  aria-label="Remove trim range"
                >
                  <X size={14} strokeWidth={2.5} aria-hidden />
                </button>
              )}
              {mode === 'trim' && !readOnly && onTrimRangesChange && (
                <>
                  <div
                    className={styles.timelineTrimHandle}
                    style={{ left: 0 }}
                    onPointerDown={(e) => {
                      if (e.altKey || e.button === 1) return;
                      e.stopPropagation();
                      setDragging('trim-start');
                      setDragRangeIndex(i);
                    }}
                  />
                  <div
                    className={styles.timelineTrimHandle}
                    style={{ right: 0, left: 'auto' }}
                    onPointerDown={(e) => {
                      if (e.altKey || e.button === 1) return;
                      e.stopPropagation();
                      setDragging('trim-end');
                      setDragRangeIndex(i);
                    }}
                  />
                </>
              )}
            </div>
          );
        })}
      {/* Pending trim start (single point in trim mode) */}
      {mode === 'trim' && pendingTrimStart != null && durationSec > 0 && pendingTrimStart >= viewStartSec && pendingTrimStart <= viewEndSec && (
        <div
          className={styles.timelinePendingTrim}
          style={{ left: `${timeToLeftPercent(pendingTrimStart)}%` }}
          aria-hidden
        />
      )}
      {/* Selection overlay */}
      {selection && selection.start !== selection.end && durationSec > 0 && (
        (() => {
          if (selection.end <= viewStartSec || selection.start >= viewEndSec) return null;
          const visStart = Math.max(selection.start, viewStartSec);
          const visEnd = Math.min(selection.end, viewEndSec);
          return (
            <div
              className={styles.timelineSelectionOverlay}
              style={{
                left: `${timeToLeftPercent(visStart)}%`,
                width: `${timeToWidthPercent(visStart, visEnd)}%`,
              }}
            />
          );
        })()
      )}
      {/* Markers */}
      {durationSec > 0 &&
        markers
          .map((m, i) => (m.time >= viewStartSec && m.time <= viewEndSec ? { m, i } : null))
          .filter((x): x is { m: { time: number; title?: string; color?: string }; i: number } => x != null)
          .map(({ m, i }) => (
            <div
              key={i}
              className={styles.timelineMarker}
              style={{
                left: `${timeToLeftPercent(m.time)}%`,
                background: m.color ?? '#3b82f6',
              }}
              title={m.title ?? `Marker at ${m.time.toFixed(1)}s`}
            />
          ))}
    </div>
  );
}

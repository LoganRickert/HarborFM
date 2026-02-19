import { Play, Pause, Trash2, Scissors, MapPin, ZoomIn, ZoomOut, Move, RotateCcw, FastForward, Check } from 'lucide-react';

const MARKER_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899'] as const;
import { TimelineWaveform } from '../../../pages/EpisodeEditor/TimelineWaveform';
import { formatDuration } from '../../../pages/EpisodeEditor/utils';
import type { EpisodeSegment } from '../../../api/segments';
import type { WaveformData } from '../../../pages/EpisodeEditor/WaveformCanvas';
import styles from '../../../pages/EpisodeEditor.module.css';

export interface SegmentEditTabProps {
  segment: EpisodeSegment;
  durationSec: number;
  waveformData: WaveformData | null;
  trimRanges: Array<[number, number]>;
  markers: Array<{ time: number; title?: string; color?: string; markerType?: '' | 'chapter' }>;
  selection: { start: number; end: number } | null;
  timelineMode: 'drag' | 'trim';
  selectedMarkerIndex: number | null;
  viewStartSec: number;
  viewEndSec: number;
  isPlaying: boolean;
  currentTime: number;
  trimError: string | null;
  segmentEditAudioRef: React.RefObject<HTMLAudioElement | null>;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onViewChange: (start: number, end: number) => void;
  onTrimRangesChange: (ranges: Array<[number, number]>) => void;
  onSelectionChange: (selection: { start: number; end: number } | null) => void;
  onAddMarker: (time: number) => void;
  onRemoveTrimRange: (index: number) => void;
  onMarkerTitleChange: (index: number, title: string) => void;
  onMarkerColorChange: (index: number, color: string) => void;
  onMarkerTypeChange: (index: number, markerType: '' | 'chapter') => void;
  onMarkerDone: () => void;
  onRequestRemoveMarker: (index: number) => void;
  markerDraft: { title: string; color: string; markerType: '' | 'chapter' } | null;
  onTimelineModeChange: (mode: 'drag' | 'trim') => void;
  onSelectedMarkerIndexChange: (index: number | null) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onBackToStart: () => void;
  onFastForwardToggle: () => void;
  isFastForward: boolean;
}

export function SegmentEditTab({
  segment,
  durationSec,
  waveformData,
  trimRanges,
  markers,
  selection,
  timelineMode,
  selectedMarkerIndex,
  viewStartSec,
  viewEndSec,
  isPlaying,
  currentTime,
  trimError,
  segmentEditAudioRef,
  onTogglePlay,
  onSeek,
  onViewChange,
  onTrimRangesChange,
  onSelectionChange,
  onAddMarker,
  onRemoveTrimRange,
  onMarkerTitleChange,
  onMarkerColorChange,
  onMarkerTypeChange,
  onMarkerDone,
  onRequestRemoveMarker,
  markerDraft,
  onTimelineModeChange,
  onSelectedMarkerIndexChange,
  onZoomIn,
  onZoomOut,
  onBackToStart,
  onFastForwardToggle,
  isFastForward,
}: SegmentEditTabProps) {
  return (
    <>
      {waveformData?.data?.length ? (
        <div className={styles.segmentTimelineSection}>
          <div className={styles.timelineToolbarRow}>
            <div className={styles.timelineToolbarGroup}>
              <button
                type="button"
                className={`${styles.segmentBtn} ${styles.timelineToolbarModeBtn} ${timelineMode === 'drag' ? styles.timelineToolbarBtnActive : ''}`}
                onClick={() => onTimelineModeChange('drag')}
                title="Drag mode: click to seek, drag to pan"
                aria-label="Drag mode"
                aria-pressed={timelineMode === 'drag'}
              >
                <Move size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${styles.timelineToolbarModeBtn} ${timelineMode === 'trim' ? styles.timelineToolbarBtnActive : ''}`}
                onClick={() => onTimelineModeChange('trim')}
                title="Trim mode: click to add trim points, drag handles to adjust, click X to remove"
                aria-label="Trim mode"
                aria-pressed={timelineMode === 'trim'}
              >
                <Scissors size={16} aria-hidden />
              </button>
            </div>
            <div className={styles.timelineToolbarSeparator} />
            <div className={styles.timelineToolbarGroup}>
              <button
                type="button"
                className={`${styles.segmentBtn} ${styles.timelineToolbarActionBtn}`}
                onClick={onZoomIn}
                disabled={viewEndSec - viewStartSec <= 1}
                title="Zoom in"
                aria-label="Zoom in"
              >
                <ZoomIn size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${styles.timelineToolbarActionBtn}`}
                onClick={onZoomOut}
                disabled={viewEndSec - viewStartSec >= durationSec - 0.01}
                title="Zoom out"
                aria-label="Zoom out"
              >
                <ZoomOut size={16} aria-hidden />
              </button>
            </div>
            <div className={styles.timelineToolbarSeparator} />
            <div className={styles.timelineToolbarGroup}>
              <button
                type="button"
                className={`${styles.segmentBtn} ${styles.timelineToolbarActionBtn}`}
                onClick={() => onAddMarker(currentTime)}
                disabled={durationSec <= 0}
                title="Add marker at playhead"
                aria-label="Add marker at playhead"
              >
                <MapPin size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${styles.timelineToolbarActionBtn}`}
                onClick={onBackToStart}
                disabled={durationSec <= 0}
                title="Back to start"
                aria-label="Back to start"
              >
                <RotateCcw size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${styles.timelineToolbarActionBtn} ${isFastForward ? styles.timelineToolbarBtnActive : ''}`}
                onClick={onFastForwardToggle}
                disabled={durationSec <= 0}
                title={isFastForward ? 'Fast forward (2×) - click to return to 1×' : 'Fast forward (2×)'}
                aria-label={isFastForward ? 'Return to normal speed' : 'Fast forward 2×'}
                aria-pressed={isFastForward}
              >
                <FastForward size={16} aria-hidden />
              </button>
            </div>
          </div>
          <div className={styles.segmentTimelineGrid}>
            <div className={styles.segmentTimelineTimeRow}>
              <span>{formatDuration(Math.floor(viewStartSec))}</span>
              <span>{formatDuration(Math.floor(currentTime))} / {formatDuration(Math.floor(viewEndSec))}</span>
            </div>
            <div className={styles.segmentTimelinePlayBtnWrap}>
              <button
                type="button"
                className={`${styles.segmentBtn} ${styles.segmentTimelinePlayBtn}`}
                onClick={onTogglePlay}
                disabled={segment.recordFailed}
                title={isPlaying ? 'Pause' : 'Play'}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
              </button>
            </div>
            <div className={styles.segmentTimelineWrap}>
              <TimelineWaveform
                data={waveformData}
                durationSec={durationSec}
                currentTime={currentTime}
                viewStartSec={viewStartSec}
                viewEndSec={viewEndSec}
                onViewChange={onViewChange}
                trimRanges={trimRanges}
                markers={markers}
                selection={selection}
                onSeek={onSeek}
                onPlayPause={onTogglePlay}
                onTrimRangesChange={onTrimRangesChange}
                onSelectionChange={onSelectionChange}
                onAddMarker={onAddMarker}
                onRemoveTrimRange={onRemoveTrimRange}
                mode={timelineMode}
                readOnly={false}
              />
            </div>
            {durationSec > 0 && markers.length > 0 && (
              <div className={styles.markerHandlesRow}>
                {markers
                  .map((m, i) => ({ m, i }))
                  .filter(({ m }) => m.time >= viewStartSec && m.time <= viewEndSec)
                  .map(({ m, i }) => {
                    const left =
                      ((m.time - viewStartSec) / (viewEndSec - viewStartSec)) * 100;
                    const color = m.color ?? MARKER_COLORS[0];
                    const isSelected = selectedMarkerIndex === i;
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`${styles.markerHandle} ${
                          isSelected ? styles.markerHandleSelected : ''
                        }`}
                        style={{
                          left: `${left}%`,
                          borderColor: color,
                          backgroundColor: isSelected ? color : 'transparent',
                        }}
                        onClick={() =>
                          onSelectedMarkerIndexChange(selectedMarkerIndex === i ? null : i)
                        }
                        title={m.title ?? `Marker at ${m.time.toFixed(1)}s`}
                        aria-label={
                          m.title ? `Marker: ${m.title}` : `Marker at ${m.time.toFixed(1)}s`
                        }
                        aria-pressed={selectedMarkerIndex === i}
                      />
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
      {selectedMarkerIndex != null && markers[selectedMarkerIndex] != null && markerDraft && (
        <div className={styles.segmentEditorToolbar}>
          <div className={styles.markerTitleEditRow}>
            <input
              type="text"
              className={styles.input}
              value={markerDraft.title}
              onChange={(e) => onMarkerTitleChange(selectedMarkerIndex, e.target.value)}
              placeholder="Marker label"
              aria-label="Marker label"
            />
            <button
              type="button"
              className={`${styles.segmentEditorToolbarBtn} ${styles.markerDoneBtn}`}
              onClick={onMarkerDone}
              title="Done"
              aria-label="Done"
            >
              <Check size={18} aria-hidden className={styles.markerDoneCheck} />
            </button>
            <button
              type="button"
              className={`${styles.segmentEditorToolbarBtn} ${styles.markerDeleteBtn}`}
              onClick={() => onRequestRemoveMarker(selectedMarkerIndex)}
              title="Remove marker"
              aria-label="Remove marker"
            >
              <Trash2 size={18} aria-hidden />
            </button>
          </div>
          <div className={styles.markerColorRow}>
            {MARKER_COLORS.map((color) => {
              const isSelected = markerDraft.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  className={`${styles.markerColorBtn} ${isSelected ? styles.markerColorBtnSelected : ''}`}
                  style={{
                    borderColor: color,
                    backgroundColor: isSelected ? color : 'transparent',
                  }}
                  onClick={() => onMarkerColorChange(selectedMarkerIndex, color)}
                  title={`Set marker color to ${color}`}
                  aria-label={`Set marker color`}
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
                className={markerDraft.markerType === t ? styles.statusToggleActive : styles.statusToggleBtn}
                onClick={() => onMarkerTypeChange(selectedMarkerIndex, t)}
                aria-pressed={markerDraft.markerType === t}
                aria-label={t === '' ? 'None' : 'Chapter'}
              >
                {t === '' ? 'None' : 'Chapter'}
              </button>
            ))}
          </div>
        </div>
      )}
      {trimError && (
        <p className={styles.error} role="alert">
          {trimError}
        </p>
      )}
      <audio ref={segmentEditAudioRef} style={{ display: 'none' }} />
    </>
  );
}

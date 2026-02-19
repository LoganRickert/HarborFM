import { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, Mic, Library, Info, Trash2, Loader2, Scissors } from 'lucide-react';
import { segmentStreamUrl } from '../../api/segments';
import type { EpisodeSegment } from '../../api/segments';
import { formatDuration } from './utils';
import { WaveformCanvas, type WaveformData } from './WaveformCanvas';
import { toEffectiveTime, toActualTime, isInTrimRange } from './waveformUtils';
import styles from '../EpisodeEditor.module.css';

export interface SegmentRowProps {
  episodeId: string;
  segment: EpisodeSegment;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteRequest: () => void;
  onRecoverRequest?: () => void;
  onUpdateName: (segmentId: string, name: string | null) => void;
  isDeleting: boolean;
  isRecovering?: boolean;
  onPlayRequest: (segmentId: string) => void;
  onMoreInfo?: () => void;
  onEdit?: () => void;
  registerPause: (id: string, pause: () => void) => void;
  unregisterPause: (id: string) => void;
  readOnly?: boolean;
  /** True when recording is actively in progress (vs generating after stop). */
  isRecordingActive?: boolean;
  /** When provided (from batched parent fetch), use instead of fetching. undefined = loading, null = failed. */
  waveformData?: WaveformData | null;
}

export function SegmentRow({
  episodeId,
  segment,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onDeleteRequest,
  onRecoverRequest,
  onUpdateName,
  isDeleting,
  isRecovering = false,
  onPlayRequest,
  onMoreInfo,
  onEdit,
  registerPause,
  unregisterPause,
  readOnly = false,
  waveformData: waveformDataProp,
  isRecordingActive = false,
}: SegmentRowProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressTrackRef = useRef<HTMLDivElement>(null);
  const loadedSegmentIdRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const durationSec = segment.durationSec ?? 0;
  const isRecorded = segment.type === 'recorded';
  const recordFailed = !!segment.recordFailed;
  const inProgress = !!segment.inProgress;
  const defaultName = recordFailed
    ? 'Recording Failed'
    : isRecorded
      ? 'Recorded section'
      : (segment.assetName ?? 'Library clip');
  const [localName, setLocalName] = useState(segment.name ?? (recordFailed ? 'Recording Failed' : ''));
  const waveformData = waveformDataProp;
  const showWaveform = waveformData && waveformData.data?.length;

  useEffect(() => {
    setLocalName(segment.name ?? (recordFailed ? 'Recording Failed' : ''));
  }, [segment.name, recordFailed]);

  // Clear loaded segment when episode/segment or audio file path changes (e.g. after trim → new file)
  useEffect(() => {
    loadedSegmentIdRef.current = null;
  }, [episodeId, segment.id, segment.audioPath]);

  function handleNameBlur() {
    const trimmed = localName.trim();
    const current = (segment.name ?? '').trim();
    if (trimmed !== current) onUpdateName(segment.id, trimmed || null);
  }

  function togglePlay() {
    if (recordFailed) return;
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      onPlayRequest(segment.id);
      if (loadedSegmentIdRef.current !== segment.id) {
        loadedSegmentIdRef.current = segment.id;
        el.src = segmentStreamUrl(episodeId, segment.id, segment.audioPath);
      }
      setIsPlaying(true);
      el.play().catch(() => setIsPlaying(false));
    }
  }

  useEffect(() => {
    registerPause(segment.id, () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.currentTime = 0;
        setCurrentTime(0);
      }
    });
    return () => unregisterPause(segment.id);
  }, [segment.id, registerPause, unregisterPause]);

  const trimRanges = useMemo(() => segment.trimRanges ?? [], [segment.trimRanges]);
  const skipTrimmed = trimRanges.length > 0;
  const effectiveDurationSec = skipTrimmed
    ? durationSec - trimRanges.reduce((sum, [s, e]) => sum + (e - s), 0)
    : durationSec;

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    const track = progressTrackRef.current;
    if (!el || !track || durationSec <= 0) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    let time = trimRanges.length > 0 && effectiveDurationSec > 0
      ? toActualTime(frac * effectiveDurationSec, trimRanges, durationSec)
      : frac * durationSec;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      time = Math.min(time, el.duration);
    }
    el.currentTime = time;
    setCurrentTime(time);
  }

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
      if (skipTrimmed) {
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
  }, [durationSec, skipTrimmed, trimRanges]);

  const progress = durationSec > 0
    ? Math.min(1, skipTrimmed ? toEffectiveTime(currentTime, trimRanges) / effectiveDurationSec : currentTime / durationSec)
    : 0;

  /* In-progress (recording or generating): render same style as processing placeholder */
  if (inProgress) {
    return (
      <li className={`${styles.segmentBlock} ${styles.segmentBlockProcessing}`}>
        <div className={styles.segmentBlockTop}>
          <span className={styles.segmentIcon} title={isRecordingActive ? 'Recording' : 'Processing'}>
            <Loader2 size={18} strokeWidth={2} className={styles.segmentProcessingSpinner} aria-hidden />
          </span>
          <div className={styles.segmentBody}>
            <span className={styles.segmentName}>{isRecordingActive ? 'Recording segment' : 'Processing recording…'}</span>
            <div className={styles.segmentMeta}>{isRecordingActive ? 'Capturing audio' : 'Generating segment'}</div>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className={styles.segmentBlock}>
      <div className={styles.segmentBlockTop}>
        <span className={styles.segmentIcon} title={isRecorded ? 'Recorded' : 'From library'}>
          {isRecorded ? <Mic size={18} strokeWidth={2} aria-hidden /> : <Library size={18} strokeWidth={2} aria-hidden />}
        </span>
        {recordFailed && (
          onRecoverRequest ? (
            <button
              type="button"
              className={styles.segmentRecoverBtn}
              onClick={onRecoverRequest}
              disabled={isRecovering || readOnly}
              title="Try to recover the recording from disk"
              aria-label="Recover recording"
            >
              {isRecovering ? 'Recovering…' : 'Recover'}
            </button>
          ) : (
            <span className={styles.segmentFailedBadge} role="status">
              Recording failed
            </span>
          )
        )}
        <div className={styles.segmentBody}>
          <input
            type="text"
            className={styles.segmentNameInput}
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={handleNameBlur}
            placeholder={defaultName}
            aria-label="Section name"
            readOnly={readOnly}
          />
          <div className={styles.segmentMeta}>
            {recordFailed
              ? 'No audio captured'
              : `${formatDuration(Math.floor(skipTrimmed ? toEffectiveTime(currentTime, trimRanges) : currentTime))} / ${formatDuration(skipTrimmed ? effectiveDurationSec : segment.durationSec)}`}
          </div>
        </div>
        <audio ref={audioRef} style={{ display: 'none' }} />
        {!readOnly && (
        <div className={styles.segmentActions}>
          {onEdit && (
            <button type="button" className={styles.segmentBtn} onClick={onEdit} title="Edit timeline" aria-label="Edit segment timeline">
              <Scissors size={18} aria-hidden />
            </button>
          )}
          {onMoreInfo && (
            <button type="button" className={styles.segmentBtn} onClick={onMoreInfo} title="More info" aria-label="Show more information">
              <Info size={18} aria-hidden />
            </button>
          )}
          <button type="button" className={styles.segmentBtn} onClick={onMoveUp} disabled={index === 0} title="Move up" aria-label="Move segment up">
            ↑
          </button>
          <button type="button" className={styles.segmentBtn} onClick={onMoveDown} disabled={index === total - 1} title="Move down" aria-label="Move segment down">
            ↓
          </button>
          <button type="button" className={`${styles.segmentBtn} ${styles.segmentBtnDanger}`} onClick={onDeleteRequest} disabled={isDeleting} title="Remove" aria-label="Remove segment">
            <Trash2 size={18} aria-hidden />
          </button>
        </div>
        )}
      </div>
      {durationSec > 0 && (
        <div className={styles.segmentWaveformRow}>
          <button
            type="button"
            className={styles.segmentBtn}
            onClick={togglePlay}
            disabled={recordFailed}
            title={recordFailed ? undefined : (isPlaying ? 'Pause' : 'Play')}
            aria-label={recordFailed ? undefined : (isPlaying ? 'Pause segment' : 'Play segment')}
          >
            {isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
          </button>
          {showWaveform ? (
            <div className={styles.segmentWaveformWrap}>
              <WaveformCanvas
                data={waveformData!}
                durationSec={durationSec}
                currentTime={currentTime}
                trimRanges={trimRanges}
                onSeek={(time) => {
                  const el = audioRef.current;
                  if (el) {
                    el.currentTime = time;
                    setCurrentTime(time);
                  }
                }}
                onPlayPause={togglePlay}
                className={`${styles.waveformTrack} ${styles.segmentWaveformTrack}`}
              />
              {(segment.markers ?? [])
                .filter((m) => !skipTrimmed || !isInTrimRange(m.time, trimRanges))
                .map((m, i) => (
                  <div
                    key={`${m.time}-${i}`}
                    className={styles.timelineMarker}
                    style={{
                      left: `${durationSec > 0
                        ? (skipTrimmed
                          ? (toEffectiveTime(m.time, trimRanges) / effectiveDurationSec) * 100
                          : (m.time / durationSec) * 100)
                        : 0}%`,
                      background: m.color ?? '#3b82f6',
                    }}
                    title={m.title ?? `Marker at ${m.time.toFixed(1)}s`}
                  />
                ))}
            </div>
          ) : (
            <div
              ref={progressTrackRef}
              className={styles.segmentProgressTrack}
              onClick={handleProgressClick}
              role="progressbar"
              aria-valuenow={Math.round(currentTime)}
              aria-valuemin={0}
              aria-valuemax={durationSec}
              aria-label="Playback position"
            >
              <div className={styles.segmentProgressFill} style={{ width: `${progress * 100}%` }} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

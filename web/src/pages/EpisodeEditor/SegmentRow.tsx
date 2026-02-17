import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Mic, Library, Info, Trash2, Loader2 } from 'lucide-react';
import { segmentStreamUrl } from '../../api/segments';
import type { EpisodeSegment } from '../../api/segments';
import { formatDuration } from './utils';
import { WaveformCanvas, type WaveformData } from './WaveformCanvas';
import styles from '../EpisodeEditor.module.css';

export interface SegmentRowProps {
  episodeId: string;
  segment: EpisodeSegment;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteRequest: () => void;
  onUpdateName: (segmentId: string, name: string | null) => void;
  isDeleting: boolean;
  onPlayRequest: (segmentId: string) => void;
  onMoreInfo: () => void;
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
  onUpdateName,
  isDeleting,
  onPlayRequest,
  onMoreInfo,
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
  const durationSec = segment.duration_sec ?? 0;
  const isRecorded = segment.type === 'recorded';
  const recordFailed = !!segment.record_failed;
  const inProgress = !!segment.in_progress;
  const defaultName = isRecorded ? 'Recorded section' : (segment.asset_name ?? 'Library clip');
  const [localName, setLocalName] = useState(segment.name ?? '');
  const waveformData = waveformDataProp;
  const showWaveform = waveformData && waveformData.data?.length;

  useEffect(() => {
    setLocalName(segment.name ?? '');
  }, [segment.name]);

  // Clear loaded segment when episode/segment or audio file path changes (e.g. after trim → new file)
  useEffect(() => {
    loadedSegmentIdRef.current = null;
  }, [episodeId, segment.id, segment.audio_path]);

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
        el.src = segmentStreamUrl(episodeId, segment.id, segment.audio_path);
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

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    const track = progressTrackRef.current;
    if (!el || !track || durationSec <= 0) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    let time = frac * durationSec;
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
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
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
  }, [durationSec]);

  const progress = durationSec > 0 ? Math.min(1, currentTime / durationSec) : 0;

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
          <span className={styles.segmentFailedBadge} role="status">
            Recording failed
          </span>
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
              : `${formatDuration(Math.floor(currentTime))} / ${formatDuration(segment.duration_sec)}`}
          </div>
        </div>
        <audio ref={audioRef} style={{ display: 'none' }} />
        {!readOnly && (
        <div className={styles.segmentActions}>
          <button type="button" className={styles.segmentBtn} onClick={onMoreInfo} title="More info" aria-label="Show more information">
            <Info size={18} aria-hidden />
          </button>
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
            <WaveformCanvas
              data={waveformData!}
              durationSec={durationSec}
              currentTime={currentTime}
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

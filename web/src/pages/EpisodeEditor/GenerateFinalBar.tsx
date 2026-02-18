import { useState, useEffect, useRef } from 'react';
import { Play, Pause, FileAudio, FileText, FilePlus2, TriangleAlert } from 'lucide-react';
import { downloadEpisodeUrl, finalEpisodeWaveformUrl } from '../../api/audio';
import { WaveformCanvas, type WaveformData } from './WaveformCanvas';
import { formatDuration } from './utils';
import { ChaptersCard } from './ChaptersCard';
import styles from '../EpisodeEditor.module.css';

export interface GenerateFinalBarProps {
  episodeId: string;
  segmentCount: number;
  onBuild: () => void;
  isBuilding: boolean;
  /** When set, show this message instead of "Building..." (e.g. "A build is already in progress."). */
  buildMessage?: string | null;
  hasFinalAudio: boolean;
  finalDurationSec: number;
  /** When the final was last built (e.g. episode.updated_at). Used to bust cache so new build is played. */
  finalUpdatedAt?: string | null;
  readOnly?: boolean;
  /** Called when user starts playing the final episode (e.g. to pause any playing segment). */
  onFinalPlayStart?: () => void;
  /** Ref to register pause+reset callback (parent calls this when a segment starts playing to reset final to 0). */
  pauseAndResetRef?: React.MutableRefObject<(() => void) | null>;
  /** When true, show a Transcript button that opens the episode transcript popup. */
  hasTranscript?: boolean;
  /** Called when the user clicks the Transcript button (view existing transcript). */
  onOpenTranscript?: () => void;
  /** Called when the user clicks Generate Transcript (runs backend transcription then typically opens modal). Omit when hasTranscript. */
  onGenerateTranscript?: () => Promise<void>;
  /** Error message to show in the card (e.g. build failed, transcript generation failed). */
  error?: string | null;
  /** When false, the Generate Transcript button is disabled (grayed out). */
  canGenerateTranscript?: boolean;
  /** Chapter markers for the final waveform (from episode.final_markers). */
  finalMarkers?: Array<{ time: number; title?: string; color?: string }>;
  /** Called when user edits chapters (add/edit/delete). Parent should PATCH episode with final_markers. */
  onMarkersChange?: (markers: Array<{ time: number; title?: string; color?: string }>) => void;
}

export function GenerateFinalBar({
  episodeId,
  segmentCount,
  onBuild,
  isBuilding,
  buildMessage,
  hasFinalAudio,
  finalDurationSec,
  finalUpdatedAt,
  readOnly = false,
  onFinalPlayStart,
  pauseAndResetRef,
  hasTranscript = false,
  onOpenTranscript,
  onGenerateTranscript,
  error,
  canGenerateTranscript = true,
  finalMarkers,
  onMarkersChange,
}: GenerateFinalBarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastLoadedUrlRef = useRef<string | null>(null);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isGeneratingTranscript, setIsGeneratingTranscript] = useState(false);

  const waveformUrl =
    hasFinalAudio && episodeId
      ? `${finalEpisodeWaveformUrl(episodeId)}${finalUpdatedAt ? `?v=${encodeURIComponent(finalUpdatedAt)}` : ''}`
      : '';
  const downloadUrl =
    hasFinalAudio && episodeId
      ? `${downloadEpisodeUrl(episodeId, 'final')}${finalUpdatedAt ? `&v=${encodeURIComponent(finalUpdatedAt)}` : ''}`
      : '';

  useEffect(() => {
    lastLoadedUrlRef.current = null;
  }, [downloadUrl]);

  useEffect(() => {
    if (!hasFinalAudio || !episodeId || finalDurationSec <= 0) {
      setWaveformData(null);
      return;
    }
    let cancelled = false;
    fetch(waveformUrl, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.data?.length) setWaveformData(data as WaveformData);
        else if (!cancelled) setWaveformData(null);
      })
      .catch(() => {
        if (!cancelled) setWaveformData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId, hasFinalAudio, finalDurationSec, waveformUrl]);

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
  }, [finalDurationSec]);

  useEffect(() => {
    if (!pauseAndResetRef) return;
    pauseAndResetRef.current = () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.currentTime = 0;
        setCurrentTime(0);
      }
    };
    return () => {
      pauseAndResetRef.current = null;
    };
  }, [pauseAndResetRef]);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      onFinalPlayStart?.();
      const urlChanged = downloadUrl !== lastLoadedUrlRef.current;
      const needsLoad = !el.src || el.ended || urlChanged;
      if (needsLoad) {
        lastLoadedUrlRef.current = downloadUrl;
        el.src = downloadUrl;
        const seekTo = currentTime;
        el.addEventListener(
          'canplay',
          () => {
            el.currentTime = seekTo;
            setCurrentTime(seekTo);
            el.play().catch(() => setIsPlaying(false));
          },
          { once: true }
        );
      } else {
        el.play().catch(() => setIsPlaying(false));
      }
      setIsPlaying(true);
    }
  }

  const durationSec = finalDurationSec > 0 ? finalDurationSec : 0;

  return (
    <div className={styles.generateBar}>
      <div className={styles.generateBarHeader}>
        <h2 className={styles.generateBarTitle}>Generate Final Episode</h2>
        <p className={styles.generateBarSub}>
          Build the final MP3 from your sections. When done, you can play it here or download it for your feed.
        </p>
      </div>
      {error && (
        <p className={styles.error} style={{ marginTop: 0, marginBottom: '1.25rem' }} role="alert">{error}</p>
      )}
      {hasFinalAudio && durationSec > 0 && (
        <div className={styles.generateBarPlayback}>
          <div />
          <div className={styles.generateBarTime} aria-live="polite">
            {formatDuration(Math.floor(currentTime))} / {formatDuration(Math.floor(durationSec))}
          </div>
          <button
            type="button"
            className={styles.segmentBtn}
            onClick={togglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause final episode' : 'Play final episode'}
          >
            {isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
          </button>
          {waveformData ? (
            <WaveformCanvas
              data={waveformData}
              durationSec={durationSec}
              currentTime={currentTime}
              markers={finalMarkers ?? []}
              onSeek={(time) => {
                const el = audioRef.current;
                if (el) {
                  el.currentTime = time;
                  setCurrentTime(time);
                }
              }}
              className={styles.generateBarWaveform}
            />
          ) : (
            <div className={styles.generateBarProgressPlaceholder} />
          )}
        </div>
      )}
      <audio ref={audioRef} style={{ display: 'none' }} />
      <div className={styles.generateBarInner}>
        <div className={styles.generateBarActionsWrap}>
          {buildMessage && (
            <div className={styles.generateBarBuildNotice} role="status">
              <TriangleAlert size={18} strokeWidth={2} aria-hidden className={styles.generateBarBuildNoticeIcon} />
              <span>{buildMessage}</span>
            </div>
          )}
          <div className={styles.generateBarActions}>
          <button
            type="button"
            className={styles.renderBtnPrimary}
            onClick={onBuild}
            disabled={segmentCount === 0 || isBuilding || readOnly}
            title={readOnly ? 'Read-only account' : undefined}
            aria-label={readOnly ? 'Make Final Episode (read-only)' : isBuilding ? 'Building...' : 'Make Final Episode'}
          >
            <FileAudio size={20} strokeWidth={2} aria-hidden />
            <span>{isBuilding ? 'Building...' : 'Make Final Episode'}</span>
          </button>
          {((hasTranscript && onOpenTranscript) || (!hasTranscript && (hasFinalAudio && !isBuilding) && (onGenerateTranscript || onOpenTranscript))) && (
            <button
              type="button"
              className={hasTranscript ? styles.generateBarTranscriptBtn : styles.generateBarGenerateTranscriptBtn}
              onClick={hasTranscript ? onOpenTranscript : async () => {
                if (onGenerateTranscript && canGenerateTranscript) {
                  setIsGeneratingTranscript(true);
                  try {
                    await onGenerateTranscript();
                  } finally {
                    setIsGeneratingTranscript(false);
                  }
                } else if (onOpenTranscript) {
                  onOpenTranscript();
                }
              }}
              disabled={isBuilding || (!hasTranscript && onGenerateTranscript && (isGeneratingTranscript || !canGenerateTranscript))}
              title={
                isBuilding
                  ? 'Transcript available after build finishes'
                  : hasTranscript
                    ? 'View Episode Transcript'
                    : isGeneratingTranscript
                      ? 'Generating transcript…'
                      : onGenerateTranscript
                        ? 'Generate transcript from final audio'
                        : 'Upload your own SRT transcript'
              }
              aria-label={
                isBuilding
                  ? 'Transcript (disabled while building)'
                  : hasTranscript
                    ? 'View Episode Transcript'
                    : isGeneratingTranscript
                      ? 'Generating transcript'
                      : onGenerateTranscript
                        ? 'Generate Transcript'
                        : 'Upload Transcript'
              }
            >
              {hasTranscript ? (
                <>
                  <FileText size={18} strokeWidth={2} aria-hidden />
                  <span>Transcript</span>
                </>
              ) : (
                <>
                  <FilePlus2 size={18} strokeWidth={2} aria-hidden />
                  <span>
                    {isGeneratingTranscript ? 'Generating…' : onGenerateTranscript ? 'Generate Transcript' : 'Upload Transcript'}
                  </span>
                </>
              )}
            </button>
          )}
          {hasFinalAudio && downloadUrl && !isBuilding && (
            <a href={downloadUrl} download className={styles.renderDownload}>
              Download Final Audio
            </a>
          )}
          </div>
        </div>
      </div>
      <ChaptersCard
        markers={finalMarkers ?? []}
        onMarkersChange={(m) => onMarkersChange?.(m)}
        onSeekTo={(time) => {
          const el = audioRef.current;
          if (!el || !downloadUrl) return;
          onFinalPlayStart?.();
          const urlChanged = downloadUrl !== lastLoadedUrlRef.current;
          const needsLoad = !el.src || el.ended || urlChanged;
          if (needsLoad) {
            lastLoadedUrlRef.current = downloadUrl;
            el.src = downloadUrl;
            el.addEventListener(
              'canplay',
              () => {
                el.currentTime = time;
                setCurrentTime(time);
                el.play().catch(() => setIsPlaying(false));
              },
              { once: true }
            );
          } else {
            el.currentTime = time;
            setCurrentTime(time);
            el.play().catch(() => setIsPlaying(false));
          }
        }}
        canEdit={!readOnly && !!onMarkersChange}
        hasFinalAudio={hasFinalAudio}
        finalDurationSec={finalDurationSec}
      />
    </div>
  );
}

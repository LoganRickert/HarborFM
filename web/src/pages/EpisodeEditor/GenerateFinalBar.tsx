import { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  FileAudio,
  FileText,
  FilePlus2,
  TriangleAlert,
  Video,
  Download,
  List,
} from 'lucide-react';
import { downloadEpisodeUrl, finalEpisodeWaveformUrl } from '../../api/audio';
import { FeedVideoPlayer } from '../../components/Feed/FeedVideoPlayer';
import { WaveformCanvas, type WaveformData } from './WaveformCanvas';
import { formatDuration } from './utils';
import { ChaptersCard } from './ChaptersCard';
import { CollapsiblePublishPanel } from './CollapsiblePublishPanel';
import { ActionTile } from './ActionTile';
import type { PublishFormFields } from './EpisodePublishControls';
import styles from '../EpisodeEditor.module.css';

export interface GenerateFinalBarProps {
  episodeId: string;
  segmentCount: number;
  onBuild: () => void;
  isBuilding: boolean;
  buildMessage?: string | null;
  hasFinalAudio: boolean;
  finalDurationSec: number;
  finalUpdatedAt?: string | null;
  readOnly?: boolean;
  metadataReadOnly?: boolean;
  publishValues: PublishFormFields;
  onPublishSave: (values: PublishFormFields) => void | Promise<void>;
  publishSaving?: boolean;
  publishSaveError?: string | null;
  onFinalPlayStart?: () => void;
  pauseAndResetRef?: React.MutableRefObject<(() => void) | null>;
  hasTranscript?: boolean;
  onOpenTranscript?: () => void;
  onGenerateTranscript?: () => Promise<void>;
  error?: string | null;
  canGenerateTranscript?: boolean;
  finalMarkers?: Array<{ time: number; title?: string; color?: string }>;
  onMarkersChange?: (markers: Array<{ time: number; title?: string; color?: string }>) => void;
  hasVideo?: boolean;
  isGeneratingVideo?: boolean;
  onOpenGenerateVideo?: () => void;
  downloadVideoUrl?: string;
  videoPosterUrl?: string | null;
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
  metadataReadOnly = false,
  publishValues,
  onPublishSave,
  publishSaving = false,
  publishSaveError,
  onFinalPlayStart,
  pauseAndResetRef,
  hasTranscript = false,
  onOpenTranscript,
  onGenerateTranscript,
  error,
  canGenerateTranscript = true,
  finalMarkers,
  onMarkersChange,
  hasVideo = false,
  isGeneratingVideo = false,
  onOpenGenerateVideo,
  downloadVideoUrl,
  videoPosterUrl,
}: GenerateFinalBarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastLoadedUrlRef = useRef<string | null>(null);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isGeneratingTranscript, setIsGeneratingTranscript] = useState(false);
  const [chaptersExpanded, setChaptersExpanded] = useState(false);

  const waveformCacheKey = finalUpdatedAt ?? episodeId ?? '';
  const waveformUrl =
    hasFinalAudio && episodeId
      ? `${finalEpisodeWaveformUrl(episodeId)}?v=${encodeURIComponent(waveformCacheKey)}`
      : '';
  const downloadUrl =
    hasFinalAudio && episodeId
      ? `${downloadEpisodeUrl(episodeId, 'final')}&v=${encodeURIComponent(waveformCacheKey)}`
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

  function seekAndPlay(time: number) {
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
  }

  async function handleTranscriptClick() {
    if (hasTranscript && onOpenTranscript) {
      onOpenTranscript();
      return;
    }
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
  }

  const durationSec = finalDurationSec > 0 ? finalDurationSec : 0;
  const chapterCount = finalMarkers?.length ?? 0;
  const showTranscriptTile =
    (hasTranscript && onOpenTranscript) ||
    (!hasTranscript && hasFinalAudio && !isBuilding && (onGenerateTranscript || onOpenTranscript));
  const showVideoTile = hasFinalAudio && onOpenGenerateVideo && !readOnly;
  const showDownloadMp3 = hasFinalAudio && downloadUrl && !isBuilding;
  const showDownloadVideo = hasVideo && downloadVideoUrl && !isGeneratingVideo;
  const showVideoPlayer = showDownloadVideo;

  return (
    <div className={styles.generateBar}>
      <div className={styles.generateBarTop}>
        <h2 className={styles.generateBarTitle}>
          {hasFinalAudio ? 'Final Episode' : 'Build Final Episode'}
        </h2>
      </div>

      <CollapsiblePublishPanel
        savedValues={publishValues}
        readOnly={metadataReadOnly}
        onSave={onPublishSave}
        isSaving={publishSaving}
        saveError={publishSaveError}
      />

      {(error || buildMessage) && (
        <div className={styles.generateBarAlerts}>
          {buildMessage && (
            <div className={styles.generateBarBuildNotice} role="status">
              <TriangleAlert size={16} strokeWidth={2} aria-hidden className={styles.generateBarBuildNoticeIcon} />
              <span>{buildMessage}</span>
            </div>
          )}
          {error && (
            <p className={styles.error} role="alert" style={{ margin: 0 }}>{error}</p>
          )}
        </div>
      )}

      {showVideoPlayer && (
        <div className={styles.generateBarVideoWrap}>
          <FeedVideoPlayer
            src={downloadVideoUrl}
            poster={videoPosterUrl ?? undefined}
            ariaLabel="Episode video"
            className={styles.generateBarVideoEmbed}
          />
        </div>
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

      <div className={styles.generateBarActionGrid}>
        <ActionTile
          icon={<FileAudio size={22} strokeWidth={1.75} aria-hidden />}
          label={isBuilding ? 'Building…' : hasFinalAudio ? 'Rebuild' : 'Build'}
          color="teal"
          onClick={onBuild}
          disabled={segmentCount === 0 || isBuilding || readOnly}
          infoText="Stitch all enabled sections into one MP3 for your podcast feed."
        />
        {showTranscriptTile && (
          <ActionTile
            icon={
              hasTranscript ? (
                <FileText size={22} strokeWidth={1.75} aria-hidden />
              ) : (
                <FilePlus2 size={22} strokeWidth={1.75} aria-hidden />
              )
            }
            label={
              hasTranscript
                ? 'View Transcript'
                : isGeneratingTranscript
                  ? 'Generating…'
                  : onGenerateTranscript
                    ? 'Generate Transcript'
                    : 'Add Transcript'
            }
            color="blue"
            onClick={handleTranscriptClick}
            disabled={
              isBuilding ||
              (!hasTranscript && !!onGenerateTranscript && (isGeneratingTranscript || !canGenerateTranscript))
            }
            infoText={
              onGenerateTranscript
                ? 'Generate a transcript from your final audio, or upload your own SRT file.'
                : 'Upload an SRT transcript for your episode.'
            }
          />
        )}
        {showVideoTile && (
          <ActionTile
            icon={<Video size={22} strokeWidth={1.75} aria-hidden />}
            label={isGeneratingVideo ? 'Generating…' : hasVideo ? 'Regenerate Video' : 'Generate Video'}
            color="purple"
            onClick={() => onOpenGenerateVideo?.()}
            disabled={isBuilding || isGeneratingVideo}
            infoText="Generate a shareable video with a spectrum visualizer over your episode audio."
          />
        )}
        <ActionTile
          icon={<List size={22} strokeWidth={1.75} aria-hidden />}
          label="Chapters"
          sublabel={
            chapterCount > 0
              ? `${chapterCount} chapter${chapterCount === 1 ? '' : 's'}`
              : undefined
          }
          color="amber"
          onClick={() => setChaptersExpanded((e) => !e)}
          active={chaptersExpanded}
          disabled={!hasFinalAudio}
          infoText="Add chapter markers so listeners can skip to sections in podcast apps."
        />
        {showDownloadMp3 && (
          <ActionTile
            icon={<Download size={22} strokeWidth={1.75} aria-hidden />}
            label="Download MP3"
            color="green"
            href={downloadUrl}
            download
            infoText="Download the final stitched MP3 file."
          />
        )}
        {showDownloadVideo && (
          <ActionTile
            icon={<Download size={22} strokeWidth={1.75} aria-hidden />}
            label="Download Video"
            color="slate"
            href={downloadVideoUrl}
            download
            infoText="Download the generated video file."
          />
        )}
      </div>

      <ChaptersCard
        markers={finalMarkers ?? []}
        onMarkersChange={(m) => onMarkersChange?.(m)}
        onSeekTo={seekAndPlay}
        canEdit={!readOnly && !!onMarkersChange}
        hasFinalAudio={hasFinalAudio}
        finalDurationSec={finalDurationSec}
        expanded={chaptersExpanded}
        onExpandedChange={setChaptersExpanded}
        hideHeader
      />
    </div>
  );
}

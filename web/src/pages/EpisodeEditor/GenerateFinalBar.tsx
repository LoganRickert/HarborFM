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
  AudioLines,
  BarChart3,
  FolderArchive,
} from 'lucide-react';
import { downloadEpisodeUrl, downloadProjectUrl, finalEpisodeWaveformUrl } from '../../api/audio';
import { FeedVideoPlayer } from '../../components/Feed/FeedVideoPlayer';
import { WaveformCanvas, type WaveformData } from './WaveformCanvas';
import { formatDuration } from './utils';
import { ChaptersCard } from './ChaptersCard';
import { SoundbitesCard } from './SoundbitesCard';
import { PollsDialog } from './PollsDialog';
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
  finalSoundbites?: Array<{ time: number; duration: number; title?: string; color?: string }>;
  onSoundbitesChange?: (
    soundbites: Array<{ time: number; duration: number; title?: string; color?: string }>,
  ) => void;
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
  finalSoundbites,
  onSoundbitesChange,
  hasVideo = false,
  isGeneratingVideo = false,
  onOpenGenerateVideo,
  downloadVideoUrl,
  videoPosterUrl,
}: GenerateFinalBarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastLoadedUrlRef = useRef<string | null>(null);
  const soundbiteAutoPauseRef = useRef<{ end: number } | null>(null);
  const programmaticSeekRef = useRef(false);
  const autoPausingRef = useRef(false);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isGeneratingTranscript, setIsGeneratingTranscript] = useState(false);
  const [chaptersExpanded, setChaptersExpanded] = useState(false);
  const [soundbitesExpanded, setSoundbitesExpanded] = useState(false);
  const [pollsOpen, setPollsOpen] = useState(false);

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
    const cancelSoundbiteAutoPause = () => {
      soundbiteAutoPauseRef.current = null;
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      setIsPlaying(false);
      if (!autoPausingRef.current) {
        cancelSoundbiteAutoPause();
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      el.currentTime = 0;
      setCurrentTime(0);
      cancelSoundbiteAutoPause();
    };
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      const session = soundbiteAutoPauseRef.current;
      if (session && el.currentTime >= session.end - 0.05) {
        autoPausingRef.current = true;
        cancelSoundbiteAutoPause();
        el.pause();
        autoPausingRef.current = false;
      }
    };
    const onLoadedMetadata = () => setCurrentTime(el.currentTime);
    const onSeeking = () => {
      if (programmaticSeekRef.current) return;
      cancelSoundbiteAutoPause();
    };
    const onSeeked = () => {
      programmaticSeekRef.current = false;
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('seeking', onSeeking);
    el.addEventListener('seeked', onSeeked);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('seeking', onSeeking);
      el.removeEventListener('seeked', onSeeked);
    };
  }, [finalDurationSec]);

  useEffect(() => {
    if (!pauseAndResetRef) return;
    pauseAndResetRef.current = () => {
      const el = audioRef.current;
      if (el) {
        soundbiteAutoPauseRef.current = null;
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
      soundbiteAutoPauseRef.current = null;
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

  function seekAndPlay(time: number, opts?: { soundbiteDurationSec?: number }) {
    const el = audioRef.current;
    if (!el || !downloadUrl) return;
    onFinalPlayStart?.();
    if (opts?.soundbiteDurationSec != null && opts.soundbiteDurationSec > 0) {
      soundbiteAutoPauseRef.current = { end: time + opts.soundbiteDurationSec };
    } else {
      soundbiteAutoPauseRef.current = null;
    }
    programmaticSeekRef.current = true;
    const urlChanged = downloadUrl !== lastLoadedUrlRef.current;
    const needsLoad = !el.src || el.ended || urlChanged;
    if (needsLoad) {
      lastLoadedUrlRef.current = downloadUrl;
      el.src = downloadUrl;
      el.addEventListener(
        'canplay',
        () => {
          programmaticSeekRef.current = true;
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

  function seekAndPlaySoundbite(time: number, duration: number) {
    seekAndPlay(time, { soundbiteDurationSec: duration });
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
  const soundbiteCount = finalSoundbites?.length ?? 0;
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
        hasFinalAudio={hasFinalAudio}
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
          onClick={() => {
            setChaptersExpanded((e) => !e);
            if (!chaptersExpanded) setSoundbitesExpanded(false);
          }}
          active={chaptersExpanded}
          disabled={!hasFinalAudio}
          infoText="Add chapter markers so listeners can skip to sections in podcast apps."
        />
        <ActionTile
          icon={<AudioLines size={22} strokeWidth={1.75} aria-hidden />}
          label="Soundbites"
          sublabel={
            soundbiteCount > 0
              ? `${soundbiteCount} soundbite${soundbiteCount === 1 ? '' : 's'}`
              : undefined
          }
          color="cyan"
          onClick={() => {
            setSoundbitesExpanded((e) => !e);
            if (!soundbitesExpanded) setChaptersExpanded(false);
          }}
          active={soundbitesExpanded}
          disabled={!hasFinalAudio}
          infoText="Highlight short clips (15–120s) for podcast apps that support Podcast 2.0 soundbites."
        />
        <ActionTile
          icon={<BarChart3 size={22} strokeWidth={1.75} aria-hidden />}
          label="Polls"
          color="slate"
          onClick={() => setPollsOpen(true)}
          active={pollsOpen}
          disabled={metadataReadOnly && !pollsOpen}
          infoText="Create a listener poll for this episode. Poll data is kept when you rebuild."
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
        {episodeId && !readOnly && (
          <ActionTile
            icon={<FolderArchive size={22} strokeWidth={1.75} aria-hidden />}
            label="Download Project"
            color="slate"
            href={downloadProjectUrl(episodeId)}
            download
            infoText="Download a zip of this episode (segments, finals, multitrack recordings) to archive or import later."
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
        playheadTimeSec={currentTime}
        expanded={chaptersExpanded}
        onExpandedChange={setChaptersExpanded}
        hideHeader
      />
      <SoundbitesCard
        episodeId={episodeId}
        soundbites={finalSoundbites ?? []}
        onSoundbitesChange={(s) => onSoundbitesChange?.(s)}
        onSeekTo={seekAndPlaySoundbite}
        canEdit={!readOnly && !!onSoundbitesChange}
        hasFinalAudio={hasFinalAudio}
        finalDurationSec={finalDurationSec}
        playheadTimeSec={currentTime}
        expanded={soundbitesExpanded}
        onExpandedChange={setSoundbitesExpanded}
        hideHeader
      />
      <PollsDialog
        episodeId={episodeId}
        open={pollsOpen}
        onOpenChange={setPollsOpen}
        readOnly={metadataReadOnly || readOnly}
      />
    </div>
  );
}

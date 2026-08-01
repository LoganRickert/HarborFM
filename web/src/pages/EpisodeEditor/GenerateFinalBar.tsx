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
  Archive,
  FolderArchive,
  HardDriveUpload,
  Paperclip,
  Images,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  downloadEpisodeUrl,
  downloadProjectUrl,
  finalEpisodeWaveformUrl,
  getProjectExportStatus,
  startProjectExport,
} from '../../api/audio';
import { PleaseWaitDialog } from '../../components/PleaseWaitDialog';
import { FeedVideoPlayer } from '../../components/Feed/FeedVideoPlayer';
import { downloadAuthenticatedBlob, pollUntil } from '../../utils/projectZipTransfer';
import { WaveformCanvas, type WaveformData } from './WaveformCanvas';
import { formatDuration } from './utils';
import { ChaptersCard } from './ChaptersCard';
import { SoundbitesCard } from './SoundbitesCard';
import { PollsDialog } from './PollsDialog';
import { EpisodeFilesDialog } from './EpisodeFilesDialog';
import { DownloadThumbnailsDialog } from './DownloadThumbnailsDialog';
import { CollapsiblePublishPanel } from './CollapsiblePublishPanel';
import { ActionTile } from './ActionTile';
import { EpisodeBackupDialog } from './EpisodeBackupDialog';
import type { PublishFormFields } from './EpisodePublishControls';
import styles from '../EpisodeEditor.module.css';

export interface GenerateFinalBarProps {
  episodeId: string;
  podcastId?: string;
  episodeTitle?: string;
  podcastCoverUrl?: string | null;
  /** When false, Episode Files tile is shown disabled with a permissions info tip. */
  canUploadEpisodeFiles?: boolean;
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
  /** Public episode URL when scheduled or published. */
  episodeUrl?: string | null;
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
  /** Episode project has been archived to remote storage. */
  isArchived?: boolean;
  /** Show has archive settings configured. */
  archiveConfigured?: boolean;
  onArchive?: () => void | Promise<void>;
  isArchiving?: boolean;
  archiveError?: string | null;
  onClearArchiveError?: () => void;
}

export function GenerateFinalBar({
  episodeId,
  podcastId,
  episodeTitle = '',
  podcastCoverUrl = null,
  canUploadEpisodeFiles = false,
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
  episodeUrl,
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
  isArchived = false,
  archiveConfigured = false,
  onArchive,
  isArchiving = false,
  archiveError = null,
  onClearArchiveError,
}: GenerateFinalBarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastLoadedUrlRef = useRef<string | null>(null);
  const soundbiteAutoPauseRef = useRef<{ end: number } | null>(null);
  const programmaticSeekRef = useRef(false);
  const autoPausingRef = useRef(false);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [projectExportOpen, setProjectExportOpen] = useState(false);
  const [projectExportError, setProjectExportError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isGeneratingTranscript, setIsGeneratingTranscript] = useState(false);
  const [chaptersExpanded, setChaptersExpanded] = useState(false);
  const [soundbitesExpanded, setSoundbitesExpanded] = useState(false);
  const [pollsOpen, setPollsOpen] = useState(false);
  const [episodeFilesOpen, setEpisodeFilesOpen] = useState(false);
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveWaitOpen, setArchiveWaitOpen] = useState(false);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);

  useEffect(() => {
    if (isArchiving) setArchiveWaitOpen(true);
    else if (!archiveError) setArchiveWaitOpen(false);
  }, [isArchiving, archiveError]);

  useEffect(() => {
    if (archiveError) setArchiveWaitOpen(true);
  }, [archiveError]);

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
    if (readOnly) return;
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

  async function handleDownloadProject() {
    if (projectExportOpen) return;
    setProjectExportError(null);
    setProjectExportOpen(true);
    try {
      await startProjectExport(episodeId);
      await pollUntil(() => getProjectExportStatus(episodeId), {
        pendingStatuses: ['building'],
        successStatuses: ['ready', 'idle'],
      });
      await downloadAuthenticatedBlob(downloadProjectUrl(episodeId), 'project.zip');
      setProjectExportOpen(false);
    } catch (err) {
      setProjectExportError(err instanceof Error ? err.message : 'Failed to prepare download');
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
        episodeUrl={episodeUrl}
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
          disabled={segmentCount === 0 || isBuilding || readOnly || isArchived}
          infoText={
            isArchived
              ? 'Restore the project before building again.'
              : 'Stitch all enabled sections into one MP3 for your podcast feed.'
          }
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
              (!hasTranscript &&
                (readOnly ||
                  (!!onGenerateTranscript &&
                    (isGeneratingTranscript || !canGenerateTranscript))))
            }
            infoText={
              !hasTranscript && readOnly
                ? 'Read-only accounts cannot generate or upload transcripts.'
                : onGenerateTranscript
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
        <ActionTile
          icon={<Paperclip size={22} strokeWidth={1.75} aria-hidden />}
          label="Episode Files"
          color="slate"
          onClick={() => setEpisodeFilesOpen(true)}
          active={episodeFilesOpen}
          disabled={
            !canUploadEpisodeFiles || (metadataReadOnly && !episodeFilesOpen)
          }
          infoText={
            canUploadEpisodeFiles
              ? 'Upload files or add links for listeners. Shown on the public episode page.'
              : 'You need Episode Files permission to use this. Ask an admin to enable Can Upload Episode Files on your account.'
          }
        />
        {podcastId && (
          <ActionTile
            icon={<Images size={22} strokeWidth={1.75} aria-hidden />}
            label="Download Thumbnails"
            color="amber"
            onClick={() => setThumbnailsOpen(true)}
            active={thumbnailsOpen}
            infoText="Generate landscape, portrait, or square episode thumbnails from the podcast cover and cast photos."
          />
        )}
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
            onClick={() => void handleDownloadProject()}
            disabled={isArchived || (projectExportOpen && !projectExportError)}
            infoText={
              isArchived
                ? 'Restore the project before downloading.'
                : 'Download a zip of this episode (segments, finals, multitrack recordings) to archive or import later.'
            }
          />
        )}
        {episodeId && !readOnly && archiveConfigured && (
          <ActionTile
            icon={<HardDriveUpload size={22} strokeWidth={1.75} aria-hidden />}
            label="Backup"
            color="slate"
            onClick={() => setBackupDialogOpen(true)}
            disabled={isArchiving || isArchived || !hasFinalAudio}
            infoText={
              isArchived
                ? 'Restore the project before backing up.'
                : !hasFinalAudio
                  ? 'Build the final episode before backing up.'
                  : 'Upload a project zip to the archive destination, or restore from a previous backup.'
            }
          />
        )}
        {episodeId && !readOnly && !isArchived && (
          <ActionTile
            icon={<Archive size={22} strokeWidth={1.75} aria-hidden />}
            label={isArchiving ? 'Archiving...' : 'Archive'}
            color="slate"
            onClick={() => setArchiveConfirmOpen(true)}
            disabled={isArchiving || !hasFinalAudio || !archiveConfigured}
            infoText={
              !archiveConfigured
                ? 'Configure Archive Settings on the show page first.'
                : !hasFinalAudio
                  ? 'Build the final episode before archiving.'
                  : 'Upload a project zip to the archive destination and free local project files. The feed keeps serving the final audio.'
            }
          />
        )}
      </div>

      {episodeId ? (
        <EpisodeBackupDialog
          open={backupDialogOpen}
          onOpenChange={setBackupDialogOpen}
          episodeId={episodeId}
          hasFinalAudio={hasFinalAudio}
          readOnly={readOnly}
        />
      ) : null}

      <PleaseWaitDialog
        open={projectExportOpen}
        title="Please wait"
        description="Preparing your download..."
        error={projectExportError}
        errorTitle="Download failed"
        onDismiss={() => {
          setProjectExportOpen(false);
          setProjectExportError(null);
        }}
      />

      <PleaseWaitDialog
        open={archiveWaitOpen}
        title="Please wait"
        description="Creating and uploading the archive..."
        error={archiveError}
        errorTitle="Archive failed"
        onDismiss={() => {
          setArchiveWaitOpen(false);
          onClearArchiveError?.();
        }}
      />

      <Dialog.Root open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Archive this episode?</Dialog.Title>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                onClick={() => setArchiveConfirmOpen(false)}
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              HarborFM will zip this project, upload it to your archive destination, verify the
              upload, then remove local segment and recording files. Final audio and other
              feed-serving files stay so listeners are unaffected. You can restore the project
              later.
            </Dialog.Description>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.cancel}
                onClick={() => setArchiveConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.submit}
                onClick={() => {
                  setArchiveConfirmOpen(false);
                  void onArchive?.();
                }}
              >
                Archive
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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
      {canUploadEpisodeFiles && (
        <EpisodeFilesDialog
          episodeId={episodeId}
          open={episodeFilesOpen}
          onOpenChange={setEpisodeFilesOpen}
          readOnly={metadataReadOnly || readOnly}
        />
      )}
      {podcastId && (
        <DownloadThumbnailsDialog
          open={thumbnailsOpen}
          onOpenChange={setThumbnailsOpen}
          podcastId={podcastId}
          episodeId={episodeId}
          episodeTitle={episodeTitle}
          podcastCoverUrl={podcastCoverUrl}
        />
      )}
    </div>
  );
}

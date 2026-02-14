import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Breadcrumb } from '../../components/Breadcrumb';
import { useAuthStore } from '../../store/auth';
import { me, canRecordNewSection, isReadOnly, RECORD_BLOCKED_STORAGE_MESSAGE } from '../../api/auth';
import { updateEpisode, uploadEpisodeArtwork } from '../../api/episodes';
import {
  addRecordedSegment,
  addReusableSegment,
  reorderSegments,
  deleteSegment,
  updateSegment,
  startRenderEpisode,
  getRenderStatus,
  type EpisodeSegment,
} from '../../api/segments';
import { episodeToForm, formToApiPayload } from './utils';
import { EpisodeDetailsSummaryCard } from './EpisodeDetailsSummaryCard';
import { EpisodeDetailsForm } from './EpisodeDetailsForm';
import { GenerateFinalBar } from './GenerateFinalBar';
import { EpisodeCastCard } from './EpisodeCastCard';
import { EpisodeSectionsPanel } from './EpisodeSectionsPanel';
import { RecordModal } from './RecordModal';
import { LibraryModal } from './LibraryModal';
import { DeleteSegmentDialog } from './DeleteSegmentDialog';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { DeleteTranscriptSegmentDialog } from './DeleteTranscriptSegmentDialog';
import { TranscriptModal } from './TranscriptModal';
import { EpisodeTranscriptModal } from './EpisodeTranscriptModal';
import {
  deleteSegmentTranscript,
  startGenerateEpisodeTranscript,
  getTranscriptStatus,
} from '../../api/segments';
import type { Episode, EpisodeUpdate } from '../../api/episodes';
import type { Podcast } from '../../api/podcasts';
import sharedStyles from '../../components/PodcastDetail/shared.module.css';
import styles from '../EpisodeEditor.module.css';
import { startCall, getActiveSession } from '../../api/call';
import { CallPanel } from '../../components/GroupCall/CallPanel';
import { EndCallConfirmDialog } from '../../components/GroupCall/EndCallConfirmDialog';

export interface EpisodeEditorContentProps {
  episode: Episode;
  podcast?: Podcast;
  segments: EpisodeSegment[];
  segmentsLoading: boolean;
  asrAvail?: { available: boolean };
}

export function EpisodeEditorContent({
  episode,
  podcast,
  segments,
  segmentsLoading,
  asrAvail,
}: EpisodeEditorContentProps) {
  const id = episode.id;
  const podcastId = episode.podcast_id;
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const canRecord = (podcast?.can_record_new_section ?? canRecordNewSection(meData)) === true;
  const readOnly = isReadOnly(meData?.user ?? user);
  const myRole = (podcast as { my_role?: string } | undefined)?.my_role;
  const canEditMetadata = myRole === 'owner' || myRole === 'manager';
  const canEditSegments = myRole === 'owner' || myRole === 'manager' || myRole === 'editor';
  const segmentReadOnly = readOnly || !canEditSegments;
  const metadataReadOnly = readOnly || !canEditMetadata;

  const [episodeForm, setEpisodeForm] = useState(() => episodeToForm(episode));
  const [dialogForm, setDialogForm] = useState(() => episodeToForm(episode));
  const [showRecord, setShowRecord] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [segmentToDelete, setSegmentToDelete] = useState<string | null>(null);
  const [segmentIdForInfo, setSegmentIdForInfo] = useState<string | null>(null);
  const [transcriptEntryToDelete, setTranscriptEntryToDelete] = useState<{
    episodeId: string;
    segmentId: string;
    entryIndex: number;
  } | null>(null);
  const [coverMode, setCoverMode] = useState<'url' | 'upload'>('url');
  const [pendingArtworkFile, setPendingArtworkFile] = useState<File | null>(null);
  const [pendingArtworkPreviewUrl, setPendingArtworkPreviewUrl] = useState<string | null>(null);
  const [coverUploadKey, setCoverUploadKey] = useState(0);
  const [debouncedArtworkUrl, setDebouncedArtworkUrl] = useState('');
  const [buildInProgress, setBuildInProgress] = useState(false);
  const [buildAlreadyInProgressMessage, setBuildAlreadyInProgressMessage] = useState<string | null>(null);
  const [renderPollError, setRenderPollError] = useState<string | null>(null);
  const [showEpisodeTranscript, setShowEpisodeTranscript] = useState(false);
  const [activeCall, setActiveCall] = useState<{
    sessionId: string;
    token: string;
    joinUrl: string;
    joinCode?: string;
    webrtcUrl?: string;
    roomId?: string;
    webrtcUnavailable?: boolean;
  } | null>(null);
  const [startCallError, setStartCallError] = useState<string | null>(null);
  const [endCallConfirmOpen, setEndCallConfirmOpen] = useState(false);

  const segmentPauseRef = useRef<Map<string, () => void>>(new Map());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playingSegmentIdRef = useRef<string | null>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);

  const finalPauseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!id || segmentReadOnly) return;
    getActiveSession(id).then((session) => {
      if (session)
        setActiveCall({
          sessionId: session.sessionId,
          token: session.token,
          joinUrl: session.joinUrl,
          joinCode: session.joinCode,
          webrtcUrl: session.webrtcUrl,
          roomId: session.roomId,
          webrtcUnavailable: session.webrtcUnavailable,
        });
    }).catch(() => {});
  }, [id, segmentReadOnly]);

  const handleCallEnded = useCallback(() => setActiveCall(null), []);

  const handleEndGroupCallConfirmed = useCallback(() => {
    setActiveCall(null);
    setEndCallConfirmOpen(false);
  }, []);

  const handleStartGroupCall = useCallback(() => {
    setStartCallError(null);
    startCall(id)
      .then((res) => {
        setActiveCall({
          sessionId: res.sessionId,
          token: res.token,
          joinUrl: res.joinUrl,
          joinCode: res.joinCode,
          webrtcUrl: res.webrtcUrl,
          roomId: res.roomId,
          webrtcUnavailable: res.webrtcUnavailable,
        });
      })
      .catch((err) => {
        setStartCallError(err?.message ?? 'Failed to start call. Please try again.');
      });
  }, [id]);

  const handleSegmentPlayRequest = useCallback((segmentId: string) => {
    // Pause and reset all other segments to 0
    for (const [id, pause] of segmentPauseRef.current) {
      if (id !== segmentId) pause();
    }
    // Pause and reset final episode to 0
    finalPauseRef.current?.();
    playingSegmentIdRef.current = segmentId;
  }, []);
  const registerSegmentPause = useCallback((id: string, pause: () => void) => {
    segmentPauseRef.current.set(id, pause);
  }, []);
  const unregisterSegmentPause = useCallback((id: string) => {
    segmentPauseRef.current.delete(id);
    if (playingSegmentIdRef.current === id) playingSegmentIdRef.current = null;
  }, []);

  const pauseCurrentSegment = useCallback(() => {
    // Pause and reset all segments to 0
    for (const pause of segmentPauseRef.current.values()) {
      pause();
    }
    playingSegmentIdRef.current = null;
  }, []);

  useEffect(() => {
    setEpisodeForm(episodeToForm(episode));
  }, [episode]);

  useEffect(() => {
    const raw = (dialogForm.artworkUrl ?? '').trim();
    if (!raw) {
      setDebouncedArtworkUrl('');
      return;
    }
    const t = setTimeout(() => setDebouncedArtworkUrl(raw), 400);
    return () => clearTimeout(t);
  }, [dialogForm.artworkUrl]);

  useEffect(() => {
    if (!pendingArtworkFile) {
      setPendingArtworkPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const url = URL.createObjectURL(pendingArtworkFile);
    setPendingArtworkPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingArtworkFile]);

  const updateMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateEpisode>[1]) => updateEpisode(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['episode', id] });
      queryClient.invalidateQueries({ queryKey: ['episodes', podcastId] });
      setDetailsDialogOpen(false);
      setPendingArtworkFile(null);
      setCoverUploadKey((k) => k + 1);
    },
  });

  const uploadArtworkMutation = useMutation({
    mutationFn: (file: File) => uploadEpisodeArtwork(podcastId, id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['episode', id] });
      queryClient.invalidateQueries({ queryKey: ['episodes', podcastId] });
      setCoverUploadKey((k) => k + 1);
    },
  });

  useEffect(() => {
    if (detailsDialogOpen) {
      setDialogForm(episodeForm);
      setCoverMode(episode.artwork_filename ? 'upload' : 'url');
      setPendingArtworkFile(null);
      setDebouncedArtworkUrl((episodeForm.artworkUrl ?? '').trim());
      updateMutation.reset();
      uploadArtworkMutation.reset();
    }
    // Intentionally omit updateMutation/uploadArtworkMutation - .reset() can change refs and cause an infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsDialogOpen, episodeForm, episode.artwork_filename, episodeForm.artworkUrl]);

  const addRecordedMutation = useMutation({
    mutationFn: ({ file, name }: { file: File; name?: string | null }) => addRecordedSegment(id, file, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments', id] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setShowRecord(false);
    },
  });

  const updateSegmentMutation = useMutation({
    mutationFn: ({ segmentId, name }: { segmentId: string; name: string | null }) =>
      updateSegment(id, segmentId, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segments', id] }),
  });

  const addReusableMutation = useMutation({
    mutationFn: (assetId: string) => addReusableSegment(id, assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments', id] });
      setShowLibrary(false);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (segmentIds: string[]) => reorderSegments(id, segmentIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segments', id] }),
  });

  const deleteSegmentMutation = useMutation({
    mutationFn: (segmentId: string) => deleteSegment(id, segmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments', id] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const renderMutation = useMutation({
    mutationFn: () => startRenderEpisode(id),
    onSuccess: (result) => {
      if (result.status === 'building' || result.status === 'already_building') {
        setRenderPollError(null);
        setBuildInProgress(true);
        setBuildAlreadyInProgressMessage(result.status === 'already_building' ? (result.message ?? 'A build is already in progress.') : null);
      }
    },
  });

  const TRANSCRIPT_POLL_INTERVAL_MS = 5000;

  const generateTranscriptMutation = useMutation({
    mutationFn: async () => {
      await startGenerateEpisodeTranscript(id);
      for (;;) {
        await new Promise((r) => setTimeout(r, TRANSCRIPT_POLL_INTERVAL_MS));
        const { status, error } = await getTranscriptStatus(id);
        if (status === 'done') return;
        if (status === 'failed') throw new Error(error ?? 'Transcript generation failed');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['episode', id] });
      setShowEpisodeTranscript(true);
    },
  });

  // On load, check if a build is already in progress (e.g. user refreshed or navigated here)
  useEffect(() => {
    if (!id) return;
    getRenderStatus(id)
      .then(({ status }) => {
        if (status === 'building') {
          setBuildInProgress(true);
          setBuildAlreadyInProgressMessage('A build is already in progress.');
        }
      })
      .catch(() => {
        // Ignore: render-status may be unavailable; building state will be correct after user starts a build
      });
  }, [id]);

  useEffect(() => {
    if (!buildInProgress || !id) return;
    const poll = () => {
      getRenderStatus(id)
        .then(({ status, error }) => {
          if (status === 'done') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setBuildInProgress(false);
            setBuildAlreadyInProgressMessage(null);
            setRenderPollError(null);
            queryClient.invalidateQueries({ queryKey: ['episode', id] });
            queryClient.invalidateQueries({ queryKey: ['segments', id] });
          } else if (status === 'failed') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setBuildInProgress(false);
            setBuildAlreadyInProgressMessage(null);
            setRenderPollError(error ?? 'Build failed');
          }
        })
        .catch(() => {
          // Keep polling on network error
        });
    };
    poll();
    pollIntervalRef.current = setInterval(poll, 5000);
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [buildInProgress, id, queryClient]);

  function handleMoveUp(index: number) {
    if (index <= 0) return;
    const newOrder = [...segments];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    reorderMutation.mutate(newOrder.map((s) => s.id));
  }

  function handleMoveDown(index: number) {
    if (index >= segments.length - 1) return;
    const newOrder = [...segments];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    reorderMutation.mutate(newOrder.map((s) => s.id));
  }

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: podcast?.title ?? 'Show', href: `/podcasts/${podcastId}`, mobileLabel: 'Podcast' },
    { label: 'Episodes', href: `/podcasts/${podcastId}/episodes` },
    { label: episode.title, hideOnMobile: true },
  ];

  return (
    <div className={styles.page}>
      <Breadcrumb items={breadcrumbItems} />
      <EpisodeDetailsSummaryCard
        title={episodeForm.title}
        status={episodeForm.status}
        seasonNumber={
          episodeForm.seasonNumber === '' ? null : parseInt(episodeForm.seasonNumber, 10) || null
        }
        episodeNumber={
          episodeForm.episodeNumber === '' ? null : parseInt(episodeForm.episodeNumber, 10) || null
        }
        artworkUrl={
          episode.artwork_url
            ? episode.artwork_url
            : episode.artwork_filename
              ? `/api/podcasts/${podcastId}/episodes/${id}/artwork/${encodeURIComponent(episode.artwork_filename)}`
              : null
        }
        onEditClick={metadataReadOnly ? undefined : () => setDetailsDialogOpen(true)}
        subscriberOnly={episode.subscriber_only}
        shareUrl={
          podcast && episode.slug && (episode.status === 'scheduled' || episode.status === 'published')
            ? podcast.canonical_feed_url
              ? `${podcast.canonical_feed_url.replace(/\/$/, '')}/${episode.slug}`
              : typeof window !== 'undefined'
                ? `${window.location.origin}/feed/${podcast.slug}/${episode.slug}`
                : undefined
            : undefined
        }
        shareTitle={podcast ? `${episode.title} - ${podcast.title}` : undefined}
        embedCode={
          podcast && episode.slug && (episode.status === 'scheduled' || episode.status === 'published') && typeof window !== 'undefined'
            ? (() => {
                const base = podcast.canonical_feed_url ? podcast.canonical_feed_url.replace(/\/$/, '') : window.location.origin;
                const embedSrc = podcast.canonical_feed_url ? `${base}/embed/${episode.slug}` : `${base}/embed/${podcast.slug}/${episode.slug}`;
                return `<iframe src="${embedSrc}" width="100%" height="200" frameborder="0" allowfullscreen></iframe>`;
              })()
            : undefined
        }
        onStartGroupCall={
          !segmentReadOnly && canEditSegments && !activeCall ? handleStartGroupCall : undefined
        }
        isCallActive={!!activeCall}
        onEndGroupCall={
          !segmentReadOnly && canEditSegments && activeCall ? () => setEndCallConfirmOpen(true) : undefined
        }
      />

      <div className={styles.card}>
        <EpisodeSectionsPanel
              episodeId={id}
              segments={segments}
              segmentsLoading={segmentsLoading}
              onAddRecord={() => setShowRecord(true)}
              onAddLibrary={() => setShowLibrary(true)}
              recordDisabled={!canRecord}
              recordDisabledMessage={RECORD_BLOCKED_STORAGE_MESSAGE}
              readOnly={segmentReadOnly}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onDeleteRequest={setSegmentToDelete}
              onUpdateSegmentName={(segmentId, name) =>
                updateSegmentMutation.mutate({ segmentId, name })
              }
              isDeletingSegment={deleteSegmentMutation.isPending}
              deletingSegmentId={deleteSegmentMutation.variables ?? null}
              onSegmentPlayRequest={handleSegmentPlayRequest}
              onSegmentMoreInfo={(segmentId) => {
                pauseCurrentSegment();
                setSegmentIdForInfo(segmentId);
              }}
          registerSegmentPause={registerSegmentPause}
          unregisterSegmentPause={unregisterSegmentPause}
        />
      </div>

      <GenerateFinalBar
        episodeId={id}
        segmentCount={segments.length}
        onBuild={() => {
          setRenderPollError(null);
          renderMutation.mutate();
        }}
        isBuilding={renderMutation.isPending || buildInProgress}
        buildMessage={buildAlreadyInProgressMessage}
        hasFinalAudio={Boolean(episode.audio_final_path)}
        finalDurationSec={episode.audio_duration_sec ?? 0}
        finalUpdatedAt={episode.updated_at}
        readOnly={segmentReadOnly}
        onFinalPlayStart={pauseCurrentSegment}
        pauseAndResetRef={finalPauseRef}
        hasTranscript={episode.has_transcript === true}
        onOpenTranscript={() => setShowEpisodeTranscript(true)}
        onGenerateTranscript={episode.has_transcript !== true ? async () => { await generateTranscriptMutation.mutateAsync(); } : undefined}
        canGenerateTranscript={meData?.user?.can_transcribe === 1}
        error={
          renderPollError ??
          (renderMutation.isError ? renderMutation.error?.message : null) ??
          (generateTranscriptMutation.isError ? generateTranscriptMutation.error?.message : null)
        }
      />

      <EpisodeCastCard
        podcastId={podcastId}
        episodeId={id}
        canAssign={canEditSegments && !readOnly}
      />

      {showEpisodeTranscript && (
        <EpisodeTranscriptModal
          episodeId={id}
          onClose={() => setShowEpisodeTranscript(false)}
          canEdit={canEditSegments && !readOnly}
        />
      )}

      <Dialog.Root
        open={detailsDialogOpen}
        onOpenChange={(o) => !o && setDetailsDialogOpen(false)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content
            className={`${sharedStyles.dialogContent} ${sharedStyles.dialogContentWide} ${sharedStyles.dialogContentScrollable} ${styles.episodeDetailsDialog}`}
          >
            <div className={sharedStyles.dialogHeaderRow}>
              <Dialog.Title className={sharedStyles.dialogTitle}>
                Episode Details
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={sharedStyles.dialogClose}
                  aria-label="Close"
                  disabled={updateMutation.isPending || uploadArtworkMutation.isPending}
                >
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className={sharedStyles.dialogDescription}>
              Edit the episode title, description, and publish settings.
            </Dialog.Description>
            <div className={sharedStyles.dialogBodyScroll}>
              <EpisodeDetailsForm
                form={dialogForm}
                setForm={setDialogForm}
                descriptionTextareaRef={descriptionTextareaRef}
                slugDisabled={user?.role !== 'admin'}
                onSave={async () => {
                  const payload = formToApiPayload(dialogForm);
                  const fileToUpload = pendingArtworkFile;
                  if (fileToUpload) {
                    try {
                      await uploadArtworkMutation.mutateAsync(fileToUpload);
                      setPendingArtworkFile(null);
                      const { artwork_url: _artworkUrl, ...rest } = payload;
                      void _artworkUrl;
                      updateMutation.mutate(rest as EpisodeUpdate);
                    } catch {
                      // error surfaced via uploadArtworkMutation
                    }
                    return;
                  }
                  const finalPayload =
                    coverMode === 'upload' ? (() => { const { artwork_url: _artworkUrl, ...rest } = payload; void _artworkUrl; return rest; })() : payload;
                  updateMutation.mutate(finalPayload as EpisodeUpdate);
                }}
                onCancel={() => setDetailsDialogOpen(false)}
                isSaving={updateMutation.isPending}
                saveError={
                  updateMutation.isError
                    ? (updateMutation.error as Error)?.message ?? null
                    : uploadArtworkMutation.isError
                      ? (uploadArtworkMutation.error as Error)?.message ?? null
                      : null
                }
                saveSuccess={updateMutation.isSuccess}
                coverImageConfig={{
                  podcastId,
                  episodeId: id,
                  artworkFilename: episode.artwork_filename ?? null,
                  coverMode,
                  setCoverMode,
                  pendingArtworkFile,
                  setPendingArtworkFile,
                  pendingArtworkPreviewUrl,
                  coverUploadKey,
                  debouncedArtworkUrl,
                  uploadArtworkPending: uploadArtworkMutation.isPending,
                }}
              />
            </div>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.cancel} onClick={() => setDetailsDialogOpen(false)} aria-label="Cancel editing episode">
                Cancel
              </button>
              <button
                type="submit"
                form="episode-details-form"
                className={styles.submit}
                disabled={updateMutation.isPending || uploadArtworkMutation.isPending}
                aria-label="Save episode details"
              >
                {uploadArtworkMutation.isPending ? 'Uploading...' : updateMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {startCallError && (
        <div className={styles.callErrorBanner} role="alert">
          {startCallError}
          <button
            type="button"
            className={styles.callErrorBannerDismiss}
            onClick={() => setStartCallError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <EndCallConfirmDialog
        open={endCallConfirmOpen}
        onOpenChange={setEndCallConfirmOpen}
        onConfirm={handleEndGroupCallConfirmed}
      />
      {activeCall && (
        <CallPanel
          sessionId={activeCall.sessionId}
          joinUrl={activeCall.joinUrl}
          joinCode={activeCall.joinCode}
          webrtcUrl={activeCall.webrtcUrl}
          roomId={activeCall.roomId}
          mediaUnavailable={!activeCall.webrtcUrl || !activeCall.roomId || activeCall.webrtcUnavailable}
          onEnd={handleCallEnded}
          onCallEnded={handleCallEnded}
          onSegmentRecorded={() => queryClient.invalidateQueries({ queryKey: ['segments', id] })}
          onEndRequest={() => setEndCallConfirmOpen(true)}
        />
      )}
      {showRecord && (
        <RecordModal
          onClose={() => setShowRecord(false)}
          onAdd={(file, name) => addRecordedMutation.mutate({ file, name })}
          isAdding={addRecordedMutation.isPending}
          error={
            addRecordedMutation.isError
              ? addRecordedMutation.error?.message
              : undefined
          }
        />
      )}
      {showLibrary && (
        <LibraryModal
          onClose={() => setShowLibrary(false)}
          onSelect={(assetId) => addReusableMutation.mutate(assetId)}
          isAdding={addReusableMutation.isPending}
          error={
            addReusableMutation.isError
              ? addReusableMutation.error?.message
              : undefined
          }
        />
      )}

      {segmentIdForInfo && (
        <TranscriptModal
          episodeId={id}
          segmentId={segmentIdForInfo}
          segmentName={
            segments.find((s) => s.id === segmentIdForInfo)?.name?.trim() ||
            'Section'
          }
          segmentDuration={
            segments.find((s) => s.id === segmentIdForInfo)?.duration_sec ?? 0
          }
          segmentAudioPath={
            segments.find((s) => s.id === segmentIdForInfo)?.audio_path
          }
          asrAvailable={Boolean(asrAvail?.available)}
          ownerCanTranscribe={podcast?.owner_can_transcribe === 1}
          onClose={() => setSegmentIdForInfo(null)}
          onDeleteEntry={(entryIndex) => {
            setTranscriptEntryToDelete({
              episodeId: id,
              segmentId: segmentIdForInfo,
              entryIndex,
            });
          }}
        />
      )}

      <DeleteTranscriptSegmentDialog
        open={transcriptEntryToDelete !== null}
        onOpenChange={(open) => !open && setTranscriptEntryToDelete(null)}
        onConfirm={async () => {
          if (transcriptEntryToDelete) {
            try {
              await deleteSegmentTranscript(
                transcriptEntryToDelete.episodeId,
                transcriptEntryToDelete.segmentId,
                transcriptEntryToDelete.entryIndex
              );
              queryClient.invalidateQueries({
                queryKey: ['segments', transcriptEntryToDelete.episodeId],
              });
              setTranscriptEntryToDelete(null);
              if (segmentIdForInfo === transcriptEntryToDelete.segmentId) {
                const currentSegmentId = segmentIdForInfo;
                setSegmentIdForInfo(null);
                setTimeout(() => {
                  setSegmentIdForInfo(currentSegmentId);
                }, 100);
              }
            } catch (err) {
              console.error('Failed to delete transcript entry:', err);
            }
          }
        }}
        isDeleting={false}
      />

      <DeleteSegmentDialog
        open={!!segmentToDelete}
        onOpenChange={(open) => !open && setSegmentToDelete(null)}
        description={
          segmentToDelete
            ? (() => {
                const seg = segments.find((s) => s.id === segmentToDelete);
                const name =
                  seg?.name?.trim() ||
                  (seg?.type === 'recorded' ? 'Recorded section' : seg?.asset_name) ||
                  'This section';
                return `"${name}" will be removed. This cannot be undone.`;
              })()
            : ''
        }
        onConfirm={() => {
          if (segmentToDelete) {
            deleteSegmentMutation.mutate(segmentToDelete);
            setSegmentToDelete(null);
          }
        }}
        isDeleting={
          deleteSegmentMutation.isPending &&
          deleteSegmentMutation.variables === segmentToDelete
        }
      />
    </div>
  );
}

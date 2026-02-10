import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Breadcrumb } from '../../components/Breadcrumb';
import { useAuthStore } from '../../store/auth';
import { me, canRecordNewSection, RECORD_BLOCKED_STORAGE_MESSAGE } from '../../api/auth';
import { updateEpisode, uploadEpisodeArtwork } from '../../api/episodes';
import {
  addRecordedSegment,
  addReusableSegment,
  reorderSegments,
  deleteSegment,
  updateSegment,
  renderEpisode,
  type EpisodeSegment,
} from '../../api/segments';
import { episodeToForm, formToApiPayload } from './utils';
import { EpisodeDetailsSummaryCard } from './EpisodeDetailsSummaryCard';
import { EpisodeDetailsForm } from './EpisodeDetailsForm';
import { GenerateFinalBar } from './GenerateFinalBar';
import { EpisodeSectionsPanel } from './EpisodeSectionsPanel';
import { RecordModal } from './RecordModal';
import { LibraryModal } from './LibraryModal';
import { DeleteSegmentDialog } from './DeleteSegmentDialog';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { DeleteTranscriptSegmentDialog } from './DeleteTranscriptSegmentDialog';
import { TranscriptModal } from './TranscriptModal';
import { deleteSegmentTranscript } from '../../api/segments';
import type { Episode } from '../../api/episodes';
import type { Podcast } from '../../api/podcasts';
import styles from '../EpisodeEditor.module.css';

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
  const canRecord = canRecordNewSection(meData);

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

  const segmentPauseRef = useRef<Map<string, () => void>>(new Map());
  const playingSegmentIdRef = useRef<string | null>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSegmentPlayRequest = useCallback((segmentId: string) => {
    const current = playingSegmentIdRef.current;
    if (current && current !== segmentId) segmentPauseRef.current.get(current)?.();
    playingSegmentIdRef.current = segmentId;
  }, []);
  const registerSegmentPause = useCallback((id: string, pause: () => void) => {
    segmentPauseRef.current.set(id, pause);
  }, []);
  const unregisterSegmentPause = useCallback((id: string) => {
    segmentPauseRef.current.delete(id);
    if (playingSegmentIdRef.current === id) playingSegmentIdRef.current = null;
  }, []);

  useEffect(() => {
    setEpisodeForm(episodeToForm(episode));
    setTimeout(() => {
      if (descriptionTextareaRef.current) {
        descriptionTextareaRef.current.style.height = 'auto';
        descriptionTextareaRef.current.style.height = `${descriptionTextareaRef.current.scrollHeight}px`;
      }
    }, 0);
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
    // Intentionally omit updateMutation/uploadArtworkMutation — .reset() can change refs and cause an infinite loop
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
    mutationFn: () => renderEpisode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['episode', id] });
      queryClient.invalidateQueries({ queryKey: ['segments', id] });
    },
  });

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
              ? `/api/public/artwork/${podcastId}/episodes/${id}/${encodeURIComponent(episode.artwork_filename)}`
              : null
        }
        onEditClick={() => setDetailsDialogOpen(true)}
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
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onDeleteRequest={setSegmentToDelete}
              onUpdateSegmentName={(segmentId, name) =>
                updateSegmentMutation.mutate({ segmentId, name })
              }
              isDeletingSegment={deleteSegmentMutation.isPending}
              deletingSegmentId={deleteSegmentMutation.variables ?? null}
              onSegmentPlayRequest={handleSegmentPlayRequest}
              onSegmentMoreInfo={setSegmentIdForInfo}
          registerSegmentPause={registerSegmentPause}
          unregisterSegmentPause={unregisterSegmentPause}
        />
      </div>

      <GenerateFinalBar
        episodeId={id}
        segmentCount={segments.length}
        onBuild={() => renderMutation.mutate()}
        isBuilding={renderMutation.isPending}
        hasFinalAudio={Boolean(episode.audio_final_path)}
        finalDurationSec={episode.audio_duration_sec ?? 0}
        finalUpdatedAt={episode.updated_at}
      />
      {renderMutation.isError && (
        <p className={styles.error}>{renderMutation.error?.message}</p>
      )}

      <Dialog.Root
        open={detailsDialogOpen}
        onOpenChange={(o) => !o && setDetailsDialogOpen(false)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogDetailsGrid}`}
          >
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={updateMutation.isPending || uploadArtworkMutation.isPending}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
            <Dialog.Title className={styles.dialogTitle}>
              Episode Details
            </Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              Edit the episode title, description, and publish settings.
            </Dialog.Description>
            <div className={`${styles.dialogBodyScroll} ${styles.dialogBodyScrollForm}`}>
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
                      updateMutation.mutate(rest);
                    } catch {
                      // error surfaced via uploadArtworkMutation
                    }
                    return;
                  }
                  const finalPayload =
                    coverMode === 'upload' ? (() => { const { artwork_url: _artworkUrl, ...rest } = payload; void _artworkUrl; return rest; })() : payload;
                  updateMutation.mutate(finalPayload);
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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

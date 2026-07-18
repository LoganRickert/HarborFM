import { useEffect, useRef, useState } from 'react';
import { Download, FileUp, FolderInput, FolderDown, Trash2, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { PleaseWaitDialog } from '../../components/PleaseWaitDialog';
import {
  downloadSegmentMp3Url,
  downloadSegmentProjectUrl,
  getSegmentHostDuckingStatus,
  getSegmentProjectExportStatus,
  getSegmentProjectImportStatus,
  getSegmentReaperImportStatus,
  startImportSegmentProject,
  startImportSegmentReaper,
  startSegmentHostDucking,
  startSegmentProjectExport,
  type EpisodeSegment,
} from '../../api/segments';
import { downloadAuthenticatedBlob, pollUntil } from '../../utils/projectZipTransfer';
import styles from '../EpisodeEditor.module.css';

export interface ManageSegmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeId: string;
  segment: EpisodeSegment | null;
  readOnly?: boolean;
  onImported: () => void;
  onDeleteRequest: () => void;
  isDeleting: boolean;
}

type WaitKind = 'export' | 'import' | 'reaper' | null;

export function ManageSegmentDialog({
  open,
  onOpenChange,
  episodeId,
  segment,
  readOnly = false,
  onImported,
  onDeleteRequest,
  isDeleting,
}: ManageSegmentDialogProps) {
  const zipInputRef = useRef<HTMLInputElement>(null);
  const rppInputRef = useRef<HTMLInputElement>(null);
  const [waitKind, setWaitKind] = useState<WaitKind>(null);
  const [waitError, setWaitError] = useState<string | null>(null);
  const [waitWarning, setWaitWarning] = useState<string | null>(null);
  const [duckingBusy, setDuckingBusy] = useState(false);
  const duckingGenRef = useRef(0);
  const duckingBusyRef = useRef(false);
  const busy = (waitKind != null && !waitError && !waitWarning) || duckingBusy;
  const duckingInProgressTitle = 'Host ducking update in progress';

  const name =
    segment?.name?.trim() ||
    (segment?.type === 'recorded' ? 'Recorded section' : segment?.assetName) ||
    'Section';
  const hasAudio = Boolean(
    segment &&
      ((segment.type === 'recorded' && segment.audioPath) ||
        (segment.type === 'reusable' && segment.reusableAssetId) ||
        (segment.durationSec ?? 0) > 0),
  );
  const canProject = hasAudio;
  const duckingEnabled = Boolean(segment?.hostDuckingEnabled);
  const showHostDucking = Boolean(segment?.hasRecordings) && !readOnly;

  async function runHostDuckingJob(
    segmentId: string,
    start?: () => Promise<void>,
  ): Promise<void> {
    if (duckingBusyRef.current) return;
    duckingBusyRef.current = true;
    const gen = ++duckingGenRef.current;
    setDuckingBusy(true);
    setWaitError(null);
    try {
      if (start) await start();
      await pollUntil(() => getSegmentHostDuckingStatus(episodeId, segmentId), {
        pendingStatuses: ['remaking'],
        successStatuses: ['done', 'idle'],
      });
      if (duckingGenRef.current === gen) onImported();
    } catch (err) {
      if (duckingGenRef.current === gen) {
        setWaitError(err instanceof Error ? err.message : 'Failed to update host ducking');
        setWaitKind('import');
      }
    } finally {
      if (duckingGenRef.current === gen) {
        duckingBusyRef.current = false;
        setDuckingBusy(false);
      }
    }
  }

  // If a remake is already running when the dialog opens, lock the toggle and wait.
  useEffect(() => {
    if (!open || !segment || !showHostDucking) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await getSegmentHostDuckingStatus(episodeId, segment.id);
        if (cancelled || status.status !== 'remaking') return;
        await runHostDuckingJob(segment.id);
      } catch {
        // runHostDuckingJob surfaces errors via Please wait
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- probe once per open/segment
  }, [open, segment?.id, episodeId, showHostDucking]);

  function dismissWait() {
    const hadWarning = Boolean(waitWarning);
    setWaitKind(null);
    setWaitError(null);
    setWaitWarning(null);
    if (hadWarning) {
      onImported();
      onOpenChange(false);
    }
  }

  async function handleDownloadSegment() {
    if (!segment || busy || readOnly) return;
    setWaitError(null);
    setWaitKind('export');
    try {
      await startSegmentProjectExport(episodeId, segment.id);
      await pollUntil(() => getSegmentProjectExportStatus(episodeId, segment.id), {
        pendingStatuses: ['building'],
        successStatuses: ['ready', 'idle'],
      });
      await downloadAuthenticatedBlob(
        downloadSegmentProjectUrl(episodeId, segment.id),
        'segment-project.zip',
      );
      dismissWait();
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Failed to prepare download');
    }
  }

  async function handleImportZip(file: File | undefined) {
    if (!segment || !file || busy || readOnly) return;
    setWaitError(null);
    setWaitWarning(null);
    setWaitKind('import');
    try {
      await startImportSegmentProject(episodeId, segment.id, file);
      const result = await pollUntil(
        () => getSegmentProjectImportStatus(episodeId, segment.id),
        {
          pendingStatuses: ['importing'],
          successStatuses: ['done'],
        },
      );
      if (result.status !== 'done') {
        throw new Error('Import finished unexpectedly');
      }
      if (result.warning) {
        setWaitWarning(result.warning);
        return;
      }
      setWaitKind(null);
      onImported();
      onOpenChange(false);
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (zipInputRef.current) zipInputRef.current.value = '';
    }
  }

  async function handleImportReaper(file: File | undefined) {
    if (!segment || !file || busy || readOnly) return;
    setWaitError(null);
    setWaitWarning(null);
    setWaitKind('reaper');
    try {
      await startImportSegmentReaper(episodeId, segment.id, file);
      const result = await pollUntil(
        () => getSegmentReaperImportStatus(episodeId, segment.id),
        {
          pendingStatuses: ['importing'],
          successStatuses: ['done'],
        },
      );
      if (result.status !== 'done') {
        throw new Error('Import finished unexpectedly');
      }
      setWaitKind(null);
      onImported();
      onOpenChange(false);
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (rppInputRef.current) rppInputRef.current.value = '';
    }
  }

  async function handleHostDuckingToggle(enabled: boolean) {
    if (!segment || busy || readOnly) return;
    if (Boolean(segment.hostDuckingEnabled) === enabled) return;
    await runHostDuckingJob(segment.id, () =>
      startSegmentHostDucking(episodeId, segment.id, enabled),
    );
  }

  const waitDescription = duckingBusy
    ? 'Updating host ducking…'
    : waitKind === 'reaper'
      ? 'Importing Reaper project…'
      : waitKind === 'import'
        ? 'Importing segment…'
        : 'Preparing your download…';
  const waitErrorTitle =
    waitKind === 'export' ? 'Download failed' : 'Import failed';

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            if (busy) return;
            dismissWait();
            onOpenChange(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentScrollable}`}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Manage Segment</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.dialogClose}
                  aria-label="Close"
                  disabled={busy}
                >
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <div className={styles.dialogBodyScroll}>
            <Dialog.Description className={styles.dialogDescription}>
              {name}
            </Dialog.Description>

            {showHostDucking ? (
              <div
                className={styles.hostDuckingSetting}
                title={duckingBusy ? duckingInProgressTitle : undefined}
              >
                <span className={styles.hostDuckingSettingLabel}>Host Ducking</span>
                <div
                  className={styles.hostDuckingSegmented}
                  role="group"
                  aria-label="Host Ducking"
                  aria-busy={duckingBusy}
                >
                  <button
                    type="button"
                    className={
                      !duckingEnabled
                        ? styles.hostDuckingSegmentedActive
                        : styles.hostDuckingSegmentedBtn
                    }
                    aria-pressed={!duckingEnabled}
                    disabled={busy}
                    title={duckingBusy ? duckingInProgressTitle : undefined}
                    onClick={() => handleHostDuckingToggle(false)}
                  >
                    Disabled
                  </button>
                  <button
                    type="button"
                    className={
                      duckingEnabled
                        ? styles.hostDuckingSegmentedActive
                        : styles.hostDuckingSegmentedBtn
                    }
                    aria-pressed={duckingEnabled}
                    disabled={busy}
                    title={duckingBusy ? duckingInProgressTitle : undefined}
                    onClick={() => handleHostDuckingToggle(true)}
                  >
                    Enabled
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.manageSegmentActions}>
              {hasAudio && !readOnly ? (
                <a
                  className={styles.manageSegmentAction}
                  href={downloadSegmentMp3Url(episodeId, segment!.id)}
                  download
                >
                  <Download size={18} aria-hidden />
                  <span>Download MP3</span>
                  <span className={styles.manageSegmentActionHint}>Trimmed final mix</span>
                </a>
              ) : (
                <button
                  type="button"
                  className={styles.manageSegmentAction}
                  disabled
                  title={readOnly ? 'Read-only account' : 'No audio to download'}
                >
                  <Download size={18} aria-hidden />
                  <span>Download MP3</span>
                  <span className={styles.manageSegmentActionHint}>Trimmed final mix</span>
                </button>
              )}

              <button
                type="button"
                className={styles.manageSegmentAction}
                disabled={readOnly || busy}
                onClick={() => zipInputRef.current?.click()}
                title={readOnly ? 'Read-only account' : undefined}
              >
                <FolderInput size={18} aria-hidden />
                <span>Import Segment</span>
                <span className={styles.manageSegmentActionHint}>Overwrite this segment</span>
              </button>
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(e) => void handleImportZip(e.target.files?.[0])}
              />

              <button
                type="button"
                className={styles.manageSegmentAction}
                disabled={readOnly || busy || !hasAudio}
                onClick={() => rppInputRef.current?.click()}
                title={
                  readOnly
                    ? 'Read-only account'
                    : !hasAudio
                      ? 'No audio to apply a Reaper project to'
                      : undefined
                }
              >
                <FileUp size={18} aria-hidden />
                <span>Import Reaper</span>
                <span className={styles.manageSegmentActionHint}>
                  Apply segment.rpp to existing tracks
                </span>
              </button>
              <input
                ref={rppInputRef}
                type="file"
                accept=".rpp,application/octet-stream"
                hidden
                onChange={(e) => void handleImportReaper(e.target.files?.[0])}
              />

              {canProject && !readOnly ? (
                <button
                  type="button"
                  className={styles.manageSegmentAction}
                  disabled={busy}
                  onClick={() => void handleDownloadSegment()}
                >
                  <FolderDown size={18} aria-hidden />
                  <span>Download Segment</span>
                  <span className={styles.manageSegmentActionHint}>
                    Source audio, tracks, and metadata
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.manageSegmentAction}
                  disabled
                  title={readOnly ? 'Read-only account' : 'No segment to download'}
                >
                  <FolderDown size={18} aria-hidden />
                  <span>Download Segment</span>
                  <span className={styles.manageSegmentActionHint}>
                    Source audio, tracks, and metadata
                  </span>
                </button>
              )}

              <button
                type="button"
                className={`${styles.manageSegmentAction} ${styles.manageSegmentActionDanger}`}
                disabled={readOnly || isDeleting || busy}
                onClick={() => {
                  onOpenChange(false);
                  onDeleteRequest();
                }}
                title={readOnly ? 'Read-only account' : undefined}
              >
                <Trash2 size={18} aria-hidden />
                <span>Delete</span>
                <span className={styles.manageSegmentActionHint}>Remove this section</span>
              </button>
            </div>
            </div>

            <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.cancel}
                  aria-label="Close manage segment"
                  disabled={busy}
                >
                  Close
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <PleaseWaitDialog
        open={waitKind != null || duckingBusy}
        title="Please wait"
        description={waitDescription}
        error={waitError}
        errorTitle={waitErrorTitle}
        warning={waitWarning}
        warningTitle="Import finished"
        onDismiss={dismissWait}
      />
    </>
  );
}

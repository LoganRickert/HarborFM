import { useRef, useState } from 'react';
import { Download, FolderInput, FolderDown, Trash2, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { PleaseWaitDialog } from '../../components/PleaseWaitDialog';
import {
  downloadSegmentMp3Url,
  downloadSegmentProjectUrl,
  getSegmentProjectExportStatus,
  getSegmentProjectImportStatus,
  startImportSegmentProject,
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

type WaitKind = 'export' | 'import' | null;

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [waitKind, setWaitKind] = useState<WaitKind>(null);
  const [waitError, setWaitError] = useState<string | null>(null);
  const busy = waitKind != null && !waitError;

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

  function dismissWait() {
    setWaitKind(null);
    setWaitError(null);
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

  async function handleImportFile(file: File | undefined) {
    if (!segment || !file || busy || readOnly) return;
    setWaitError(null);
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
      dismissWait();
      onImported();
      onOpenChange(false);
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

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
          <Dialog.Content className={styles.dialogContent}>
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
            <Dialog.Description className={styles.dialogDescription}>
              {name}
            </Dialog.Description>

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
                onClick={() => fileInputRef.current?.click()}
                title={readOnly ? 'Read-only account' : undefined}
              >
                <FolderInput size={18} aria-hidden />
                <span>Import Segment</span>
                <span className={styles.manageSegmentActionHint}>Overwrite this segment</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(e) => void handleImportFile(e.target.files?.[0])}
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
        open={waitKind != null}
        title="Please wait"
        description={
          waitKind === 'import' ? 'Importing segment…' : 'Preparing your download…'
        }
        error={waitError}
        onDismiss={dismissWait}
      />
    </>
  );
}

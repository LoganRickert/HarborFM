import { useRef, useState } from 'react';
import { Download, FolderInput, FolderDown, Trash2, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  downloadSegmentMp3Url,
  downloadSegmentProjectUrl,
  importSegmentProject,
  type EpisodeSegment,
} from '../../api/segments';
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
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

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

  async function handleImportFile(file: File | undefined) {
    if (!segment || !file || importing || readOnly) return;
    setImportError(null);
    setImporting(true);
    try {
      await importSegmentProject(episodeId, segment.id, file);
      onImported();
      onOpenChange(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setImportError(null);
          onOpenChange(false);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Manage segment</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
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

            {canProject && !readOnly ? (
              <a
                className={styles.manageSegmentAction}
                href={downloadSegmentProjectUrl(episodeId, segment!.id)}
                download
              >
                <FolderDown size={18} aria-hidden />
                <span>Download Segment</span>
                <span className={styles.manageSegmentActionHint}>
                  Source audio, tracks, and metadata
                </span>
              </a>
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
              className={styles.manageSegmentAction}
              disabled={readOnly || importing}
              onClick={() => fileInputRef.current?.click()}
              title={readOnly ? 'Read-only account' : undefined}
            >
              <FolderInput size={18} aria-hidden />
              <span>{importing ? 'Importing…' : 'Import Segment'}</span>
              <span className={styles.manageSegmentActionHint}>Overwrite this segment</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => void handleImportFile(e.target.files?.[0])}
            />

            <button
              type="button"
              className={`${styles.manageSegmentAction} ${styles.manageSegmentActionDanger}`}
              disabled={readOnly || isDeleting}
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

          {importError && (
            <p className={styles.manageSegmentError} role="alert">
              {importError}
            </p>
          )}

          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <Dialog.Close asChild>
              <button type="button" className={styles.cancel} aria-label="Close manage segment">
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

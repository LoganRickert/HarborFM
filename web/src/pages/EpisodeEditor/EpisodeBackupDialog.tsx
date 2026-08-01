import { useEffect, useState } from 'react';
import { HardDriveUpload, CalendarClock, RotateCcw, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  backupEpisode,
  listEpisodeBackups,
  restoreEpisodeBackup,
  type EpisodeBackupItem,
} from '../../api/archive';
import { PleaseWaitDialog } from '../../components/PleaseWaitDialog';
import styles from '../EpisodeEditor.module.css';

export interface EpisodeBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeId: string;
  hasFinalAudio: boolean;
  readOnly?: boolean;
}

function isDatedBackupFilename(filename: string): boolean {
  return /_\d{8}_\d{6}\.zip$/i.test(filename);
}

function backupWhenLabel(item: EpisodeBackupItem): string | null {
  if (item.lastModified) {
    try {
      const d = new Date(item.lastModified);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString();
      }
    } catch {
      // fall through
    }
  }
  const stamp = item.filename.match(/_(\d{8})_(\d{6})\.zip$/i);
  if (stamp) {
    const [, ymd, hms] = stamp;
    const y = Number(ymd.slice(0, 4));
    const mo = Number(ymd.slice(4, 6)) - 1;
    const day = Number(ymd.slice(6, 8));
    const h = Number(hms.slice(0, 2));
    const mi = Number(hms.slice(2, 4));
    const s = Number(hms.slice(4, 6));
    const d = new Date(y, mo, day, h, mi, s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString();
    }
  }
  return null;
}

function formatBackupLabel(item: EpisodeBackupItem): string {
  const when = backupWhenLabel(item);
  if (isDatedBackupFilename(item.filename)) {
    return when ? `Dated · ${when}` : 'Dated backup';
  }
  return when ? `Backup · ${when}` : 'Backup';
}

export function EpisodeBackupDialog({
  open,
  onOpenChange,
  episodeId,
  hasFinalAudio,
  readOnly = false,
}: EpisodeBackupDialogProps) {
  const queryClient = useQueryClient();
  const [selectedFilename, setSelectedFilename] = useState('');
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [waitOpen, setWaitOpen] = useState(false);
  const [waitDescription, setWaitDescription] = useState('Please wait...');
  const [waitErrorTitle, setWaitErrorTitle] = useState('Backup failed');

  const backupsQuery = useQuery({
    queryKey: ['episode-backups', episodeId],
    queryFn: () => listEpisodeBackups(episodeId),
    enabled: open && Boolean(episodeId),
  });

  const backups = backupsQuery.data?.backups ?? [];

  useEffect(() => {
    if (!open) {
      setSelectedFilename('');
      setRestoreConfirmOpen(false);
      setActionError(null);
      setWaitOpen(false);
      return;
    }
    setActionError(null);
  }, [open]);

  useEffect(() => {
    const list = backupsQuery.data?.backups;
    if (!list || list.length === 0) return;
    if (!selectedFilename || !list.some((b) => b.filename === selectedFilename)) {
      setSelectedFilename(list[0].filename);
    }
  }, [backupsQuery.data?.backups, selectedFilename]);

  const backupMutation = useMutation({
    mutationFn: (dated: boolean) => backupEpisode(episodeId, { dated }),
    onMutate: (dated) => {
      setActionError(null);
      setWaitErrorTitle('Backup failed');
      setWaitDescription(
        dated
          ? 'Creating and uploading the dated backup...'
          : 'Creating and uploading the backup...',
      );
      setWaitOpen(true);
    },
    onSuccess: async () => {
      setWaitOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['episode-backups', episodeId] });
    },
    onError: (err: Error) => {
      setActionError(err.message || 'Backup failed');
      setWaitOpen(true);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (filename: string) => restoreEpisodeBackup(episodeId, filename),
    onMutate: () => {
      setActionError(null);
      setWaitErrorTitle('Restore failed');
      setWaitDescription('Downloading and restoring the backup...');
      setWaitOpen(true);
    },
    onSuccess: async () => {
      setWaitOpen(false);
      setRestoreConfirmOpen(false);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
      await queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err: Error) => {
      setActionError(err.message || 'Restore failed');
      setWaitOpen(true);
    },
  });

  const busy = backupMutation.isPending || restoreMutation.isPending;

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          onOpenChange(next);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentScrollable}`}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Backup</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.dialogClose}
                  aria-label="Close"
                  disabled={busy}
                >
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <div className={styles.dialogBodyScroll}>
              <Dialog.Description className={styles.srOnly}>
                Upload a project backup or restore from a previous backup on the archive
                destination.
              </Dialog.Description>

              <div className={styles.manageSegmentActions}>
                <button
                  type="button"
                  className={styles.manageSegmentAction}
                  disabled={readOnly || busy || !hasFinalAudio}
                  onClick={() => backupMutation.mutate(false)}
                  title={
                    readOnly
                      ? 'Read-only account'
                      : !hasFinalAudio
                        ? 'Build the final episode before backing up'
                        : 'Upload a project zip (overwrites the latest undated backup)'
                  }
                >
                  <HardDriveUpload size={18} aria-hidden />
                  <span>Backup</span>
                  <span className={styles.manageSegmentActionHint}>
                    Upload an archive. Replaces existing archive.
                  </span>
                </button>

                <button
                  type="button"
                  className={styles.manageSegmentAction}
                  disabled={readOnly || busy || !hasFinalAudio}
                  onClick={() => backupMutation.mutate(true)}
                  title={
                    readOnly
                      ? 'Read-only account'
                      : !hasFinalAudio
                        ? 'Build the final episode before backing up'
                        : 'Upload a new timestamped zip copy'
                  }
                >
                  <CalendarClock size={18} aria-hidden />
                  <span>Dated Backup</span>
                  <span className={styles.manageSegmentActionHint}>
                    Upload a new archive with date and time.
                  </span>
                </button>
              </div>

              <div className={styles.backupRestoreSection}>
                <h3 className={styles.backupRestoreHeading}>Restore a backup</h3>
                <p className={styles.backupRestoreLead}>
                  Choose a backup from the archive destination. Restoring replaces local
                  segment and recording files for this episode.
                </p>
                {backupsQuery.isError ? (
                  <p className={styles.manageSegmentError} role="alert">
                    {(backupsQuery.error as Error)?.message || 'Failed to list backups'}
                  </p>
                ) : null}
                <div className={styles.backupRestoreRow}>
                  <label className={styles.srOnly} htmlFor="episode-backup-select">
                    Backup file
                  </label>
                  <select
                    id="episode-backup-select"
                    className={styles.select}
                    value={selectedFilename}
                    onChange={(e) => setSelectedFilename(e.target.value)}
                    disabled={busy || backups.length === 0 || backupsQuery.isLoading}
                  >
                    {backupsQuery.isLoading ? (
                      <option value="">Loading backups...</option>
                    ) : backups.length === 0 ? (
                      <option value="">No backups yet</option>
                    ) : (
                      backups.map((b) => (
                        <option key={b.filename} value={b.filename}>
                          {formatBackupLabel(b)}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    className={styles.submit}
                    disabled={
                      readOnly || busy || !selectedFilename || backups.length === 0
                    }
                    onClick={() => setRestoreConfirmOpen(true)}
                  >
                    <RotateCcw size={16} strokeWidth={2.25} aria-hidden />
                    Restore
                  </button>
                </div>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={restoreConfirmOpen}
        onOpenChange={(next) => {
          if (busy) return;
          setRestoreConfirmOpen(next);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`}
          />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentOnModal}`}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Restore this backup?</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className={styles.dialogClose} aria-label="Close">
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              This will download the archive and replace the local project files for this
              episode. Episode title, description, and publish settings stay as they are. This
              cannot be undone except by restoring another backup.
            </Dialog.Description>
            <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className={styles.submit}
                disabled={busy || !selectedFilename}
                onClick={() => {
                  if (!selectedFilename) return;
                  restoreMutation.mutate(selectedFilename);
                }}
              >
                Restore
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <PleaseWaitDialog
        open={waitOpen}
        title="Please wait"
        description={waitDescription}
        error={actionError}
        errorTitle={waitErrorTitle}
        onDismiss={() => {
          setWaitOpen(false);
          setActionError(null);
        }}
      />
    </>
  );
}

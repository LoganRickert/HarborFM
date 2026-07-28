import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = sharedStyles;

interface CancelWorkerJobConfirmDialogProps {
  open: boolean;
  workerName: string;
  jobLabel: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function CancelWorkerJobConfirmDialog({
  open,
  workerName,
  jobLabel,
  pending = false,
  onOpenChange,
  onConfirm,
}: CancelWorkerJobConfirmDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onOpenChange(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              Cancel worker job?
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={pending}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            Stop the {jobLabel} job on {workerName}? The worker will abort and the
            job will be marked failed.
          </Dialog.Description>
          <div
            className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}
          >
            <Dialog.Close asChild>
              <button type="button" className={styles.cancel} disabled={pending}>
                Keep running
              </button>
            </Dialog.Close>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? 'Cancelling...' : 'Cancel job'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

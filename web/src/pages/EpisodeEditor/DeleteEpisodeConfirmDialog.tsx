import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from '../EpisodeEditor.module.css';

export interface DeleteEpisodeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteEpisodeConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: DeleteEpisodeConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`} />
        <Dialog.Content className={`${styles.dialogContent} ${styles.dialogContentOnModal}`}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Delete episode?</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            Are you sure you want to delete this episode? This cannot be undone.
          </Dialog.Description>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <Dialog.Close asChild>
              <button type="button" className={styles.cancel} aria-label="Cancel">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              disabled={isDeleting}
              aria-label="Confirm delete episode"
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

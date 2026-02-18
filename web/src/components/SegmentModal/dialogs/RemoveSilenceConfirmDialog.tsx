import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from '../../../pages/EpisodeEditor.module.css';

export interface RemoveSilenceConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading: boolean;
}

export function RemoveSilenceConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
}: RemoveSilenceConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentOnModal}`}
          onEscapeKeyDown={(e) => e.stopPropagation()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Remove Silence</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description asChild>
            <div className={styles.dialogDescription}>
              Are you sure you want to remove all silence periods longer than 2 seconds? This will
              update the audio file.
              <div className={styles.removeSilenceNote}>This will remove all markers and trims.</div>
            </div>
          </Dialog.Description>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <button
              type="button"
              className={styles.cancel}
              onClick={(e) => {
                e.stopPropagation();
                onOpenChange(false);
              }}
              aria-label="Cancel removing silence"
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={(e) => {
                e.stopPropagation();
                onConfirm();
              }}
              disabled={loading}
              aria-label="Confirm remove silence"
            >
              {loading ? 'Removing...' : 'Confirm'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from '../../../pages/EpisodeEditor.module.css';

export interface RemoveMarkerConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function RemoveMarkerConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: RemoveMarkerConfirmDialogProps) {
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
            <Dialog.Title className={styles.dialogTitle}>Remove marker?</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            Are you sure you want to remove this marker?
          </Dialog.Description>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <button
              type="button"
              className={styles.cancel}
              onClick={() => onOpenChange(false)}
              aria-label="Keep marker"
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
              aria-label="Remove marker"
            >
              Remove
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

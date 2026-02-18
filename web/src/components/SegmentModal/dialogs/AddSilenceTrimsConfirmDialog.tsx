import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from '../../../pages/EpisodeEditor.module.css';

export interface AddSilenceTrimsConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function AddSilenceTrimsConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: AddSilenceTrimsConfirmDialogProps) {
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
            <Dialog.Title className={styles.dialogTitle}>Add Silence Trims</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description asChild>
            <div className={styles.dialogDescription}>
              Add trim ranges at detected silence periods longer than 1 second? This will add trims
              to the segment without modifying the audio file.
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
              aria-label="Cancel"
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
              aria-label="Confirm add silence trims"
            >
              Confirm
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from '../../../pages/EpisodeEditor.module.css';

export interface SegmentCloseConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}

export function SegmentCloseConfirmDialog({
  open,
  onOpenChange,
  onDiscard,
}: SegmentCloseConfirmDialogProps) {
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
            <Dialog.Title className={styles.dialogTitle}>Unsaved changes</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            You have unsaved changes on the Edit tab. Discard changes and close?
          </Dialog.Description>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <button
              type="button"
              className={styles.cancel}
              onClick={() => onOpenChange(false)}
              aria-label="Keep editing"
            >
              Keep editing
            </button>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={onDiscard}
              aria-label="Discard and close"
            >
              Discard
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

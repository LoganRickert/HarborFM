import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from '../EpisodeEditor.module.css';

export interface DeleteSegmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full description e.g. "\"Intro\" will be removed. This cannot be undone." */
  description: string;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteSegmentDialog({
  open,
  onOpenChange,
  description,
  onConfirm,
  isDeleting,
}: DeleteSegmentDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Remove section?</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>{description}</Dialog.Description>
          <div className={styles.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={styles.cancel} aria-label="Cancel removing section">
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
              aria-label="Confirm remove section"
            >
              {isDeleting ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

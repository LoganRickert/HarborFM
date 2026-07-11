import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from '../EpisodeEditor.module.css';

export interface DeleteShowNotesItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteShowNotesItemDialog({
  open,
  onOpenChange,
  description,
  onConfirm,
  isDeleting,
}: DeleteShowNotesItemDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Remove topic?</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>{description}</Dialog.Description>
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
              aria-label="Confirm remove topic"
            >
              {isDeleting ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

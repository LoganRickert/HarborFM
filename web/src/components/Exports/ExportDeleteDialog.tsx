import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { Export } from '../../api/exports';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = sharedStyles;

interface ExportDeleteDialogProps {
  export: Export | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (exportId: string) => void;
  isPending: boolean;
}

export function ExportDeleteDialog({
  export: exportToDelete,
  isOpen,
  onClose,
  onConfirm,
  isPending,
}: ExportDeleteDialogProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Remove delivery?</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {exportToDelete
              ? `This will permanently remove "${exportToDelete.name}". This cannot be undone.`
              : 'This will permanently remove this destination. This cannot be undone.'}
          </Dialog.Description>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <Dialog.Close asChild>
              <button type="button" className={styles.cancel} aria-label="Cancel">Cancel</button>
            </Dialog.Close>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={() => exportToDelete && onConfirm(exportToDelete.id)}
              disabled={isPending}
              aria-label="Confirm remove delivery"
            >
              {isPending ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

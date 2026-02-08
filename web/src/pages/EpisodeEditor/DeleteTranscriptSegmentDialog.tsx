import * as Dialog from '@radix-ui/react-dialog';
import styles from '../EpisodeEditor.module.css';

export interface DeleteTranscriptSegmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteTranscriptSegmentDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: DeleteTranscriptSegmentDialogProps) {
  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenChange(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={styles.dialogContent}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onOpenChange(false);
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <Dialog.Title className={styles.dialogTitle}>Delete transcript segment?</Dialog.Title>
          <p className={styles.dialogDescription}>
            This will remove the segment from both the audio file and transcript. This cannot be undone.
          </p>
          <div className={styles.dialogActions}>
            <button type="button" className={styles.cancel} onClick={handleCancel} aria-label="Cancel deleting transcript segment">
              Cancel
            </button>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={onConfirm}
              disabled={isDeleting}
              aria-label="Confirm delete transcript segment"
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = sharedStyles;

interface CollaboratorRemoveDialogProps {
  collaborator: { user_id: string; email: string } | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (userId: string) => void;
  isPending: boolean;
}

export function CollaboratorRemoveDialog({
  collaborator,
  isOpen,
  onClose,
  onConfirm,
  isPending,
}: CollaboratorRemoveDialogProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Remove collaborator?</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {collaborator
              ? `This will remove ${collaborator.email} from this show. They will lose access.`
              : 'This will remove this collaborator from this show.'}
          </Dialog.Description>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <Dialog.Close asChild>
              <button type="button" className={styles.cancel} aria-label="Cancel">Cancel</button>
            </Dialog.Close>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={() => collaborator && onConfirm(collaborator.user_id)}
              disabled={isPending}
              aria-label="Confirm remove collaborator"
            >
              {isPending ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

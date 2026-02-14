import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import sharedStyles from '../PodcastDetail/shared.module.css';
import type { CastMember } from '../../api/podcasts';

const styles = sharedStyles;

interface CastDeleteDialogProps {
  cast: CastMember | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (castId: string) => void;
  isPending: boolean;
}

export function CastDeleteDialog({
  cast,
  isOpen,
  onClose,
  onConfirm,
  isPending,
}: CastDeleteDialogProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              Remove cast member?
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {cast
              ? `This will remove ${cast.name} from the show cast. They can be added again later.`
              : 'This will remove this cast member from the show.'}
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
              onClick={() => cast && onConfirm(cast.id)}
              disabled={isPending}
              aria-label="Confirm remove cast member"
            >
              {isPending ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

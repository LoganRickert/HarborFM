import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import sharedStyles from '../PodcastDetail/shared.module.css';
import type { CastMember } from '../../api/podcasts';

const styles = sharedStyles;

interface CastExpireInviteDialogProps {
  cast: CastMember | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (castId: string) => void;
  isPending: boolean;
  error?: string | null;
}

export function CastExpireInviteDialog({
  cast,
  isOpen,
  onClose,
  onConfirm,
  isPending,
  error,
}: CastExpireInviteDialogProps) {
  const name = cast?.name?.trim() || 'this cast member';

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && !isPending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              Expire Update Link?
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={isPending}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            This expires {name}&apos;s profile update link (valid for up to 14 days
            until expired). They will need a new Update email to submit changes.
          </Dialog.Description>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.cancel}
                aria-label="Cancel"
                disabled={isPending}
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={() => cast && onConfirm(cast.id)}
              disabled={isPending || !cast}
              aria-label="Expire update link"
            >
              {isPending ? 'Expiring...' : 'Expire Link'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

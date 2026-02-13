import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { SubscriberToken } from '../../api/podcasts';
import localStyles from './SubscriberTokens.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface SubscriberTokenDeleteDialogProps {
  token: SubscriberToken | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (tokenId: string) => void;
  isPending: boolean;
}

export function SubscriberTokenDeleteDialog({
  token,
  isOpen,
  onClose,
  onConfirm,
  isPending,
}: SubscriberTokenDeleteDialogProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Delete token?</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {token
              ? `This will permanently delete the token "${token.name}". Subscribers using this feed URL will no longer be able to access the feed. This cannot be undone.`
              : 'This will permanently delete this token. This cannot be undone.'}
          </Dialog.Description>
          <div className={styles.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={styles.subscriberDialogCancelBtn} aria-label="Cancel">Cancel</button>
            </Dialog.Close>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={() => {
                if (token) {
                  onConfirm(token.id);
                  onClose();
                }
              }}
              disabled={isPending}
              aria-label="Confirm delete token"
            >
              {isPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

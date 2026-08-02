import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import sharedStyles from '../PodcastDetail/shared.module.css';
import type { CastMember } from '../../api/podcasts';

const styles = sharedStyles;

interface CastRequestInfoDialogProps {
  cast: CastMember | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (castId: string) => void;
  isPending: boolean;
  error?: string | null;
}

export function CastRequestInfoDialog({
  cast,
  isOpen,
  onClose,
  onConfirm,
  isPending,
  error,
}: CastRequestInfoDialogProps) {
  const email = cast?.email?.trim() || '';
  const name = cast?.name?.trim() || 'this cast member';

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && !isPending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              Request profile update
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
            HarborFM will email {name}
            {email ? ` at ${email}` : ''} asking them to reply with a new photo and any
            social links to add or update. The message includes their current photo (when
            available) and current social links.
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
              className={styles.dialogConfirm}
              onClick={() => cast && onConfirm(cast.id)}
              disabled={isPending || !cast}
              aria-label="Send Email"
            >
              {isPending ? 'Sending...' : 'Send Email'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = sharedStyles;

interface DisableEmailSigninConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DisableEmailSigninConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
}: DisableEmailSigninConfirmDialogProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              Disable email sign-in?
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            If your SSO has issues, you may be locked out of your server. Only enable this if you have another way to recover access (e.g. another admin or provider). Continue?
          </Dialog.Description>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <Dialog.Close asChild>
              <button type="button" className={styles.cancel} aria-label="Cancel">Cancel</button>
            </Dialog.Close>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={() => {
                onConfirm();
                onClose();
              }}
              aria-label="Confirm disable email sign-in"
            >
              Continue
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

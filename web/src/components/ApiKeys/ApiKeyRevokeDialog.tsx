import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ApiKeyRecord } from '../../api/apiKeys';
import sharedStyles from '../PodcastDetail/shared.module.css';
import tokenStyles from '../SubscriberTokens/SubscriberTokens.module.css';

const styles = { ...sharedStyles, ...tokenStyles };

interface ApiKeyRevokeDialogProps {
  apiKey: ApiKeyRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (keyId: string) => void;
  isPending: boolean;
}

export function ApiKeyRevokeDialog({
  apiKey,
  isOpen,
  onClose,
  onConfirm,
  isPending,
}: ApiKeyRevokeDialogProps) {
  const name = apiKey?.name?.trim() || 'API Key';

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Revoke API key?</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {apiKey
              ? `This will permanently revoke the API key "${name}". Any scripts or apps using this key will stop working. This cannot be undone.`
              : 'This will permanently revoke this API key. This cannot be undone.'}
          </Dialog.Description>
          <div className={styles.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={styles.subscriberDialogCancelBtn} aria-label="Cancel">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={() => {
                if (apiKey) {
                  onConfirm(apiKey.id);
                  onClose();
                }
              }}
              disabled={isPending}
              aria-label="Confirm revoke API key"
            >
              {isPending ? 'Revoking...' : 'Revoke'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

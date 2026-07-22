import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from '../PodcastDetail/shared.module.css';

export interface StripeConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  elevated?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function StripeConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  pendingLabel = 'Deleting…',
  pending = false,
  elevated = false,
  onOpenChange,
  onConfirm,
}: StripeConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onOpenChange(false)}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={`${styles.dialogOverlay} ${elevated ? styles.dialogOverlayOnModal : ''}`}
        />
        <Dialog.Content
          className={`${styles.dialogContent} ${elevated ? styles.dialogContentOnModal : ''}`}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={pending}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {description}
          </Dialog.Description>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <Dialog.Close asChild>
              <button type="button" className={styles.cancel} disabled={pending}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? pendingLabel : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

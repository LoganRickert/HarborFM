import * as Dialog from '@radix-ui/react-dialog';
import { InlineLoading } from './Loading';
import styles from './PodcastDetail/shared.module.css';

export interface PleaseWaitDialogProps {
  open: boolean;
  title?: string;
  description?: string;
  /** When set, dialog is in error state and can be dismissed. */
  error?: string | null;
  onDismiss?: () => void;
}

export function PleaseWaitDialog({
  open,
  title = 'Please wait',
  description = 'This may take a moment…',
  error = null,
  onDismiss,
}: PleaseWaitDialogProps) {
  const isError = Boolean(error);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && isError) onDismiss?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentOnModal}`}
          onEscapeKeyDown={(e) => {
            if (!isError) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onPointerDownOutside={(e) => {
            if (!isError) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!isError) e.preventDefault();
          }}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>{title}</Dialog.Title>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {isError ? error : description}
          </Dialog.Description>
          {!isError && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem 0 0.25rem' }}>
              <InlineLoading label={title} />
            </div>
          )}
          {isError && (
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.cancel}
                onClick={() => onDismiss?.()}
                aria-label="Close"
              >
                Close
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

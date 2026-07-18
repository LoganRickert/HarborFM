import * as Dialog from '@radix-ui/react-dialog';
import { InlineLoading } from './Loading';
import styles from './PodcastDetail/shared.module.css';

export interface PleaseWaitDialogProps {
  open: boolean;
  title?: string;
  description?: string;
  /** When set, dialog is in error state and can be dismissed. */
  error?: string | null;
  /** Title shown when `error` is set (defaults to "Something went wrong"). */
  errorTitle?: string;
  /** Non-fatal notice after success; dialog stays open until dismissed. */
  warning?: string | null;
  /** Title shown when `warning` is set (defaults to "Import finished"). */
  warningTitle?: string;
  onDismiss?: () => void;
}

export function PleaseWaitDialog({
  open,
  title = 'Please wait',
  description = 'This may take a moment…',
  error = null,
  errorTitle = 'Something went wrong',
  warning = null,
  warningTitle = 'Import finished',
  onDismiss,
}: PleaseWaitDialogProps) {
  const isError = Boolean(error);
  const isWarning = Boolean(warning) && !isError;
  const canDismiss = isError || isWarning;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && canDismiss) onDismiss?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentOnModal}`}
          onEscapeKeyDown={(e) => {
            if (!canDismiss) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onPointerDownOutside={(e) => {
            if (!canDismiss) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!canDismiss) e.preventDefault();
          }}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              {isError ? errorTitle : isWarning ? warningTitle : title}
            </Dialog.Title>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {isError ? error : isWarning ? warning : description}
          </Dialog.Description>
          {!canDismiss && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem 0 0.25rem' }}>
              <InlineLoading label={title} />
            </div>
          )}
          {canDismiss && (
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

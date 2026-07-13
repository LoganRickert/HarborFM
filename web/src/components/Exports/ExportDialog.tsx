import { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { Export, ExportCreate, ExportUpdate } from '../../api/exports';
import { ExportForm } from './ExportForm';
import { UnsavedChangesConfirmDialog } from '../UnsavedChangesConfirmDialog';
import { useDialogCloseGuard } from '../../hooks/useDialogCloseGuard';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = sharedStyles;

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editingExport?: Export;
  formMode: 'create' | 'edit';
  isSaving: boolean;
  error?: string;
  onSubmitCreate: (body: ExportCreate) => void;
  onSubmitUpdate: (exportId: string, body: ExportUpdate) => void;
}

export function ExportDialog({
  isOpen,
  onClose,
  editingExport,
  formMode,
  isSaving,
  error,
  onSubmitCreate,
  onSubmitUpdate,
}: ExportDialogProps) {
  const [formDirty, setFormDirty] = useState(false);
  const handleDirtyChange = useCallback((dirty: boolean) => setFormDirty(dirty), []);
  const {
    confirmOpen,
    requestClose,
    onOpenChange,
    handleConfirmOpenChange,
    handleDiscard,
    dialogContentProps,
  } = useDialogCloseGuard({
    isDirty: formDirty,
    onClose: () => {
      if (isSaving) return;
      onClose();
    },
  });

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (isSaving) return;
        onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentScrollable} ${styles.dialogShowDetailsGrid}`}
          {...dialogContentProps}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              {editingExport ? 'Edit Delivery' : 'Add Delivery'}
            </Dialog.Title>
            <button
              type="button"
              className={styles.dialogClose}
              aria-label="Close"
              disabled={isSaving}
              onClick={requestClose}
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {editingExport ? 'Update the destination settings.' : 'Choose a destination type and enter connection details.'} Credentials are stored encrypted and cannot be viewed after saving.
          </Dialog.Description>

          <div className={styles.dialogBodyScroll}>
            <ExportForm
              open={isOpen}
              formMode={formMode}
              initial={editingExport}
              onSubmitCreate={onSubmitCreate}
              onSubmitUpdate={onSubmitUpdate}
              error={error}
              onDirtyChange={handleDirtyChange}
            />
          </div>
          <div className={`${styles.dialogFooter} ${styles.dialogFooterCancelLeft}`}>
            <button
              type="button"
              className={styles.cancel}
              onClick={requestClose}
              disabled={isSaving}
              aria-label="Cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-delivery-form"
              className={styles.submit}
              disabled={isSaving}
              aria-label="Save export"
            >
              {isSaving ? 'Saving...' : editingExport ? 'Save' : 'Add'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
      <UnsavedChangesConfirmDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        onDiscard={handleDiscard}
      />
    </Dialog.Root>
  );
}

import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Archive, X } from 'lucide-react';
import type { Export, ExportCreate, ExportUpdate } from '../../api/exports';
import {
  deleteArchiveSettings,
  getArchiveSettings,
  testArchiveSettings,
  updateArchiveSettings,
  upsertArchiveSettings,
  type ArchiveSettings,
} from '../../api/archive';
import { ExportForm } from '../Exports/ExportForm';
import { UnsavedChangesConfirmDialog } from '../UnsavedChangesConfirmDialog';
import { useDialogCloseGuard } from '../../hooks/useDialogCloseGuard';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = sharedStyles;

function settingsToExport(settings: ArchiveSettings): Export {
  return {
    id: settings.podcastId,
    podcastId: settings.podcastId,
    provider: settings.mode.toLowerCase(),
    mode: settings.mode,
    name: settings.name,
    bucket: settings.bucket,
    prefix: settings.prefix ?? '',
    region: settings.region,
    endpointUrl: settings.endpointUrl,
    publicBaseUrl: null,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
    hasCredentials: settings.hasCredentials,
  };
}

interface ArchiveSettingsDialogProps {
  podcastId: string;
  isOpen: boolean;
  onClose: () => void;
  readOnly?: boolean;
}

export function ArchiveSettingsDialog({
  podcastId,
  isOpen,
  onClose,
  readOnly = false,
}: ArchiveSettingsDialogProps) {
  const queryClient = useQueryClient();
  const [formDirty, setFormDirty] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['archive-settings', podcastId],
    queryFn: () => getArchiveSettings(podcastId),
    enabled: isOpen && !!podcastId,
  });

  const configured = Boolean(data?.configured && data.settings);
  const editingExport = data?.settings ? settingsToExport(data.settings) : undefined;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['archive-settings', podcastId] });
    void queryClient.invalidateQueries({ queryKey: ['archive-configured', podcastId] });
  };

  const saveMutation = useMutation({
    mutationFn: async (args: { mode: 'create' | 'edit'; body: ExportCreate | ExportUpdate }) => {
      if (args.mode === 'create') {
        return upsertArchiveSettings(podcastId, args.body as ExportCreate);
      }
      return updateArchiveSettings(podcastId, args.body as ExportUpdate);
    },
    onSuccess: () => {
      setFormError(undefined);
      invalidate();
      onClose();
    },
    onError: (err: Error) => setFormError(err.message || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteArchiveSettings(podcastId),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err: Error) => setFormError(err.message || 'Failed to remove'),
  });

  const testMutation = useMutation({
    mutationFn: () => testArchiveSettings(podcastId),
    onSuccess: (res) => {
      setTestMessage(res.ok ? 'Connection OK' : res.error || 'Test failed');
    },
    onError: (err: Error) => setTestMessage(err.message || 'Test failed'),
  });

  const handleDirtyChange = useCallback((dirty: boolean) => setFormDirty(dirty), []);
  const isSaving = saveMutation.isPending;

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
      setFormError(undefined);
      setTestMessage(null);
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
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Archive size={18} strokeWidth={2} aria-hidden />
                Archive Settings
              </span>
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
            Configure one remote destination for episode project archives. Credentials are
            stored encrypted.
          </Dialog.Description>

          <div className={styles.dialogBodyScroll}>
            {isLoading ? (
              <p className={styles.dialogDescription}>Loading...</p>
            ) : readOnly ? (
              <p className={styles.dialogDescription}>
                {configured
                  ? `Archive destination: ${data?.settings?.name ?? 'configured'} (${data?.settings?.mode ?? ''})`
                  : 'No archive destination configured.'}
              </p>
            ) : (
              <ExportForm
                open={isOpen}
                formMode={configured ? 'edit' : 'create'}
                initial={editingExport}
                formId="archive-settings-form"
                hidePublicBaseUrl
                onSubmitCreate={(body) =>
                  saveMutation.mutate({ mode: 'create', body })
                }
                onSubmitUpdate={(_exportId, body) =>
                  saveMutation.mutate({ mode: 'edit', body })
                }
                error={formError}
                onDirtyChange={handleDirtyChange}
              />
            )}
            {testMessage && <p className={styles.dialogDescription}>{testMessage}</p>}
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
            {!readOnly && configured && (
              <>
                <button
                  type="button"
                  className={styles.cancel}
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || isSaving}
                >
                  {testMutation.isPending ? 'Testing...' : 'Test'}
                </button>
                <button
                  type="button"
                  className={styles.cancel}
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending || isSaving}
                >
                  Remove
                </button>
              </>
            )}
            {!readOnly && (
              <button
                type="submit"
                form="archive-settings-form"
                className={styles.submit}
                disabled={isSaving}
                aria-label="Save archive settings"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            )}
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

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cloud, Plus, UploadCloud } from 'lucide-react';
import {
  listExports,
  createExport,
  updateExport,
  testExport,
  deployAllExports,
  deleteExport,
  type Export,
  type ExportCreate,
  type ExportUpdate,
} from '../../api/exports';
import { ExportsList } from './ExportsList';
import { ExportDialog } from './ExportDialog';
import { ExportDeleteDialog } from './ExportDeleteDialog';
import { ExportDeployResults } from './ExportDeployResults';
import localStyles from './Exports.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface ExportsSectionProps {
  podcastId: string;
  readOnly?: boolean;
}

export function ExportsSection({ podcastId, readOnly = false }: ExportsSectionProps) {
  const queryClient = useQueryClient();
  const { data: exportsList = [] } = useQuery({
    queryKey: ['exports', podcastId],
    queryFn: () => listExports(podcastId),
  });

  const [testingId, setTestingId] = useState<string | null>(null);
  const [deployingAll, setDeployingAll] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExportId, setEditingExportId] = useState<string | null>(null);
  const [exportToDelete, setExportToDelete] = useState<Export | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: ExportCreate) => createExport(podcastId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports', podcastId] });
      setDialogOpen(false);
      setEditingExportId(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { exportId: string; body: ExportUpdate }) =>
      updateExport(vars.exportId, vars.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports', podcastId] });
      setDialogOpen(false);
      setEditingExportId(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: (exportId: string) => testExport(exportId),
    onSuccess: () => {
      setTestingId(null);
      queryClient.invalidateQueries({ queryKey: ['exports', podcastId] });
    },
    onError: () => setTestingId(null),
  });

  const deployAllMutation = useMutation({
    mutationFn: () => deployAllExports(podcastId),
    onSuccess: () => setDeployingAll(false),
    onError: () => setDeployingAll(false),
  });

  const deleteMutation = useMutation({
    mutationFn: (exportId: string) => deleteExport(exportId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports', podcastId] });
      setExportToDelete(null);
    },
  });

  const editingExport = editingExportId ? exportsList.find((e) => e.id === editingExportId) : undefined;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const openAddDialog = () => {
    setEditingExportId(null);
    setDialogOpen(true);
  };

  const openEditDialog = (exp: Export) => {
    setEditingExportId(exp.id);
    setDialogOpen(true);
  };

  const handleTest = (exportId: string) => {
    setTestingId(exportId);
    testMutation.mutate(exportId);
  };

  const handleDeploy = () => {
    setDeployingAll(true);
    deployAllMutation.mutate();
  };

  return (
    <div className={styles.card}>
      <div className={styles.exportHeader}>
        <div className={styles.exportTitle}>
          <Cloud size={18} strokeWidth={2} aria-hidden="true" />
          <h2 className={styles.sectionTitle}>Podcast Delivery</h2>
        </div>
        {!readOnly && (
          <div className={styles.exportHeaderActions}>
            <button
              type="button"
              className={styles.gearBtn}
              onClick={openAddDialog}
              aria-label="Add delivery destination"
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              Add Delivery
            </button>
            {exportsList.length > 0 && (
              <button
                type="button"
                className={styles.deployBtn}
                onClick={handleDeploy}
                disabled={deployingAll}
                aria-label="Deploy to all destinations"
              >
                <UploadCloud size={16} aria-hidden />
                {deployingAll ? 'Deploying...' : 'Deploy'}
              </button>
            )}
          </div>
        )}
      </div>
      <p className={styles.sectionSub}>
        Deploy your RSS feed and episode audio files to one or more destinations. Credentials are stored encrypted and cannot be viewed after saving.
      </p>

      {exportsList.length === 0 ? (
        <p className={styles.exportMuted}>No delivery destinations configured. Add one to get started.</p>
      ) : (
        <ExportsList
          exports={exportsList}
          readOnly={readOnly}
          testingId={testingId}
          testMutation={testMutation}
          onTest={handleTest}
          onEdit={openEditDialog}
          onDelete={setExportToDelete}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {!readOnly && exportsList.length > 0 && (
        <ExportDeployResults
          results={deployAllMutation.data?.results}
          error={deployAllMutation.error}
          isSuccess={deployAllMutation.isSuccess}
          isError={deployAllMutation.isError}
        />
      )}

      <ExportDialog
        isOpen={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingExportId(null);
        }}
        editingExport={editingExport}
        formMode={editingExport ? 'edit' : 'create'}
        isSaving={isSaving}
        error={
          createMutation.isError
            ? createMutation.error?.message
            : updateMutation.isError
              ? updateMutation.error?.message
              : undefined
        }
        onSubmitCreate={(body) => createMutation.mutate(body)}
        onSubmitUpdate={(exportId, body) => updateMutation.mutate({ exportId, body })}
      />

      <ExportDeleteDialog
        export={exportToDelete}
        isOpen={!!exportToDelete}
        onClose={() => setExportToDelete(null)}
        onConfirm={(exportId) => deleteMutation.mutate(exportId)}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}

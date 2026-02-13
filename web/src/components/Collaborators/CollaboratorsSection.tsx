import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { listCollaborators, removeCollaborator } from '../../api/podcasts';
import { CollaboratorForm } from './CollaboratorForm';
import { CollaboratorsList } from './CollaboratorsList';
import { CollaboratorRemoveDialog } from './CollaboratorRemoveDialog';
import localStyles from './Collaborators.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface CollaboratorsSectionProps {
  podcastId: string;
  effectiveMaxCollaborators?: number | null;
}

export function CollaboratorsSection({ podcastId, effectiveMaxCollaborators }: CollaboratorsSectionProps) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['collaborators', podcastId],
    queryFn: () => listCollaborators(podcastId).then((r) => r.collaborators),
    enabled: !!podcastId,
  });

  const collaborators = data ?? [];
  const atCollaboratorLimit =
    effectiveMaxCollaborators != null && effectiveMaxCollaborators > 0 && collaborators.length >= effectiveMaxCollaborators;

  const [collaboratorToRemove, setCollaboratorToRemove] = useState<{ user_id: string; email: string } | null>(null);

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeCollaborator(podcastId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborators', podcastId] });
      queryClient.invalidateQueries({ queryKey: ['podcasts'] });
      setCollaboratorToRemove(null);
    },
  });

  return (
    <div className={styles.card}>
      <div className={styles.exportHeader}>
        <div className={styles.exportTitle}>
          <Users size={18} strokeWidth={2} aria-hidden="true" />
          <h2 className={styles.sectionTitle}>Collaborators</h2>
        </div>
      </div>
      <p className={styles.sectionSub}>
        Invite others to this show. View: read-only. Editor: edit segments and build the episode. Manager: edit metadata, episodes, and exports.
      </p>

      <CollaboratorForm
        podcastId={podcastId}
        atLimit={atCollaboratorLimit}
        limitValue={effectiveMaxCollaborators}
        onSuccess={() => {}}
      />

      {isLoading ? (
        <p className={styles.exportMuted}>Loading...</p>
      ) : collaborators.length === 0 ? (
        <p className={`${styles.exportMuted} ${styles.collabEmptyState}`}>No collaborators yet. Add someone by email above.</p>
      ) : (
        <>
          <CollaboratorsList
            collaborators={collaborators}
            podcastId={podcastId}
            onRemove={setCollaboratorToRemove}
            isRemoving={removeMutation.isPending}
          />
          <CollaboratorRemoveDialog
            collaborator={collaboratorToRemove}
            isOpen={!!collaboratorToRemove}
            onClose={() => setCollaboratorToRemove(null)}
            onConfirm={(userId) => removeMutation.mutate(userId)}
            isPending={removeMutation.isPending}
          />
        </>
      )}
    </div>
  );
}

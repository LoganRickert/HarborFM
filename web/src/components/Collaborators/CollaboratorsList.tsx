import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { updateCollaborator } from '../../api/podcasts';
import localStyles from './Collaborators.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface CollaboratorsListProps {
  collaborators: Array<{
    user_id: string;
    email: string;
    role: string;
  }>;
  podcastId: string;
  onRemove: (collaborator: { user_id: string; email: string }) => void;
  isRemoving: boolean;
}

export function CollaboratorsList({ collaborators, podcastId, onRemove, isRemoving }: CollaboratorsListProps) {
  const queryClient = useQueryClient();

  return (
    <ul className={styles.exportList}>
      {collaborators.map((c) => (
        <li key={c.user_id} className={styles.exportCard}>
          <div className={styles.exportCardRow}>
            <div className={styles.exportCardMeta}>
              <strong>{c.email}</strong>
              <span className={styles.exportModeBadge}>{c.role}</span>
            </div>
            <div className={styles.collabCardActions}>
              <div className={styles.statusToggle} role="group" aria-label={`Role for ${c.email}`}>
                {(['view', 'editor', 'manager'] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={c.role === role ? styles.statusToggleActive : styles.statusToggleBtn}
                    onClick={() => {
                      if (role !== c.role) {
                        updateCollaborator(podcastId, c.user_id, { role }).then(() => {
                          queryClient.invalidateQueries({ queryKey: ['collaborators', podcastId] });
                        });
                      }
                    }}
                    aria-pressed={c.role === role}
                    aria-label={role.charAt(0).toUpperCase() + role.slice(1)}
                  >
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={styles.collabDeleteBtn}
                onClick={() => onRemove({ user_id: c.user_id, email: c.email })}
                disabled={isRemoving}
                aria-label={`Remove ${c.email}`}
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

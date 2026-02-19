import { useQueryClient } from '@tanstack/react-query';
import { Trash2, Crown, Shield, Pencil, Eye } from 'lucide-react';
import { updateCollaborator } from '../../api/podcasts';
import localStyles from './Collaborators.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface CollaboratorsListProps {
  collaborators: Array<{
    userId: string;
    username: string;
    role: string;
  }>;
  podcastId: string;
  onRemove: (collaborator: { userId: string; username: string }) => void;
  isRemoving: boolean;
}

const ROLE_ICONS = {
  owner: Crown,
  manager: Shield,
  editor: Pencil,
  view: Eye,
} as const;

const ROLE_ICON_SIZE = 14;

export function CollaboratorsList({ collaborators, podcastId, onRemove, isRemoving }: CollaboratorsListProps) {
  const queryClient = useQueryClient();

  return (
    <ul className={styles.exportList}>
      {collaborators.map((c) => {
        const RoleIcon = ROLE_ICONS[c.role as keyof typeof ROLE_ICONS];
        return (
        <li key={c.userId} className={styles.exportCard}>
          <div className={styles.exportCardRow}>
            <div className={styles.exportCardMeta}>
              <div className={styles.collabMetaWrap}>
                {RoleIcon && (
                  <span className={styles.collabRoleIcon} aria-hidden>
                    <RoleIcon size={ROLE_ICON_SIZE} />
                  </span>
                )}
                <strong>{c.username || 'Unknown'}</strong>
              </div>
            </div>
            <div className={styles.collabCardActions}>
                <div className={styles.statusToggle} role="group" aria-label={`Role for ${c.username || 'Unknown'}`}>
                {(['view', 'editor', 'manager'] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={c.role === role ? styles.statusToggleActive : styles.statusToggleBtn}
                    onClick={() => {
                      if (role !== c.role) {
                        updateCollaborator(podcastId, c.userId, { role }).then(() => {
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
                onClick={() => onRemove({ userId: c.userId, username: c.username })}
                disabled={isRemoving}
                aria-label={`Remove ${c.username || 'Unknown'}`}
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </div>
          </div>
        </li>
      );
      })}
    </ul>
  );
}

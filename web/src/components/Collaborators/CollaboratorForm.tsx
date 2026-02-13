import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { addCollaborator, inviteToPlatform, CollaboratorApiError } from '../../api/podcasts';
import localStyles from './Collaborators.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface CollaboratorFormProps {
  podcastId: string;
  atLimit: boolean;
  limitValue?: number | null;
  onSuccess: () => void;
}

export function CollaboratorForm({ podcastId, atLimit, limitValue, onSuccess }: CollaboratorFormProps) {
  const queryClient = useQueryClient();
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<'view' | 'editor' | 'manager'>('editor');
  const [addError, setAddError] = useState<string | null>(null);
  const [userNotFoundEmail, setUserNotFoundEmail] = useState<string | null>(null);
  const [inviteSending, setInviteSending] = useState(false);

  const addMutation = useMutation({
    mutationFn: (body: { email: string; role: string }) => addCollaborator(podcastId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborators', podcastId] });
      queryClient.invalidateQueries({ queryKey: ['podcasts'] });
      setAddEmail('');
      setAddError(null);
      setUserNotFoundEmail(null);
      onSuccess();
    },
    onError: (err: unknown) => {
      if (err instanceof CollaboratorApiError && err.data?.code === 'USER_NOT_FOUND' && err.data?.email) {
        setUserNotFoundEmail(err.data.email);
        setAddError('This person is not on the platform yet.');
      } else {
        setAddError(err instanceof Error ? err.message : 'Failed to add collaborator');
        setUserNotFoundEmail(null);
      }
    },
  });

  const inviteMutation = useMutation({
    mutationFn: (email: string) => inviteToPlatform({ email }),
    onSuccess: () => {
      setUserNotFoundEmail(null);
      setInviteSending(false);
    },
    onError: () => setInviteSending(false),
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setUserNotFoundEmail(null);
    const email = addEmail.trim().toLowerCase();
    if (!email) return;
    addMutation.mutate({ email, role: addRole });
  }

  function handleInviteToPlatform() {
    if (!userNotFoundEmail) return;
    setInviteSending(true);
    inviteMutation.mutate(userNotFoundEmail);
  }

  if (atLimit) {
    return (
      <div className={styles.collabLimitCard} role="status">
        This show has reached its collaborator limit ({limitValue}). Remove someone to invite another.
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleAdd} className={styles.collabForm}>
        <div className={styles.collabFormInputWrap}>
          <input
            type="email"
            placeholder="Email"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            className={styles.collabFormInput}
            required
          />
        </div>
        <div className={styles.collabFormActions}>
          <div className={styles.statusToggle} role="group" aria-label="Role">
            {(['view', 'editor', 'manager'] as const).map((role) => (
              <button
                key={role}
                type="button"
                className={addRole === role ? styles.statusToggleActive : styles.statusToggleBtn}
                onClick={() => setAddRole(role)}
                aria-pressed={addRole === role}
                aria-label={role.charAt(0).toUpperCase() + role.slice(1)}
              >
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </button>
            ))}
          </div>
          <button type="submit" className={styles.gearBtn} disabled={addMutation.isPending} aria-label="Add collaborator">
            <UserPlus size={16} strokeWidth={2} aria-hidden />
            {addMutation.isPending ? 'Adding...' : 'Add'}
          </button>
        </div>
      </form>

      {addError && (
        <div className={styles.collabError}>
          <p>{addError}</p>
          {userNotFoundEmail && (
            <button
              type="button"
              className={styles.invitePlatformBtn}
              onClick={handleInviteToPlatform}
              disabled={inviteMutation.isPending || inviteSending}
            >
              {inviteMutation.isPending || inviteSending ? 'Sending...' : 'Invite them to join the platform'}
            </button>
          )}
        </div>
      )}
    </>
  );
}

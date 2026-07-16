import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Edit, Plus, Trash2, Library, Radio, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { listUsers, deleteUser, updateUser, createUser, type User } from '../api/users';
import { formatDate, formatDateTime } from '../utils/format';
import { FailedToLoadCard } from '../components/FailedToLoadCard';
import { UnsavedChangesConfirmDialog } from '../components/UnsavedChangesConfirmDialog';
import { useDialogCloseGuard } from '../hooks/useDialogCloseGuard';
import { useBaselineDirty, snapshotForDirty } from '../hooks/useBaselineDirty';
import styles from './Users.module.css';

function formatBytes(bytes: number): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}

export function Users() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [userToEdit, setUserToEdit] = useState<User | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editRole, setEditRole] = useState<'user' | 'admin'>('user');
  const [editDisabled, setEditDisabled] = useState(false);
  const [editReadOnly, setEditReadOnly] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [editMaxPodcasts, setEditMaxPodcasts] = useState<number | null>(null);
  const [editMaxEpisodes, setEditMaxEpisodes] = useState<number | null>(null);
  const [editMaxStorageMb, setEditMaxStorageMb] = useState<number | null>(null);
  const [editMaxCollaborators, setEditMaxCollaborators] = useState<number | null>(null);
  const [editMaxSubscriberTokens, setEditMaxSubscriberTokens] = useState<number | null>(null);
  const [editCanTranscribe, setEditCanTranscribe] = useState(false);
  const [editCanGenerateVideo, setEditCanGenerateVideo] = useState(false);
  const [editCanStripe, setEditCanStripe] = useState(false);
  const [editCanEpisodeAlert, setEditCanEpisodeAlert] = useState(false);
  const [editFormBaseline, setEditFormBaseline] = useState<string | null>(null);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<'user' | 'admin'>('user');
  const [createFormBaseline, setCreateFormBaseline] = useState<string | null>(null);
  const limit = 50;
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['users', page, search],
    queryFn: () => listUsers(page, limit, search || undefined),
    refetchOnMount: 'always',
  });

  const deleteUserMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setUserToDelete(null);
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({
      userId,
      data,
    }: {
      userId: string;
      data: {
        email?: string;
        username?: string | null;
        role?: 'user' | 'admin';
        disabled?: boolean;
        read_only?: boolean;
        password?: string;
        max_podcasts?: number | null;
        max_episodes?: number | null;
        max_storage_mb?: number | null;
        max_collaborators?: number | null;
        max_subscriber_tokens?: number | null;
        can_transcribe?: boolean;
        can_generate_video?: boolean;
        can_stripe?: boolean;
      };
    }) => updateUser(userId, data as Parameters<typeof updateUser>[1]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      closeEditUser();
    },
  });

  const createUserMutation = useMutation({
    mutationFn: () => createUser({ email: createEmail.trim(), password: createPassword, role: createRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      closeCreateUser();
    },
  });

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1); // Reset to first page when search changes
  }

  function handleEditClick(user: User) {
    setUserToEdit(user);
    const next = {
      email: user.email ?? '',
      username: user.username ?? '',
      role: user.role as 'user' | 'admin',
      disabled: user.disabled === 1,
      readOnly: (user as { readOnly?: number }).readOnly === 1,
      password: '',
      maxPodcasts: user.maxPodcasts ?? null,
      maxEpisodes: user.maxEpisodes ?? null,
      maxStorageMb: user.maxStorageMb ?? null,
      maxCollaborators: user.maxCollaborators ?? null,
      maxSubscriberTokens: user.maxSubscriberTokens ?? null,
      canTranscribe: (user as { canTranscribe?: number }).canTranscribe === 1,
      canGenerateVideo: (user as { canGenerateVideo?: number }).canGenerateVideo === 1,
      canStripe: (user as { canStripe?: number }).canStripe === 1,
      canEpisodeAlert: (user as { canEpisodeAlert?: number }).canEpisodeAlert === 1,
    };
    setEditEmail(next.email);
    setEditUsername(next.username);
    setEditRole(next.role);
    setEditDisabled(next.disabled);
    setEditReadOnly(next.readOnly);
    setEditPassword('');
    setEditMaxPodcasts(next.maxPodcasts);
    setEditMaxEpisodes(next.maxEpisodes);
    setEditMaxStorageMb(next.maxStorageMb);
    setEditMaxCollaborators(next.maxCollaborators);
    setEditMaxSubscriberTokens(next.maxSubscriberTokens);
    setEditCanTranscribe(next.canTranscribe);
    setEditCanGenerateVideo(next.canGenerateVideo);
    setEditCanStripe(next.canStripe);
    setEditCanEpisodeAlert(next.canEpisodeAlert);
    setEditFormBaseline(snapshotForDirty(next));
  }

  function closeEditUser() {
    setUserToEdit(null);
    setEditFormBaseline(null);
  }

  function openCreateUser() {
    setCreateEmail('');
    setCreatePassword('');
    setCreateRole('user');
    setCreateFormBaseline(snapshotForDirty({ email: '', password: '', role: 'user' }));
    setCreateUserOpen(true);
  }

  function closeCreateUser() {
    setCreateUserOpen(false);
    setCreateEmail('');
    setCreatePassword('');
    setCreateRole('user');
    setCreateFormBaseline(null);
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userToEdit) return;

    const updates: Partial<import('@harborfm/shared').UserUpdateBody> = {};
    const currentEmail = userToEdit.email ?? '';
    if (editEmail.trim() !== currentEmail.trim() && editEmail.trim() !== '') {
      updates.email = editEmail.trim();
    }
    const currentUsername = userToEdit.username ?? '';
    const trimmedUsername = editUsername.trim();
    if (trimmedUsername !== currentUsername) {
      updates.username = trimmedUsername === '' ? null : trimmedUsername;
    }
    if (editRole !== userToEdit.role) {
      updates.role = editRole;
    }
    if (editDisabled !== (userToEdit.disabled === 1)) {
      updates.disabled = editDisabled;
    }
    if (editReadOnly !== ((userToEdit as { readOnly?: number }).readOnly === 1)) {
      updates.readOnly = editReadOnly;
    }
    if (editPassword.trim() !== '') {
      updates.password = editPassword;
    }
    if (editMaxPodcasts !== (userToEdit.maxPodcasts ?? null)) {
      updates.maxPodcasts = editMaxPodcasts;
    }
    if (editMaxEpisodes !== (userToEdit.maxEpisodes ?? null)) {
      updates.maxEpisodes = editMaxEpisodes;
    }
    if (editMaxStorageMb !== (userToEdit.maxStorageMb ?? null)) {
      updates.maxStorageMb = editMaxStorageMb;
    }
    if (editMaxCollaborators !== (userToEdit.maxCollaborators ?? null)) {
      updates.maxCollaborators = editMaxCollaborators;
    }
    if (editMaxSubscriberTokens !== (userToEdit.maxSubscriberTokens ?? null)) {
      updates.maxSubscriberTokens = editMaxSubscriberTokens;
    }
    const currentCanTranscribe = (userToEdit as { canTranscribe?: number }).canTranscribe === 1;
    if (editCanTranscribe !== currentCanTranscribe) {
      updates.canTranscribe = editCanTranscribe;
    }
    const currentCanGenerateVideo = (userToEdit as { canGenerateVideo?: number }).canGenerateVideo === 1;
    if (editCanGenerateVideo !== currentCanGenerateVideo) {
      updates.canGenerateVideo = editCanGenerateVideo;
    }
    const currentCanStripe = (userToEdit as { canStripe?: number }).canStripe === 1;
    if (editCanStripe !== currentCanStripe) {
      updates.canStripe = editCanStripe;
    }
    const currentCanEpisodeAlert =
      (userToEdit as { canEpisodeAlert?: number }).canEpisodeAlert === 1;
    if (editCanEpisodeAlert !== currentCanEpisodeAlert) {
      updates.canEpisodeAlert = editCanEpisodeAlert;
    }

    if (Object.keys(updates).length > 0) {
      updateUserMutation.mutate({ userId: userToEdit.id, data: updates });
    } else {
      closeEditUser();
    }
  }

  function handleDeleteClick(userId: string) {
    setUserToDelete(userId);
  }

  function handleDeleteConfirm() {
    if (userToDelete) {
      deleteUserMutation.mutate(userToDelete);
    }
  }

  const users = data?.users ?? [];
  const pagination = data?.pagination;

  const editFormCurrent = useMemo(
    () => ({
      email: editEmail,
      username: editUsername,
      role: editRole,
      disabled: editDisabled,
      readOnly: editReadOnly,
      password: editPassword,
      maxPodcasts: editMaxPodcasts,
      maxEpisodes: editMaxEpisodes,
      maxStorageMb: editMaxStorageMb,
      maxCollaborators: editMaxCollaborators,
      maxSubscriberTokens: editMaxSubscriberTokens,
      canTranscribe: editCanTranscribe,
      canGenerateVideo: editCanGenerateVideo,
      canStripe: editCanStripe,
      canEpisodeAlert: editCanEpisodeAlert,
    }),
    [
      editEmail,
      editUsername,
      editRole,
      editDisabled,
      editReadOnly,
      editPassword,
      editMaxPodcasts,
      editMaxEpisodes,
      editMaxStorageMb,
      editMaxCollaborators,
      editMaxSubscriberTokens,
      editCanTranscribe,
      editCanGenerateVideo,
      editCanStripe,
      editCanEpisodeAlert,
    ],
  );
  const editIsDirty = useBaselineDirty(editFormBaseline, editFormCurrent);
  const editCloseGuard = useDialogCloseGuard({ isDirty: editIsDirty, onClose: closeEditUser });

  const createFormCurrent = useMemo(
    () => ({ email: createEmail, password: createPassword, role: createRole }),
    [createEmail, createPassword, createRole],
  );
  const createIsDirty = useBaselineDirty(createFormBaseline, createFormCurrent);
  const createCloseGuard = useDialogCloseGuard({ isDirty: createIsDirty, onClose: closeCreateUser });

  return (
    <div className={styles.users}>
      <div className={styles.head}>
        <h1 className={styles.title}>Users</h1>
      </div>
      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search by email or username..."
          value={search}
          onChange={handleSearchChange}
          aria-label="Search by email or username"
        />
        <button
          type="button"
          className={styles.createUserBtn}
          onClick={openCreateUser}
          aria-label="Create user"
        >
          <Plus size={18} strokeWidth={2} aria-hidden />
          Create User
        </button>
      </div>
      {isLoading && <p className={styles.muted}>Loading users...</p>}
      {isError && <FailedToLoadCard title="Failed to load users" />}
      {!isLoading && !isError && (
        <>
          {users.length === 0 ? (
            <div className={styles.empty}>
              <p>No users found.</p>
            </div>
          ) : (
            <div className={styles.userList}>
              {users.map((user) => {
                const displayLabel = user.email ?? (user.username ? `@${user.username}` : null) ?? '-';
                const hasBoth = user.email && user.username;
                return (
                  <div key={user.id} className={styles.userCard}>
                    <div className={styles.userCardRow}>
                      <div className={styles.userCardLeft}>
                        <div className={styles.userCardIdentity}>
                          <h2 className={styles.userCardEmail}>{displayLabel}</h2>
                          {hasBoth && <p className={styles.userCardSub}>@{user.username}</p>}
                          {user.federatedIdentities && user.federatedIdentities.length > 0 && (
                            <p className={styles.userCardFederated}>
                              Federated ({user.federatedIdentities
                                .map((fi) => fi.providerName ?? fi.providerType.toUpperCase())
                                .join(', ')})
                            </p>
                          )}
                        </div>
                      </div>
                      <div className={styles.userCardActions}>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          onClick={() => navigate(`/dashboard/${user.id}`)}
                          title="View podcasts"
                          aria-label={`View podcasts for ${displayLabel}`}
                        >
                          <Radio size={16} strokeWidth={2} aria-hidden />
                          <span>Podcasts</span>
                        </button>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          onClick={() => navigate(`/library/${user.id}`)}
                          title="View library"
                          aria-label={`View library for ${displayLabel}`}
                        >
                          <Library size={16} strokeWidth={2} aria-hidden />
                          <span>Library</span>
                        </button>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          onClick={() => handleEditClick(user)}
                          title="Edit User"
                          aria-label={`Edit user ${displayLabel}`}
                        >
                          <Edit size={16} strokeWidth={2} aria-hidden />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                          onClick={() => handleDeleteClick(user.id)}
                          title="Delete user"
                          aria-label={`Delete user ${displayLabel}`}
                        >
                          <Trash2 size={16} strokeWidth={2} aria-hidden />
                        </button>
                      </div>
                    </div>
                    <div className={styles.userCardDetailsRow}>
                      <p className={styles.userCardMeta}>
                        <span className={user.role === 'admin' ? styles.roleAdmin : styles.roleUser}>
                          {user.role}
                        </span>
                        {' • '}
                        Created {formatDate(user.createdAt)}
                        {' • '}
                        Storage {formatBytes(user.diskBytesUsed ?? 0)}
                      </p>
                      {(user.lastLoginAt != null || user.lastLoginIp != null || user.lastLoginLocation) && (
                        <p className={styles.userCardLastLogin}>
                          Last login: {user.lastLoginAt != null ? formatDateTime(user.lastLoginAt) : '-'}
                          {user.lastLoginIp != null && <> · {user.lastLoginIp}</>}
                          {user.lastLoginLocation != null && user.lastLoginLocation !== '' && (
                            <> · {user.lastLoginLocation}</>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {pagination && (
            <p className={styles.subtitleRight}>
              Showing {users.length} of {pagination.total} users
              {search && ` matching "${search}"`}
            </p>
          )}
          {pagination && pagination.totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Go to previous page"
              >
                Previous
              </button>
              <span className={styles.pageInfo}>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                aria-label="Go to next page"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      <Dialog.Root open={!!userToEdit} onOpenChange={editCloseGuard.onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentScrollable}`}
            {...editCloseGuard.dialogContentProps}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Edit User</Dialog.Title>
              <button type="button" className={styles.dialogClose} aria-label="Close" onClick={editCloseGuard.requestClose}>
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              Update the user email, username, password, role, and limits.
            </Dialog.Description>
            <form onSubmit={handleEditSubmit} className={styles.dialogFormWrap}>
              <div className={styles.dialogBodyScroll}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Email
                  <input
                    type="email"
                    className={styles.formInput}
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="Optional for federated users"
                  />
                </label>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Username
                  <input
                    type="text"
                    className={styles.formInput}
                    value={editUsername}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditUsername(v.replace(/[^a-zA-Z0-9_]/g, ''));
                    }}
                    placeholder="Letters, numbers, underscore (min 6)"
                    minLength={6}
                  />
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Letters, numbers, and underscores only. At least 6 characters. Leave blank to clear.
                </p>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Password
                  <input
                    type="password"
                    className={styles.formInput}
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Leave blank to keep current password"
                  />
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Leave blank to keep the current password.
                </p>
              </div>
              <div className={styles.formGroup}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={editDisabled}
                    onChange={(e) => setEditDisabled(e.target.checked)}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Disabled</span>
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '3.5rem' }}>
                  When enabled, a user cannot log in.
                </p>
              </div>
              <div className={styles.formGroup}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={editReadOnly}
                    onChange={(e) => setEditReadOnly(e.target.checked)}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Read Only</span>
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '3.5rem' }}>
                  When enabled, the user can view content but cannot create or edit podcasts, episodes, library items, or run build/S3 export.
                </p>
              </div>
              <div className={styles.formGroup}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={editCanTranscribe}
                    onChange={(e) => setEditCanTranscribe(e.target.checked)}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Can Transcribe</span>
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '3.5rem' }}>
                  When enabled, the user can generate episode and segment transcripts (when a transcription provider is configured).
                </p>
              </div>
              <div className={styles.formGroup}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={editCanGenerateVideo}
                    onChange={(e) => setEditCanGenerateVideo(e.target.checked)}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Can Generate Video</span>
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '3.5rem' }}>
                  When enabled, the user can generate episode videos (when video generation is enabled on the server).
                </p>
              </div>
              <div className={styles.formGroup}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={editCanStripe}
                    onChange={(e) => setEditCanStripe(e.target.checked)}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Can Stripe</span>
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '3.5rem' }}>
                  When enabled, the user can configure Stripe paid subscriptions on their shows.
                </p>
              </div>
              <div className={styles.formGroup}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={editCanEpisodeAlert}
                    onChange={(e) => setEditCanEpisodeAlert(e.target.checked)}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Can Episode Alert</span>
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '3.5rem' }}>
                  When enabled, the user can configure Episode Alerts on their shows.
                </p>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Role
                  <div className={styles.roleToggle} role="group" aria-label="User role">
                    <button
                      type="button"
                      className={editRole === 'user' ? styles.roleToggleBtnActive : styles.roleToggleBtn}
                      onClick={() => setEditRole('user')}
                      aria-label="Set role to User"
                      aria-pressed={editRole === 'user'}
                    >
                      User
                    </button>
                    <button
                      type="button"
                      className={editRole === 'admin' ? styles.roleToggleBtnActive : styles.roleToggleBtn}
                      onClick={() => setEditRole('admin')}
                      aria-label="Set role to Admin"
                      aria-pressed={editRole === 'admin'}
                    >
                      Admin
                    </button>
                  </div>
                </label>
              </div>
              <div className={styles.formGroup}>
                <p className={styles.formSectionHeader}>
                  Limits (Leave Empty for No Limit)
                </p>
                <label className={styles.formLabel}>
                  Max Podcasts
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={styles.formInput}
                    placeholder="No limit"
                    value={editMaxPodcasts ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditMaxPodcasts(v === '' ? null : Number(v));
                    }}
                  />
                </label>
                <label className={styles.formLabel} style={{ marginTop: '0.5rem' }}>
                  Max Episodes
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={styles.formInput}
                    placeholder="No limit"
                    value={editMaxEpisodes ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditMaxEpisodes(v === '' ? null : Number(v));
                    }}
                  />
                </label>
                <label className={styles.formLabel} style={{ marginTop: '0.5rem' }}>
                  Max Storage (MB)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={styles.formInput}
                    placeholder="No limit"
                    value={editMaxStorageMb ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditMaxStorageMb(v === '' ? null : Number(v));
                    }}
                  />
                </label>
                <label className={styles.formLabel} style={{ marginTop: '0.5rem' }}>
                  Max Collaborators
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={styles.formInput}
                    placeholder="No limit"
                    value={editMaxCollaborators ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditMaxCollaborators(v === '' ? null : Number(v));
                    }}
                  />
                </label>
                <label className={styles.formLabel} style={{ marginTop: '0.5rem' }}>
                  Max Subscriber Tokens
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={styles.formInput}
                    placeholder="No limit"
                    value={editMaxSubscriberTokens ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditMaxSubscriberTokens(v === '' ? null : Number(v));
                    }}
                  />
                </label>
              </div>
              </div>
              {updateUserMutation.isError && (
                <div className={styles.noticeError} role="alert" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className={styles.noticeTitle}>Error</span>
                  <p className={styles.noticeBody}>
                    {updateUserMutation.error instanceof Error ? updateUserMutation.error.message : 'Failed to update user'}
                  </p>
                </div>
              )}
              <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
                <button type="button" className={styles.cancel} aria-label="Cancel editing user" onClick={editCloseGuard.requestClose}>Cancel</button>
                <button
                  type="submit"
                  className={styles.dialogConfirm}
                  disabled={updateUserMutation.isPending}
                  aria-label="Save user changes"
                >
                  {updateUserMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
        <UnsavedChangesConfirmDialog
          open={editCloseGuard.confirmOpen}
          onOpenChange={editCloseGuard.handleConfirmOpenChange}
          onDiscard={editCloseGuard.handleDiscard}
        />
      </Dialog.Root>

      <Dialog.Root open={createUserOpen} onOpenChange={createCloseGuard.onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent} {...createCloseGuard.dialogContentProps}>
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Create User</Dialog.Title>
              <button type="button" className={styles.dialogClose} aria-label="Close" onClick={createCloseGuard.requestClose}>
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              Add a new user account. They can sign in with this email and password.
            </Dialog.Description>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const email = createEmail.trim();
                if (!email || !email.includes('@')) return;
                if (createPassword.length < 8) return;
                createUserMutation.mutate();
              }}
              className={styles.dialogFormWrap}
            >
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Email
                  <input
                    type="email"
                    className={styles.formInput}
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Password
                  <input
                    type="password"
                    className={styles.formInput}
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  At least 8 characters.
                </p>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Role
                  <div className={styles.roleToggle} role="group" aria-label="User role">
                    <button
                      type="button"
                      className={createRole === 'user' ? styles.roleToggleBtnActive : styles.roleToggleBtn}
                      onClick={() => setCreateRole('user')}
                      aria-pressed={createRole === 'user'}
                    >
                      User
                    </button>
                    <button
                      type="button"
                      className={createRole === 'admin' ? styles.roleToggleBtnActive : styles.roleToggleBtn}
                      onClick={() => setCreateRole('admin')}
                      aria-pressed={createRole === 'admin'}
                    >
                      Admin
                    </button>
                  </div>
                </label>
              </div>
              {createUserMutation.isError && (
                <div className={styles.noticeError} role="alert" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className={styles.noticeTitle}>Error</span>
                  <p className={styles.noticeBody}>
                    {createUserMutation.error instanceof Error ? createUserMutation.error.message : 'Failed to create user'}
                  </p>
                </div>
              )}
              <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
                <button type="button" className={styles.cancel} aria-label="Cancel" onClick={createCloseGuard.requestClose}>
                  <X size={16} strokeWidth={2} aria-hidden />
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.dialogConfirm}
                  disabled={createUserMutation.isPending || !createEmail.trim() || createPassword.length < 8}
                  aria-label="Create user"
                >
                  <Plus size={16} strokeWidth={2} aria-hidden />
                  {createUserMutation.isPending ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
        <UnsavedChangesConfirmDialog
          open={createCloseGuard.confirmOpen}
          onOpenChange={createCloseGuard.handleConfirmOpenChange}
          onDiscard={createCloseGuard.handleDiscard}
        />
      </Dialog.Root>

      <Dialog.Root open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Delete user?</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className={styles.dialogClose} aria-label="Close">
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              {userToDelete && (() => {
                const user = users.find((u) => u.id === userToDelete);
                const label = user ? (user.email ?? (user.username ? `@${user.username}` : null) ?? 'this user') : 'this user';
                return `Are you sure you want to delete "${label}"? This action cannot be undone.`;
              })()}
            </Dialog.Description>
            <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel} aria-label="Cancel deleting user">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className={styles.dialogConfirmRemove}
                onClick={handleDeleteConfirm}
                disabled={deleteUserMutation.isPending}
                aria-label="Confirm delete user"
              >
                {deleteUserMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

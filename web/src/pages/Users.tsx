import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Edit, Trash2, Library, Radio } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { listUsers, deleteUser, updateUser, type User } from '../api/users';
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
  const [editRole, setEditRole] = useState<'user' | 'admin'>('user');
  const [editDisabled, setEditDisabled] = useState(false);
  const [editPassword, setEditPassword] = useState('');
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
    mutationFn: ({ userId, data }: { userId: string; data: { email?: string; role?: 'user' | 'admin'; disabled?: boolean; password?: string } }) =>
      updateUser(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setUserToEdit(null);
    },
  });

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1); // Reset to first page when search changes
  }

  function handleEditClick(user: User) {
    setUserToEdit(user);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditDisabled(user.disabled === 1);
    setEditPassword('');
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userToEdit) return;

    const updates: { email?: string; role?: 'user' | 'admin'; disabled?: boolean; password?: string } = {};
    if (editEmail !== userToEdit.email) {
      updates.email = editEmail;
    }
    if (editRole !== userToEdit.role) {
      updates.role = editRole;
    }
    if (editDisabled !== (userToEdit.disabled === 1)) {
      updates.disabled = editDisabled;
    }
    if (editPassword.trim() !== '') {
      updates.password = editPassword;
    }

    if (Object.keys(updates).length > 0) {
      updateUserMutation.mutate({ userId: userToEdit.id, data: updates });
    } else {
      setUserToEdit(null);
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

  return (
    <div className={styles.users}>
      <div className={styles.head}>
        <h1 className={styles.title}>Users</h1>
      </div>
      <div className={styles.searchWrap}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search by email…"
          value={search}
          onChange={handleSearchChange}
        />
      </div>
      {isLoading && <p className={styles.muted}>Loading users…</p>}
      {isError && <p className={styles.error}>Failed to load users.</p>}
      {!isLoading && !isError && (
        <>
          {pagination && (
            <p className={styles.subtitle}>
              Showing {users.length} of {pagination.total} users
              {search && ` matching "${search}"`}
            </p>
          )}
          {users.length === 0 ? (
            <div className={styles.empty}>
              <p>No users found.</p>
            </div>
          ) : (
            <>
              <div className={styles.userList}>
                {users.map((user) => (
                  <div key={user.id} className={styles.userCard}>
                    <div className={styles.userCardRow}>
                      <div className={styles.userCardLeft}>
                        <h3 className={styles.userCardEmail}>{user.email}</h3>
                      </div>
                      <div className={styles.userCardActions}>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          onClick={() => navigate(`/dashboard/${user.id}`)}
                          title="View podcasts"
                          aria-label={`View podcasts for ${user.email}`}
                        >
                          <Radio size={16} strokeWidth={2} aria-hidden />
                          <span>Podcasts</span>
                        </button>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          onClick={() => navigate(`/library/${user.id}`)}
                          title="View library"
                          aria-label={`View library for ${user.email}`}
                        >
                          <Library size={16} strokeWidth={2} aria-hidden />
                          <span>Library</span>
                        </button>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          onClick={() => handleEditClick(user)}
                          title="Edit user"
                          aria-label={`Edit user ${user.email}`}
                        >
                          <Edit size={16} strokeWidth={2} aria-hidden />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                          onClick={() => handleDeleteClick(user.id)}
                          title="Delete user"
                          aria-label={`Delete user ${user.email}`}
                        >
                          <Trash2 size={16} strokeWidth={2} aria-hidden />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                    <p className={styles.userCardMeta}>
                      <span className={user.role === 'admin' ? styles.roleAdmin : styles.roleUser}>
                        {user.role}
                      </span>
                      {' • '}
                      Created {new Date(user.created_at).toLocaleDateString()}
                      {' • '}
                      Storage {formatBytes(user.disk_bytes_used ?? 0)}
                    </p>
                  </div>
                ))}
              </div>
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
        </>
      )}

      <Dialog.Root open={!!userToEdit} onOpenChange={(open) => !open && setUserToEdit(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <Dialog.Title className={styles.dialogTitle}>Edit user</Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              Update the user email, password, and role.
            </Dialog.Description>
            <form onSubmit={handleEditSubmit}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Email
                  <input
                    type="email"
                    className={styles.formInput}
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    required
                  />
                </label>
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
              {updateUserMutation.isError && (
                <p className={styles.error} style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  {updateUserMutation.error instanceof Error ? updateUserMutation.error.message : 'Failed to update user'}
                </p>
              )}
              <div className={styles.dialogActions}>
                <Dialog.Close asChild>
                  <button type="button" className={styles.cancel} aria-label="Cancel editing user">Cancel</button>
                </Dialog.Close>
                <button
                  type="submit"
                  className={styles.dialogConfirm}
                  disabled={updateUserMutation.isPending}
                  aria-label="Save user changes"
                >
                  {updateUserMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <Dialog.Title className={styles.dialogTitle}>Delete user?</Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              {userToDelete && (() => {
                const user = users.find((u) => u.id === userToDelete);
                return user
                  ? `Are you sure you want to delete "${user.email}"? This action cannot be undone.`
                  : 'Are you sure you want to delete this user? This action cannot be undone.';
              })()}
            </Dialog.Description>
            <div className={styles.dialogActions}>
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
                {deleteUserMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

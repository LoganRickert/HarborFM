import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { me } from '../api/auth';
import { listApiKeys, createApiKey, revokeApiKey, type ApiKeyRecord, type ApiKeyCreateResponse } from '../api/apiKeys';
import { FullPageLoading } from '../components/Loading';
import { Key, Plus, Trash2, Copy, X } from 'lucide-react';
import styles from './Profile.module.css';

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const MAX_API_KEYS = 5;

export function Profile() {
  const queryClient = useQueryClient();
  const [newKeyResult, setNewKeyResult] = useState<ApiKeyCreateResponse | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: me,
  });

  const { data: apiKeysData, isLoading: apiKeysLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
  });

  const createKeyMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (result) => {
      setNewKeyResult(result);
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const apiKeys = apiKeysData?.api_keys ?? [];
  const atKeyLimit = apiKeys.length >= MAX_API_KEYS;

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key);
  }

  if (isLoading) {
    return <FullPageLoading />;
  }

  if (isError || !data?.user) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>Could not load your profile. Please try again.</p>
      </div>
    );
  }

  const { user } = data;
  const roleLabel = user.role === 'admin' ? 'Administrator' : 'User';
  const hasLimits =
    user.max_podcasts != null || user.max_episodes != null || user.max_storage_mb != null;
  const hasLastLogin =
    !user.read_only &&
    (user.last_login_at != null || user.last_login_ip != null || user.last_login_location != null);

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>Profile</h1>
        <p className={styles.heroSub}>
          Your account details and settings.{' '}
          <Link to="/contact" className={styles.heroLink}>Contact site administrators.</Link>
        </p>
      </header>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Account</h2>
        <p className={styles.cardSub}>Basic information about your account</p>
        <dl className={styles.list}>
          <div className={styles.row}>
            <dt className={styles.term}>Email</dt>
            <dd className={styles.detail}>{user.email}</dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>Role</dt>
            <dd className={styles.detail}>{roleLabel}</dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>Account created</dt>
            <dd className={styles.detail}>{formatDate(user.created_at)}</dd>
          </div>
          {user.read_only ? (
            <div className={styles.row}>
              <dt className={styles.term}>Mode</dt>
              <dd className={styles.detail}>
                <span className={styles.badge}>Read-only</span> — You can view content but not create or edit.
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {hasLastLogin && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Last login</h2>
          <p className={styles.cardSub}>When and where you last signed in</p>
          <dl className={styles.list}>
            {user.last_login_at != null && (
              <div className={styles.row}>
                <dt className={styles.term}>Time</dt>
                <dd className={styles.detail}>{formatDateTime(user.last_login_at)}</dd>
              </div>
            )}
            {user.last_login_ip != null && (
              <div className={styles.row}>
                <dt className={styles.term}>IP address</dt>
                <dd className={styles.detail}>{user.last_login_ip}</dd>
              </div>
            )}
            {user.last_login_location != null && (
              <div className={styles.row}>
                <dt className={styles.term}>Location</dt>
                <dd className={styles.detail}>{user.last_login_location}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Usage</h2>
        <p className={styles.cardSub}>Your podcasts and storage</p>
        <dl className={styles.list}>
          <div className={styles.row}>
            <dt className={styles.term}>Podcasts</dt>
            <dd className={styles.detail}>
              {data.podcast_count}
              {user.max_podcasts != null && user.max_podcasts > 0
                ? ` of ${user.max_podcasts}`
                : ''}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>Episodes</dt>
            <dd className={styles.detail}>
              {data.episode_count}
              {user.max_episodes != null && user.max_episodes > 0
                ? ` of ${user.max_episodes}`
                : ''}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>Storage used</dt>
            <dd className={styles.detail}>
              {formatBytes(user.disk_bytes_used ?? 0)}
              {user.max_storage_mb != null && user.max_storage_mb > 0
                ? ` of ${user.max_storage_mb} MB`
                : ''}
            </dd>
          </div>
        </dl>
        {!hasLimits && (
          <p className={styles.cardNote}>You don’t have any limits set on your account.</p>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.apiKeyCardHeader}>
          <div>
            <h2 className={styles.cardTitle}>API Keys</h2>
            <p className={styles.cardSub}>
              Use API keys for scripted or programmatic access. Each key has the same access as your account. You can have up to {MAX_API_KEYS} keys.{' '}
              <a href="/api/docs" target="_blank" rel="noopener noreferrer" className={styles.docsLink}>
                View API documentation
              </a>{' '}
              to explore and try endpoints with your key.
            </p>
          </div>
          <button
            type="button"
            className={styles.createKeyBtn}
            onClick={() => createKeyMutation.mutate()}
            disabled={apiKeysLoading || atKeyLimit || createKeyMutation.isPending || !!user.read_only}
            title={user.read_only ? 'Read-only account' : undefined}
          >
            <Plus size={18} strokeWidth={2} aria-hidden />
            Generate New Key
          </button>
        </div>
        {apiKeysLoading ? (
          <p className={styles.muted}>Loading...</p>
        ) : (
          <>
            <ul className={styles.apiKeyList}>
              {apiKeys.map((key) => (
                <ApiKeyRow
                  key={key.id}
                  record={key}
                  onRevoke={() => revokeKeyMutation.mutate(key.id)}
                  revoking={revokeKeyMutation.isPending}
                  readOnly={!!user.read_only}
                  formatDateTime={formatDateTime}
                />
              ))}
            </ul>
            {atKeyLimit && (
              <p className={styles.keyLimitNote}>Revoke a key to create another.</p>
            )}
          </>
        )}
      </section>

      {newKeyResult && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="new-key-title">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <Key size={24} strokeWidth={2} className={styles.modalIcon} aria-hidden />
              <h3 id="new-key-title" className={styles.modalTitle}>API key created</h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setNewKeyResult(null)}
                aria-label="Close"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>
            <p className={styles.modalWarn}>
              Copy this key now. You won't be able to see it again.
            </p>
            <div className={styles.keyDisplay}>
              <code className={styles.keyValue}>{newKeyResult.key}</code>
              <button
                type="button"
                className={styles.copyBtn}
                onClick={() => copyKey(newKeyResult.key)}
              >
                <Copy size={18} strokeWidth={2} aria-hidden />
                Copy
              </button>
            </div>
            <p className={styles.modalSub}>
              Use it in requests: <code>Authorization: Bearer {newKeyResult.key.slice(0, 12)}...</code>
            </p>
            <button
              type="button"
              className={styles.modalDone}
              onClick={() => setNewKeyResult(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ApiKeyRow({
  record,
  onRevoke,
  revoking,
  readOnly,
  formatDateTime,
}: {
  record: ApiKeyRecord;
  onRevoke: () => void;
  revoking: boolean;
  readOnly: boolean;
  formatDateTime: (iso: string | null | undefined) => string;
}) {
  return (
    <li className={styles.apiKeyRow}>
      <div className={styles.apiKeyMeta}>
        <span className={styles.apiKeyCreated}>Created {formatDateTime(record.created_at)}</span>
        {record.last_used_at != null && (
          <span className={styles.apiKeyLastUsed}>Last used {formatDateTime(record.last_used_at)}</span>
        )}
      </div>
      <button
        type="button"
        className={styles.revokeBtn}
        onClick={onRevoke}
        disabled={revoking || readOnly}
        aria-label="Revoke this API key"
        title={readOnly ? 'Read-only account' : undefined}
      >
        <Trash2 size={16} strokeWidth={2} aria-hidden />
        Revoke
      </button>
    </li>
  );
}

import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { me } from '../api/auth';
import { listApiKeys, updateApiKey, revokeApiKey, type ApiKeyCreateResponse, type ApiKeyRecord } from '../api/apiKeys';
import { ApiKeyCreatedCard } from '../components/ApiKeys/ApiKeyCreatedCard';
import { ApiKeyForm } from '../components/ApiKeys/ApiKeyForm';
import { ApiKeyRevokeDialog } from '../components/ApiKeys/ApiKeyRevokeDialog';
import { FailedToLoadCard } from '../components/FailedToLoadCard';
import { FullPageLoading } from '../components/Loading';
import { SubscriberTokenControls } from '../components/SubscriberTokens/SubscriberTokenControls';
import { SubscriberTokenPagination } from '../components/SubscriberTokens/SubscriberTokenPagination';
import { Key } from 'lucide-react';
import { TokenListRow, type TokenStatus } from '../components/TokenListRow';
import { formatDate as formatDateUtil, formatDateTime as formatDateTimeUtil } from '../utils/format';
import { formatDateForInput } from '../utils/datetime';
import styles from './Profile.module.css';
import sharedStyles from '../components/PodcastDetail/shared.module.css';
import tokenStyles from '../components/SubscriberTokens/SubscriberTokens.module.css';

const apiKeySectionStyles = { ...sharedStyles, ...tokenStyles };
const API_KEYS_PAGE_SIZE = 10;

function formatDate(iso: string | null | undefined): string {
  const s = formatDateUtil(iso);
  return s || '-';
}

function formatDateTime(iso: string | null | undefined): string {
  const s = formatDateTimeUtil(iso);
  return s || '-';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function Profile() {
  const queryClient = useQueryClient();
  const [newKeyResult, setNewKeyResult] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyRecord | null>(null);
  const [extendKeyId, setExtendKeyId] = useState<string | null>(null);
  const [extendValidUntil, setExtendValidUntil] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const apiKeysTitleRef = useRef<HTMLHeadingElement>(null);
  const skipScrollOnLoadRef = useRef(true);
  const prevPageRef = useRef<number | undefined>(undefined);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: me,
  });

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchDebounced('');
      setPage(1);
      return;
    }
    const id = window.setTimeout(() => {
      setSearchDebounced(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [sortNewestFirst]);

  // When user changes page, allow scroll once data is ready (cached or after load)
  useEffect(() => {
    if (prevPageRef.current !== undefined && prevPageRef.current !== page) {
      skipScrollOnLoadRef.current = false;
    }
    prevPageRef.current = page;
  }, [page]);

  const { data: apiKeysData, isLoading: apiKeysLoading } = useQuery({
    queryKey: ['api-keys', page, searchDebounced, sortNewestFirst],
    queryFn: () =>
      listApiKeys({
        limit: API_KEYS_PAGE_SIZE,
        offset: (page - 1) * API_KEYS_PAGE_SIZE,
        q: searchDebounced || undefined,
        sort: sortNewestFirst ? 'newest' : 'oldest',
      }),
  });

  const { data: apiKeysCountData } = useQuery({
    queryKey: ['api-keys-count'],
    queryFn: () => listApiKeys({ limit: 1, offset: 0 }),
  });

  const revokeKeyMutation = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      void queryClient.invalidateQueries({ queryKey: ['api-keys-count'] });
    },
  });

  const updateApiKeyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateApiKey>[1] }) => updateApiKey(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      void queryClient.invalidateQueries({ queryKey: ['api-keys-count'] });
      setExtendKeyId(null);
      setExtendValidUntil('');
    },
  });

  // Scroll to title when data is ready (immediately if cached, or after load)
  useEffect(() => {
    if (skipScrollOnLoadRef.current || apiKeysLoading) return;
    skipScrollOnLoadRef.current = true;
    const el = apiKeysTitleRef.current;
    const id = requestAnimationFrame(() => {
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [page, apiKeysLoading]);

  const apiKeys = apiKeysData?.api_keys ?? [];
  const totalTokens = apiKeysData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTokens / API_KEYS_PAGE_SIZE));
  const pageClamped = Math.max(1, Math.min(page, totalPages));
  const rangeStart = totalTokens === 0 ? 0 : (pageClamped - 1) * API_KEYS_PAGE_SIZE + 1;
  const rangeEnd = (pageClamped - 1) * API_KEYS_PAGE_SIZE + apiKeys.length;

  useEffect(() => {
    if (apiKeysData != null && totalTokens > 0 && page > totalPages) {
      setPage(Math.max(1, totalPages));
    }
  }, [totalPages, apiKeysData, totalTokens, page]);

  const allKeysCount = apiKeysCountData?.total ?? 0;
  const maxApiKeys = data?.user?.max_api_keys ?? 5;
  const atKeyLimit = allKeysCount >= maxApiKeys;

  function copyKey(key: string) {
    navigator.clipboard.writeText(key).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  if (isLoading) {
    return <FullPageLoading />;
  }

  if (isError || !data?.user) {
    return (
      <div className={styles.page}>
        <header className={styles.hero}>
          <h1 className={styles.heroTitle}>Profile</h1>
          <p className={styles.heroSub}>
            Your account details and settings.{' '}
            <Link to="/contact" className={styles.heroLink}>Contact site administrators.</Link>
          </p>
        </header>
        <FailedToLoadCard title="Failed to load profile" />
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
                <span className={styles.badge}>Read-only</span> - You can view content but not create or edit.
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

      <section className={`${apiKeySectionStyles.card} ${styles.apiKeysSection}`}>
        <div className={apiKeySectionStyles.exportHeader}>
          <div className={apiKeySectionStyles.exportTitle}>
            <Key size={18} strokeWidth={2} aria-hidden="true" />
            <h2 ref={apiKeysTitleRef} className={apiKeySectionStyles.sectionTitle}>API Keys</h2>
          </div>
        </div>
        <p className={apiKeySectionStyles.sectionSub}>
          Use API keys for scripted or programmatic access. Each key has the same access as your account. You can have up to {maxApiKeys} keys.{' '}
          <a href="/api/docs" target="_blank" rel="noopener noreferrer" className={styles.docsLink}>
            View API documentation
          </a>{' '}
          to explore and try endpoints with your key.
        </p>

        {!user.read_only && (
          <ApiKeyForm
            atLimit={atKeyLimit}
            limitValue={maxApiKeys}
            readOnly={!!user.read_only}
            onSuccess={setNewKeyResult}
          />
        )}

        {newKeyResult && (
          <ApiKeyCreatedCard
            keyValue={newKeyResult.key}
            onDismiss={() => setNewKeyResult(null)}
            copied={copied}
            onCopy={() => copyKey(newKeyResult.key)}
          />
        )}

        {atKeyLimit && (
          <div className={styles.apiKeyLimitCard}>
            <p className={styles.apiKeyLimitText}>
              You can have at most {maxApiKeys} API keys. Revoke one to create another.
            </p>
          </div>
        )}

        <SubscriberTokenControls
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortNewestFirst={sortNewestFirst}
          onSortChange={setSortNewestFirst}
          totalCount={allKeysCount}
        />

        {apiKeysLoading ? (
          <p className={apiKeySectionStyles.tokenMuted}>Loading...</p>
        ) : allKeysCount === 0 ? (
          <p className={apiKeySectionStyles.tokenMuted}>No API keys yet. Create one above to use the API.</p>
        ) : totalTokens === 0 ? (
          <div className={apiKeySectionStyles.tokenNoMatch}>
            <p className={apiKeySectionStyles.tokenNoMatchText}>No keys match your search.</p>
          </div>
        ) : (
          <>
            <ul className={apiKeySectionStyles.exportList}>
              {apiKeys.map((key) => {
                const expired = key.valid_until != null && new Date(key.valid_until) < new Date();
                const disabled = key.disabled === 1;
                const status: TokenStatus = expired ? 'expired' : disabled ? 'disabled' : 'active';
                const name = key.name?.trim() || 'API Key';
                const metaParts = [`Created ${formatDateTime(key.created_at)}`];
                if (key.valid_until) metaParts.push(`Expires ${formatDateTime(key.valid_until)}`);
                if (key.last_used_at != null) metaParts.push(`Last used ${formatDateTime(key.last_used_at)}`);
                return (
                  <TokenListRow
                    key={key.id}
                    name={name}
                    status={status}
                    metaText={metaParts.join(' · ')}
                    readOnly={!!user.read_only}
                    extendEditing={extendKeyId === key.id}
                    extendValue={extendValidUntil}
                    onExtendValueChange={setExtendValidUntil}
                    onExtendSave={() => {
                      if (extendValidUntil.trim()) {
                        updateApiKeyMutation.mutate({
                          id: key.id,
                          body: { valid_until: new Date(extendValidUntil).toISOString() },
                        });
                      }
                    }}
                    onExtendCancel={() => {
                      setExtendKeyId(null);
                      setExtendValidUntil('');
                    }}
                    onExtendClick={() => {
                      setExtendKeyId(key.id);
                      const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
                      setExtendValidUntil(formatDateForInput(oneYearFromNow));
                    }}
                    onEnableDisable={() =>
                      updateApiKeyMutation.mutate({ id: key.id, body: { disabled: !disabled } })
                    }
                    enableDisableDisabled={updateApiKeyMutation.isPending || status === 'expired'}
                    onRevoke={() => setKeyToRevoke(key)}
                    revokeDisabled={revokeKeyMutation.isPending}
                    updatePending={updateApiKeyMutation.isPending}
                    revokeLabel="Revoke"
                  />
                );
              })}
            </ul>
            <SubscriberTokenPagination
              page={pageClamped}
              totalPages={totalPages}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              totalTokens={totalTokens}
              onPageChange={setPage}
              itemLabel="key"
            />
          </>
        )}
      </section>

      <ApiKeyRevokeDialog
        apiKey={keyToRevoke}
        isOpen={!!keyToRevoke}
        onClose={() => setKeyToRevoke(null)}
        onConfirm={(id) => revokeKeyMutation.mutate(id)}
        isPending={revokeKeyMutation.isPending}
      />
    </div>
  );
}


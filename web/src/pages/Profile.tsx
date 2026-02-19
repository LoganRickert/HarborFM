import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { me, updateProfile, send2FAEmailCode, type ProfileUpdateResponse } from '../api/auth';
import { USERNAME_REGEX } from '@harborfm/shared';
import { listApiKeys, updateApiKey, revokeApiKey, type ApiKeyCreateResponse, type ApiKeyRecord } from '../api/apiKeys';
import { ApiKeyCreatedCard } from '../components/ApiKeys/ApiKeyCreatedCard';
import { ApiKeyForm } from '../components/ApiKeys/ApiKeyForm';
import { ApiKeyRevokeDialog } from '../components/ApiKeys/ApiKeyRevokeDialog';
import { FailedToLoadCard } from '../components/FailedToLoadCard';
import { useAuthStore } from '../store/auth';
import { FullPageLoading } from '../components/Loading';
import { SubscriberTokenControls } from '../components/SubscriberTokens/SubscriberTokenControls';
import { SubscriberTokenPagination } from '../components/SubscriberTokens/SubscriberTokenPagination';
import { TwoFactorProfileSection } from '../components/TwoFactorProfile/TwoFactorProfileSection';
import { OtpInput } from '../components/OtpInput/OtpInput';
import { Key, Edit2 } from 'lucide-react';
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
  const setUser = useAuthStore((s) => s.setUser);
  const [newKeyResult, setNewKeyResult] = useState<ApiKeyCreateResponse | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileEmail, setProfileEmail] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [profilePassword, setProfilePassword] = useState('');
  const [profile2FACode, setProfile2FACode] = useState('');
  const [profileChallenge, setProfileChallenge] = useState<{
    method: 'totp' | 'email';
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyRecord | null>(null);
  const [extendKeyId, setExtendKeyId] = useState<string | null>(null);
  const [extendValidUntil, setExtendValidUntil] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const [verifyEmailNotice, setVerifyEmailNotice] = useState<string | null>(null);
  const [usernameNotAppliedNotice, setUsernameNotAppliedNotice] = useState(false);
  const [profileValidationError, setProfileValidationError] = useState<string | null>(null);
  const apiKeysTitleRef = useRef<HTMLHeadingElement>(null);
  const skipScrollOnLoadRef = useRef(true);
  const prevPageRef = useRef<number | undefined>(undefined);
  const lastAutoSentEmailRequestRef = useRef<boolean>(false);

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

  const updateProfileMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateProfile>[0]) => updateProfile(body),
    onSuccess: (data: ProfileUpdateResponse) => {
      if ('requires2FA' in data) {
        setProfileChallenge({ method: data.method });
      } else if ('user' in data) {
        setUser(data.user);
        void queryClient.invalidateQueries({ queryKey: ['me'] });
        setEditingProfile(false);
        setProfilePassword('');
        setProfile2FACode('');
        setProfileChallenge(null);
        setProfileValidationError(null);
        if (data.needsVerification) {
          setVerifyEmailNotice(data.message ?? "If that email can be used, we'll send a verification link.");
        }
        setUsernameNotAppliedNotice(data.applied?.username === false);
      }
    },
  });

  const sendEmailCodeMutation = useMutation({
    mutationFn: () => send2FAEmailCode(),
  });

  useEffect(() => {
    if (
      profileChallenge?.method === 'email' &&
      !lastAutoSentEmailRequestRef.current
    ) {
      lastAutoSentEmailRequestRef.current = true;
      sendEmailCodeMutation.mutate();
    }
  }, [profileChallenge?.method, sendEmailCodeMutation]);

  function startProfileEdit() {
    setProfileEmail(data?.user?.email ?? '');
    setProfileUsername(data?.user?.username ?? '');
    setProfilePassword('');
    setProfile2FACode('');
    setProfileChallenge(null);
        setVerifyEmailNotice(null);
        setUsernameNotAppliedNotice(false);
        setProfileValidationError(null);
        setEditingProfile(true);
  }

  function cancelProfileEdit() {
    setEditingProfile(false);
    setProfilePassword('');
    setProfile2FACode('');
    setProfileChallenge(null);
    setProfileValidationError(null);
    lastAutoSentEmailRequestRef.current = false;
    updateProfileMutation.reset();
  }

  function submitProfileUpdate() {
    setProfileValidationError(null);
    const emailChanged =
      profileEmail.trim() !== (data?.user?.email ?? '').trim();
    const clearingEmail = emailChanged && !profileEmail.trim();
    if (clearingEmail && data?.twoFactor?.hasEmail) {
      setProfileValidationError(
        "Cannot remove email while email 2FA is enabled. Disable email 2FA first, then you can remove your email.",
      );
      return;
    }
    const usernameValid =
      profileUsername.trim().length >= 6 && USERNAME_REGEX.test(profileUsername.trim());
    const usernameChanged =
      profileUsername.trim() !== (data?.user?.username ?? '').trim() && usernameValid;
    const hasChanges = emailChanged || usernameChanged;
    if (!hasChanges) {
      cancelProfileEdit();
      return;
    }
    const body: Parameters<typeof updateProfile>[0] = profileChallenge
      ? {
          code: profile2FACode,
          ...(emailChanged ? { email: profileEmail.trim() } : {}),
          ...(usernameChanged ? { username: profileUsername.trim() } : {}),
        }
      : data?.user?.hasPassword === false
        ? {
            ...(emailChanged ? { email: profileEmail.trim() } : {}),
            ...(usernameChanged ? { username: profileUsername.trim() } : {}),
          }
        : {
            password: profilePassword,
            ...(emailChanged ? { email: profileEmail.trim() } : {}),
            ...(usernameChanged ? { username: profileUsername.trim() } : {}),
          };
    updateProfileMutation.mutate(body);
  }

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

  const apiKeys = apiKeysData?.apiKeys ?? [];
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
  const maxApiKeys = data?.user?.maxApiKeys ?? 5;
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
    user.maxPodcasts != null || user.maxEpisodes != null || user.maxStorageMb != null;
  const hasLastLogin =
    !user.readOnly &&
    (user.lastLoginAt != null || user.lastLoginIp != null || user.lastLoginLocation != null);

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
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Account</h2>
            <p className={styles.cardSub}>Basic information about your account</p>
          </div>
          {!user.readOnly && !editingProfile && (
            <button
              type="button"
              className={styles.editHeaderBtn}
              onClick={startProfileEdit}
              aria-label="Edit email or username"
            >
              <Edit2 size={16} strokeWidth={2} aria-hidden />
              Edit
            </button>
          )}
        </div>
        {verifyEmailNotice && (
          <div className={styles.verifyEmailNotice} role="alert">
            <p className={styles.verifyEmailNoticeText}>{verifyEmailNotice}</p>
          </div>
        )}
        {usernameNotAppliedNotice && (
          <div className={styles.verifyEmailNotice} role="alert">
            <p className={styles.verifyEmailNoticeText}>
              Some changes couldn&apos;t be applied. Try a different username.
            </p>
          </div>
        )}
        {!editingProfile ? (
          <>
            <dl className={styles.list}>
              <div className={styles.row}>
                <dt className={styles.term}>Email</dt>
                <dd className={styles.detail}>{user.email ?? '-'}</dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.term}>Username</dt>
                <dd className={styles.detail}>{user.username ?? '-'}</dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.term}>Role</dt>
                <dd className={styles.detail}>{roleLabel}</dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.term}>Account created</dt>
                <dd className={styles.detail}>{formatDate(user.createdAt)}</dd>
              </div>
              {user.readOnly ? (
                <div className={styles.row}>
                  <dt className={styles.term}>Mode</dt>
                  <dd className={styles.detail}>
                    <span className={styles.badge}>Read-only</span> - You can view content but not create or edit.
                  </dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitProfileUpdate();
            }}
          >
            {(updateProfileMutation.error || profileValidationError) && (
              <div
                id="profile-update-error"
                className={styles.errorCard}
                role="alert"
                style={{ marginBottom: 12 }}
              >
                <p className={styles.errorCardText}>
                  {profileValidationError ?? updateProfileMutation.error?.message}
                </p>
              </div>
            )}
            {!profileChallenge ? (
              <>
                <label className={styles.label}>
                  Email
                  <input
                    type="email"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    className={styles.input}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </label>
                <label className={styles.label}>
                  Username
                  <input
                    type="text"
                    value={profileUsername}
                    onChange={(e) => setProfileUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                    className={styles.input}
                    placeholder="yourhandle"
                    autoComplete="username"
                    minLength={6}
                    pattern="[a-zA-Z0-9_]+"
                  />
                  {profileUsername.trim().length > 0 && profileUsername.trim().length < 6 && (
                    <span className={styles.muted}>Must be at least 6 characters</span>
                  )}
                  {profileUsername.trim().length >= 6 && !USERNAME_REGEX.test(profileUsername.trim()) && (
                    <span className={styles.muted}>Only letters, numbers, and underscores</span>
                  )}
                </label>
                {data?.user?.hasPassword === false && (
                  <div className={styles.federatedCard}>
                    <p className={styles.federatedCardText}>You signed in via your organization.</p>
                  </div>
                )}
                {data?.user?.hasPassword !== false && (
                  <label className={styles.label}>
                    Password
                    <input
                      type="password"
                      value={profilePassword}
                      onChange={(e) => setProfilePassword(e.target.value)}
                      className={`${styles.input} ${!profilePassword.trim() ? styles.inputError : ''}`}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                )}
              </>
            ) : (
              <>
                {profileChallenge.method === 'totp' && (
                  <p className={styles.cardNote} style={{ marginBottom: 12 }}>
                    Enter the 6-digit code from your authenticator app.
                  </p>
                )}
                <OtpInput
                  value={profile2FACode}
                  onChange={setProfile2FACode}
                  length={6}
                  disabled={updateProfileMutation.isPending}
                  label="Code"
                  error={!!(updateProfileMutation.error || profileValidationError)}
                  autoComplete="one-time-code"
                  ariaLabel="6-digit verification code"
                  ariaDescribedBy={
                    updateProfileMutation.error || profileValidationError
                      ? 'profile-update-error'
                      : undefined
                  }
                />
              </>
            )}
            <div className={styles.twoFactorBtnRow}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={cancelProfileEdit}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.primaryBtn}
                disabled={
                  updateProfileMutation.isPending ||
                  (!!profileChallenge && profile2FACode.length < 6) ||
                  (!profileChallenge &&
                    data?.user?.hasPassword !== false &&
                    !profilePassword.trim())
                }
              >
                {updateProfileMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
            {profileChallenge?.method === 'email' && (
              <div className={styles.federatedCard} style={{ marginTop: 12 }}>
                <p className={styles.federatedCardText}>A code was sent to your email. Enter it above.</p>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  style={{ marginTop: 8 }}
                  onClick={() => sendEmailCodeMutation.mutate()}
                  disabled={sendEmailCodeMutation.isPending}
                >
                  {sendEmailCodeMutation.isPending ? 'Sending...' : 'Resend code'}
                </button>
              </div>
            )}
          </form>
        )}
      </section>

      {hasLastLogin && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Last login</h2>
          <p className={styles.cardSub}>When and where you last signed in</p>
          <dl className={styles.list}>
            {user.lastLoginAt != null && (
              <div className={styles.row}>
                <dt className={styles.term}>Time</dt>
                <dd className={styles.detail}>{formatDateTime(user.lastLoginAt)}</dd>
              </div>
            )}
            {user.lastLoginIp != null && (
              <div className={styles.row}>
                <dt className={styles.term}>IP address</dt>
                <dd className={styles.detail}>{user.lastLoginIp}</dd>
              </div>
            )}
            {user.lastLoginLocation != null && (
              <div className={styles.row}>
                <dt className={styles.term}>Location</dt>
                <dd className={styles.detail}>{user.lastLoginLocation}</dd>
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
              {data.podcastCount}
              {user.maxPodcasts != null && user.maxPodcasts > 0
                ? ` of ${user.maxPodcasts}`
                : ''}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>Episodes</dt>
            <dd className={styles.detail}>
              {data.episodeCount}
              {user.maxEpisodes != null && user.maxEpisodes > 0
                ? ` of ${user.maxEpisodes}`
                : ''}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.term}>Storage used</dt>
            <dd className={styles.detail}>
              {formatBytes(user.diskBytesUsed ?? 0)}
              {user.maxStorageMb != null && user.maxStorageMb > 0
                ? ` of ${user.maxStorageMb} MB`
                : ''}
            </dd>
          </div>
        </dl>
        {!hasLimits && (
          <p className={styles.cardNote}>You don’t have any limits set on your account.</p>
        )}
      </section>

      {!user.readOnly && (
        <TwoFactorProfileSection
          twoFactor={data.twoFactor}
          hasEmail={Boolean(user?.email?.trim())}
          hasPassword={user?.hasPassword !== false}
        />
      )}

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

        {!user.readOnly && (
          <ApiKeyForm
            atLimit={atKeyLimit}
            limitValue={maxApiKeys}
            readOnly={!!user.readOnly}
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
                const expired = key.validUntil != null && new Date(key.validUntil) < new Date();
                const disabled = key.disabled === 1;
                const status: TokenStatus = expired ? 'expired' : disabled ? 'disabled' : 'active';
                const name = key.name?.trim() || 'API Key';
                const metaParts = [`Created ${formatDateTime(key.createdAt)}`];
                if (key.validUntil) metaParts.push(`Expires ${formatDateTime(key.validUntil)}`);
                if (key.lastUsedAt != null) metaParts.push(`Last used ${formatDateTime(key.lastUsedAt)}`);
                return (
                  <TokenListRow
                    key={key.id}
                    name={name}
                    status={status}
                    metaText={metaParts.join(' · ')}
                    readOnly={!!user.readOnly}
                    extendEditing={extendKeyId === key.id}
                    extendValue={extendValidUntil}
                    onExtendValueChange={setExtendValidUntil}
                    onExtendSave={() => {
                      if (extendValidUntil.trim()) {
                        updateApiKeyMutation.mutate({
                          id: key.id,
                          body: { validUntil: new Date(extendValidUntil).toISOString() },
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


import { useMemo, useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import styles from './Auth.module.css';
import { completeSetup, setupStatus, validateSetupId } from '../api/setup';
import { FullPageLoading } from '../components/Loading';
import { ServerDown } from '../components/ServerDown';

export function Setup() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const setupId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return (params.get('id') || '').trim();
  }, [location.search]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    retry: false,
    staleTime: 10_000,
  });

  const {
    isLoading: validateLoading,
    isError: validateError,
    error: validateErr,
    data: validateOk,
    refetch: refetchValidate,
  } = useQuery({
    queryKey: ['setupValidate', setupId],
    queryFn: () => validateSetupId(setupId),
    enabled: !!setupId && Boolean(data?.setupRequired),
    retry: false,
    staleTime: 10_000,
  });

  const defaultHostname = useMemo(() => {
    if (typeof window === 'undefined') return '';
    // Includes hostname + port (if any), with scheme (e.g. http://localhost:5173)
    return window.location.origin;
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hostname, setHostname] = useState(defaultHostname);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [publicFeedsEnabled, setPublicFeedsEnabled] = useState(true);
  const [importPixabayAssets, setImportPixabayAssets] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      completeSetup(setupId, {
        email,
        password,
        hostname: hostname.trim().replace(/\/+$/, ''),
        registration_enabled: registrationEnabled,
        public_feeds_enabled: publicFeedsEnabled,
        import_pixabay_assets: importPixabayAssets,
      }),
    onSuccess: async () => {
      // Prevent SetupGuard from using stale cached setupRequired=true.
      queryClient.setQueryData(['setupStatus'], { setupRequired: false });
      queryClient.invalidateQueries({ queryKey: ['setupStatus'] });

      // Setup should not log in; go to login explicitly.
      navigate('/login', { replace: true });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!setupId) return;
    mutation.mutate();
  }

  if (isLoading) {
    return (
      <main>
        <div className={styles.wrap}>
          <div className={styles.card}>
            <p className={styles.subtitle}>Loading setup status...</p>
          </div>
        </div>
      </main>
    );
  }

  if (isError) {
    const details = error instanceof Error ? error.message : 'Failed to reach server';
    return (
      <ServerDown
        title="Server is offline"
        message="Could not load setup status. The server may be down or restarting."
        details={details}
        onRetry={() => { void refetch(); }}
      />
    );
  }

  if (data && !data.setupRequired) {
    // Already set up -> go to dashboard (will fall back to /login if not authed).
    return <Navigate to="/" replace />;
  }

  if (mutation.isPending) return <FullPageLoading />;

  if (!setupId) {
    return (
      <main>
        <div className={styles.wrap}>
          <div className={styles.card}>
            <div className={styles.brand}>
              <img src="/favicon.svg" alt="" className={styles.brandIcon} />
              <h1 className={styles.title}>HarborFM</h1>
            </div>

            <div className={styles.setupNotice} role="alert" aria-live="polite">
              <p className={styles.setupNoticeTitle}>Setup link required</p>
              <p className={styles.setupNoticeBody}>
                Missing setup id in the URL. Check the server logs for a link like{' '}
                <code className={styles.setupNoticeCode}>/setup?id=.....</code>
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (validateLoading) {
    return (
      <main>
        <div className={styles.wrap}>
          <div className={styles.card}>
            <div className={styles.brand}>
              <img src="/favicon.svg" alt="" className={styles.brandIcon} />
              <h1 className={styles.title}>HarborFM</h1>
            </div>
            <p className={styles.subtitle}>Validating setup link...</p>
          </div>
        </div>
      </main>
    );
  }

  if (validateError || !validateOk) {
    const msg = validateErr instanceof Error ? validateErr.message : 'Invalid setup link';
    return (
      <main>
        <div className={styles.wrap}>
          <div className={styles.card}>
            <div className={styles.brand}>
              <img src="/favicon.svg" alt="" className={styles.brandIcon} />
              <h1 className={styles.title}>HarborFM</h1>
            </div>

            <div className={styles.setupNotice} role="alert" aria-live="polite">
              <p className={styles.setupNoticeTitle}>Setup link invalid</p>
              <p className={styles.setupNoticeBody}>
                {msg}
              </p>
            </div>

            <button
              type="button"
              className={styles.submit}
              onClick={() => { void refetchValidate(); }}
              aria-label="Retry validating setup link"
              style={{ marginTop: '1rem', width: '100%' }}
            >
              Retry
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className={styles.wrap}>
        <div className={styles.card}>
        <div className={styles.brand}>
          <img src="/favicon.svg" alt="" className={styles.brandIcon} />
          <h1 className={styles.title}>HarborFM</h1>
        </div>
        <div className={styles.setupHeader}>
          <h2 className={styles.setupHeaderTitle}>Initial setup</h2>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Admin email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              required
            />
          </label>

          <label className={styles.label}>
            Admin password
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              minLength={8}
              required
            />
          </label>

          <label className={styles.label}>
            Hostname (public base URL, optional)
            <input
              type="text"
              placeholder="https://podcasts.example.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              className={styles.input}
            />
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={registrationEnabled}
              onChange={(e) => setRegistrationEnabled(e.target.checked)}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Enable Account Registration</span>
          </label>
          <p className={styles.toggleHelp}>
            When enabled, new users can create accounts. When disabled, only existing users can log in.
          </p>

          <label className="toggle">
            <input
              type="checkbox"
              checked={publicFeedsEnabled}
              onChange={(e) => setPublicFeedsEnabled(e.target.checked)}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Enable Public Feeds</span>
          </label>
          <p className={styles.toggleHelp}>
            When enabled, anyone can view your podcast feed pages and RSS. When disabled, feed pages are hidden.
          </p>

          <label className="toggle">
            <input
              type="checkbox"
              checked={importPixabayAssets}
              onChange={(e) => setImportPixabayAssets(e.target.checked)}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Import Pixabay Assets</span>
          </label>
          <p className={styles.toggleHelp}>
            Imports a list of curated Pixabay assets into your global library.
          </p>

          {mutation.isError && <p className={styles.error}>{mutation.error?.message}</p>}

          <button
            type="submit"
            className={styles.submit}
            disabled={mutation.isPending || !setupId}
            aria-label="Complete setup"
          >
            {mutation.isPending ? 'Setting up...' : 'Complete setup'}
          </button>
        </form>
        </div>
      </div>
    </main>
  );
}


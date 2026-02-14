import { useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { login } from '../api/auth';
import { setupStatus } from '../api/setup';
import { getPublicConfig } from '../api/public';
import { JoinCallDialog } from '../components/JoinCallDialog/JoinCallDialog';
import { Captcha, type CaptchaHandle } from '../components/Captcha';
import styles from './Auth.module.css';

export function Login() {
  const [searchParams] = useSearchParams();
  const verified = searchParams.get('verified') === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const setUser = useAuthStore((s) => s.setUser);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const captchaRef = useRef<CaptchaHandle>(null);
  const { data: setup } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    retry: false,
    staleTime: 10_000,
  });
  const { data: publicConfig } = useQuery({
    queryKey: ['publicConfig', typeof window !== 'undefined' ? window.location.host : ''],
    queryFn: getPublicConfig,
    staleTime: 60_000,
  });
  const webrtcEnabled = publicConfig?.webrtc_enabled === true;
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      let captchaToken: string | undefined;
      if (setup?.captchaProvider && setup.captchaProvider !== 'none' && setup.captchaSiteKey) {
        captchaToken = await captchaRef.current?.getToken();
        if (!captchaToken?.trim()) {
          console.error('[Login] CAPTCHA enabled but no token from widget', {
            captchaProvider: setup.captchaProvider,
            hasRef: !!captchaRef.current,
          });
        }
      }
      return login(email, password, captchaToken);
    },
    onSuccess: (data) => {
      setUser(data.user);
      // Invalidate the 'me' query so RequireAuth refetches with the new cookie
      queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    },
    onError: (err: Error) => {
      console.error('[Login] submit failed', { message: err.message, name: err.name });
    },
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (verified) {
      navigate('/login', { replace: true });
    }
    mutation.mutate();
  }

  return (
    <main>
      <div className={styles.wrap}>
        <div className={styles.card}>
        <div className={styles.brand}>
          <img src="/favicon.svg" alt="" className={styles.brandIcon} />
          <h1 className={styles.title}>HarborFM</h1>
        </div>
        <div className={styles.loginHeader}>
          <h2 className={styles.setupHeaderTitle}>Sign in to your account</h2>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Email
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
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              required
            />
          </label>
          {setup?.captchaProvider && setup.captchaProvider !== 'none' && setup.captchaSiteKey && (
            <Captcha ref={captchaRef} provider={setup.captchaProvider} siteKey={setup.captchaSiteKey} />
          )}
          {verified && (
            <div className={styles.verificationCardSuccess}>
              <p className={styles.verificationCardSuccessText}>Your email is verified. You can sign in now.</p>
            </div>
          )}
          {mutation.isError && (
            <div className={styles.verificationCardError}>
              <p className={styles.verificationCardErrorText}>{mutation.error?.message}</p>
            </div>
          )}
          <button
            type="submit"
            className={styles.submit}
            disabled={mutation.isPending || !email.trim() || password.length < 4}
            aria-label="Sign in"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            {mutation.isPending ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div className={styles.footerActions}>
          <div className={styles.footerAction}>
            <span className={styles.footerActionIcon} aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 7a2 2 0 0 1 2 2m-4 2a6 6 0 0 1-3-5 6 6 0 0 1 6 0 6 6 0 0 1-3 5" />
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              </svg>
            </span>
            <span className={styles.footerActionLabel}>Forgot your password?</span>
            <Link to="/reset-password" className={styles.footerActionLink}>Reset password</Link>
          </div>
          {setup?.registrationEnabled !== false && (
            <div className={styles.footerAction}>
              <span className={styles.footerActionIcon} aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                  <line x1="22" y1="11" x2="16" y2="11" />
                </svg>
              </span>
              <span className={styles.footerActionLabel}>No account?</span>
              <Link to="/register" className={styles.footerActionLink}>Create account</Link>
            </div>
          )}
        </div>
        </div>
        {setup?.welcomeBanner?.trim() && (
          <div className={styles.welcomeBanner} role="status">
            {setup.welcomeBanner}
          </div>
        )}
        <p className={styles.footerBelowCard}>
          <Link to="/privacy">Privacy Policy</Link>
          <span className={styles.footerBelowCardSep} aria-hidden />
          <Link to="/terms">Terms of Service</Link>
          <span className={styles.footerBelowCardSep} aria-hidden />
          <Link to="/contact">Contact</Link>
        </p>
        {webrtcEnabled && (
          <>
            <button
              type="button"
              className={styles.joinCallFab}
              onClick={() => setJoinDialogOpen(true)}
              aria-label="Join call"
            >
              <Phone size={16} strokeWidth={2} aria-hidden />
              Join Call
            </button>
            <JoinCallDialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen} />
          </>
        )}
      </div>
    </main>
  );
}

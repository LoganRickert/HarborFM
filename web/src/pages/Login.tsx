import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { OtpInput } from '../components/OtpInput/OtpInput';
import { useAuthStore } from '../store/auth';
import { login, verify2FA, send2FAEmailCode, getSsoProviders } from '../api/auth';
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
  const [pending2FA, setPending2FA] = useState<{
    method: 'totp' | 'email';
  } | null>(() => {
    const method = searchParams.get('method')?.trim();
    if (method === 'totp' || method === 'email') {
      return { method: method as 'totp' | 'email' };
    }
    return null;
  });
  const [code, setCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
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
  const { data: ssoData } = useQuery({
    queryKey: ['ssoProviders'],
    queryFn: getSsoProviders,
    staleTime: 60_000,
  });
  const ssoProviders = ssoData?.providers ?? [];
  const webrtcEnabled = publicConfig?.webrtcEnabled === true;
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);

  const loginMutation = useMutation({
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
      if ('user' in data) {
        setUser(data.user);
        queryClient.invalidateQueries({ queryKey: ['me'] });
        navigate('/');
      } else if ('requires2FA' in data) {
        setPending2FA({ method: data.method });
        setCode('');
      } else if ('requires2FASetup' in data) {
        if (data.methods?.length) {
          try {
            sessionStorage.setItem('harborfm-2fa-methods', JSON.stringify(data.methods));
          } catch {
            /* ignore */
          }
        }
        navigate('/login/2fa-setup', { replace: true });
      }
    },
    onError: (err: Error) => {
      console.error('[Login] submit failed', { message: err.message, name: err.name });
    },
  });

  const verify2FAMutation = useMutation({
    mutationFn: () => verify2FA(code),
    onSuccess: (data) => {
      setUser(data.user);
      queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    },
    onError: () => {
      setCode('');
    },
  });

  const lastAutoSentTokenRef = useRef<string | null>(null);
  const sendEmailCodeMutation = useMutation({
    mutationFn: () => send2FAEmailCode(),
    onSuccess: () => {
      setResendCooldown(30);
      const id = setInterval(() => {
        setResendCooldown((c) => (c <= 0 ? 0 : c - 1));
      }, 1000);
      setTimeout(() => clearInterval(id), 30_000);
    },
  });

  useEffect(() => {
    if (
      pending2FA?.method === 'email' &&
      lastAutoSentTokenRef.current !== pending2FA.method
    ) {
      lastAutoSentTokenRef.current = pending2FA.method;
      sendEmailCodeMutation.mutate();
    }
  }, [pending2FA?.method, sendEmailCodeMutation]);

  // Clear method from URL when we have it (e.g. from SSO redirect)
  useEffect(() => {
    if (pending2FA && searchParams.get('method')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('method');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [pending2FA, searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (verified) {
      navigate('/login', { replace: true });
    }
    if (pending2FA) {
      verify2FAMutation.mutate();
    } else {
      loginMutation.mutate();
    }
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
          {!pending2FA ? (
            <>
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
            </>
          ) : (
            <>
          <p className={styles.toggleHelp} style={{ marginBottom: 12 }}>
            Enter the 6-digit code from your {pending2FA.method === 'totp' ? 'authenticator app' : 'email'}.
          </p>
          <OtpInput
            value={code}
            onChange={(v) => setCode(v)}
            length={6}
            disabled={verify2FAMutation.isPending}
            error={!!(loginMutation.isError || verify2FAMutation.isError || sendEmailCodeMutation.isError)}
            label="Code"
            autoComplete="one-time-code"
            autoFocus
            ariaLabel="6-digit verification code"
            ariaDescribedBy={loginMutation.isError || verify2FAMutation.isError || sendEmailCodeMutation.isError ? 'login-2fa-error' : undefined}
          />
            </>
          )}
          {verified && (
            <div className={styles.verificationCardSuccess}>
              <p className={styles.verificationCardSuccessText}>Your email is verified. You can sign in now.</p>
            </div>
          )}
          {(loginMutation.isError || verify2FAMutation.isError || sendEmailCodeMutation.isError) && (
            <div id="login-2fa-error" className={styles.verificationCardError} role="alert">
              <p className={styles.verificationCardErrorText}>
                {(loginMutation.error || verify2FAMutation.error || sendEmailCodeMutation.error)?.message}
              </p>
            </div>
          )}
          <button
            type="submit"
            className={styles.submit}
            disabled={
              pending2FA
                ? verify2FAMutation.isPending || code.length < 6
                : loginMutation.isPending || !email.trim() || password.length < 4
            }
            aria-label="Sign in"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            {loginMutation.isPending || verify2FAMutation.isPending
              ? 'Verifying...'
              : pending2FA
                ? 'Verify'
                : 'Sign in'}
          </button>
          {pending2FA?.method === 'email' && (
            <button
              type="button"
              className={styles.sendCodeBtn}
              onClick={() => sendEmailCodeMutation.mutate()}
              disabled={resendCooldown > 0 || sendEmailCodeMutation.isPending}
            >
              {resendCooldown > 0 ? `Send code (${resendCooldown}s)` : 'Send code'}
            </button>
          )}
          {pending2FA && (
            <button
              type="button"
              className={styles.footerActionLink}
              onClick={() => {
                setPending2FA(null);
                setCode('');
                sendEmailCodeMutation.reset();
              }}
            >
              Back to sign in
            </button>
          )}
          {!pending2FA && ssoProviders.length > 0 && (
            <>
              <div className={styles.ssoDivider}>
                <span className={styles.ssoDividerLine} aria-hidden />
                <span className={styles.ssoDividerText}>Or sign in with</span>
                <span className={styles.ssoDividerLine} aria-hidden />
              </div>
              <div className={styles.ssoButtons}>
                {ssoProviders.map((p) => (
                  <a
                    key={`${p.type}-${p.id}`}
                    href={`/api/auth/sso/${p.type}/${p.id}`}
                    className={styles.ssoButton}
                  >
                    Sign in with {p.name}
                  </a>
                ))}
              </div>
            </>
          )}
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
        {webrtcEnabled && (
          <>
            <button
              type="button"
              className={styles.joinCallBtn}
              onClick={() => setJoinDialogOpen(true)}
              aria-label="Join call"
            >
              <Phone size={16} strokeWidth={2} aria-hidden />
              Join Call
            </button>
            <JoinCallDialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen} />
          </>
        )}
        <p className={styles.footerBelowCard}>
          <Link to="/privacy">Privacy Policy</Link>
          <span className={styles.footerBelowCardSep} aria-hidden />
          <Link to="/terms">Terms of Service</Link>
          <span className={styles.footerBelowCardSep} aria-hidden />
          <Link to="/contact">Contact</Link>
        </p>
      </div>
    </main>
  );
}

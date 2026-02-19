import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { TWO_FACTOR_METHODS, parseTwoFactorMethods, isMethodAllowed } from '@harborfm/shared';
import { OtpInput } from '../components/OtpInput/OtpInput';
import { setup2FA, confirm2FASetup, send2FAEmailCode } from '../api/auth';
import { setupStatus } from '../api/setup';
import { useAuthStore } from '../store/auth';
import styles from './Auth.module.css';

const METHODS_KEY = 'harborfm-2fa-methods';

function getInitialMethods(): string[] | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const methodsFromUrl = params.get('methods')?.trim();
    if (methodsFromUrl) {
      const methods = methodsFromUrl.split(',').map((m) => m.trim()).filter(Boolean);
      sessionStorage.setItem(METHODS_KEY, JSON.stringify(methods));
      const url = new URL(window.location.href);
      url.searchParams.delete('methods');
      window.history.replaceState({}, '', url.pathname + url.search);
      return methods;
    }
    const stored = sessionStorage.getItem(METHODS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed as string[];
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function Login2FASetup() {
  const navigate = useNavigate();
  const initialMethods = useState(getInitialMethods)[0];
  const setUser = useAuthStore((s) => s.setUser);

  const [step, setStep] = useState<'choose' | 'totp' | 'email'>('choose');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const { data: setup } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    staleTime: 60_000,
  });
  const allowedMethods = parseTwoFactorMethods(setup?.twoFactorMethods);
  const emailConfigured = Boolean(setup?.emailConfigured);

  const restrictedMethods = initialMethods;

  const availableMethods = TWO_FACTOR_METHODS.filter((m) => {
    if (restrictedMethods && !restrictedMethods.includes(m.id)) return false;
    if (!isMethodAllowed(allowedMethods, m.id)) return false;
    if (m.requiresProvider === 'email') return emailConfigured;
    return true;
  });

  useEffect(() => {
    if (!restrictedMethods?.length) {
      navigate('/login', { replace: true });
    }
  }, [restrictedMethods, navigate]);

  const clearMethods = () => {
    try {
      sessionStorage.removeItem(METHODS_KEY);
    } catch {
      /* ignore */
    }
  };

  const setupMutation = useMutation({
    mutationFn: (method: 'totp' | 'email') => setup2FA(method),
    onSuccess: (data, method) => {
      if (method === 'totp' && data.qrDataUrl && data.secret) {
        setQrDataUrl(data.qrDataUrl);
        setSecret(data.secret);
        setStep('totp');
      } else if (method === 'email') {
        setStep('email');
        setResendCooldown(60);
        const id = setInterval(() => {
          setResendCooldown((c) => (c <= 0 ? 0 : c - 1));
        }, 1000);
        setTimeout(() => clearInterval(id), 60_000);
      }
    },
    onError: () => {
      navigate('/login', { replace: true });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      confirm2FASetup(code, step === 'totp' ? secret ?? undefined : undefined),
    onSuccess: (data) => {
      clearMethods();
      setUser(data.user);
      navigate('/', { replace: true });
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => send2FAEmailCode(),
    onSuccess: () => {
      setResendCooldown(30);
      const id = setInterval(() => {
        setResendCooldown((c) => (c <= 0 ? 0 : c - 1));
      }, 1000);
      setTimeout(() => clearInterval(id), 30_000);
    },
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step === 'choose') return;
    confirmMutation.mutate();
  }

  if (!restrictedMethods?.length) {
    return null;
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
            <h2 className={styles.setupHeaderTitle}>Set up 2FA</h2>
            <p className={styles.setupHeaderSub} style={{ marginTop: "1rem", marginBottom: 0 }}>
              Two-factor authentication is required. Choose a method below.
            </p>
          </div>

          {step === 'choose' && (
            <div className={styles.form}>
              {availableMethods.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  className={styles.submit}
                  onClick={() => setupMutation.mutate(method.id as 'totp' | 'email')}
                  disabled={setupMutation.isPending}
                >
                  Use {method.shortLabel.toLowerCase()}
                </button>
              ))}
              {availableMethods.length === 0 && (
                <p className={styles.toggleHelp}>
                  No 2FA methods are available. Contact your administrator.
                </p>
              )}
            </div>
          )}

          {(step === 'totp' || step === 'email') && (
            <form onSubmit={handleSubmit} className={styles.form}>
              {step === 'totp' && qrDataUrl && secret && (
                <>
                  <p className={styles.toggleHelp} style={{ marginBottom: 12 }}>
                    Scan this QR code with Authy, Microsoft Authenticator, 1Password, or another TOTP app.
                  </p>
                  <div style={{ marginBottom: 16 }}>
                    <img src={qrDataUrl} alt="QR code for authenticator" width={192} height={192} />
                  </div>
                  <p className={styles.toggleHelp} style={{ marginBottom: 8, fontSize: 12 }}>
                    Or enter this secret manually: <code>{secret}</code>
                  </p>
                </>
              )}
              {step === 'email' && (
                <div className={styles.verificationCard}>
                  <p className={styles.verificationCardText}>
                    We sent a 6-digit code to your email. Enter it below.
                  </p>
                </div>
              )}
              <OtpInput
                value={code}
                onChange={setCode}
                length={6}
                disabled={confirmMutation.isPending}
                error={!!confirmMutation.isError}
                label="Code"
                autoComplete="one-time-code"
                ariaLabel="6-digit verification code"
                ariaDescribedBy={confirmMutation.isError ? 'login2fa-setup-error' : undefined}
              />
              {confirmMutation.isError && (
                <div id="login2fa-setup-error" className={styles.verificationCardError} role="alert">
                  <p className={styles.verificationCardErrorText}>
                    {confirmMutation.error?.message}
                  </p>
                </div>
              )}
              <button
                type="submit"
                className={styles.submit}
                disabled={confirmMutation.isPending || code.length < 6}
                aria-label="Verify"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                {confirmMutation.isPending ? 'Verifying...' : 'Verify'}
              </button>
              {step === 'email' && (
                <button
                  type="button"
                  className={styles.sendCodeBtn}
                  onClick={() => resendMutation.mutate()}
                  disabled={resendCooldown > 0 || resendMutation.isPending}
                >
                  {resendCooldown > 0 ? `Send code (${resendCooldown}s)` : 'Send code'}
                </button>
              )}
              <Link to="/login" className={styles.footerActionLink} style={{ display: 'block', marginTop: '0.5rem', textAlign: 'center' }}>
                Back to sign in
              </Link>
            </form>
          )}

          {step === 'choose' && (
            <p className={styles.footer} style={{ marginTop: '1.5rem' }}>
              <Link to="/login" className={styles.footerActionLink}>
                Back to sign in
              </Link>
            </p>
          )}
        </div>
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

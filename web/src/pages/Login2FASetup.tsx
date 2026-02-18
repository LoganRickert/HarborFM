import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { TWO_FACTOR_METHODS, parseTwoFactorMethods, isMethodAllowed } from '@harborfm/shared';
import { setup2FA, confirm2FASetup, send2FAEmailCode } from '../api/auth';
import { setupStatus } from '../api/setup';
import { useAuthStore } from '../store/auth';
import styles from './Auth.module.css';

const CHALLENGE_TOKEN_KEY = 'harborfm-2fa-challenge-token';

export function Login2FASetup() {
  const navigate = useNavigate();
  const token = useState(() => {
    try {
      return sessionStorage.getItem(CHALLENGE_TOKEN_KEY);
    } catch {
      return null;
    }
  })[0];
  const setUser = useAuthStore((s) => s.setUser);

  const [step, setStep] = useState<'choose' | 'totp' | 'email'>('choose');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const { data: setup } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    staleTime: 60_000,
  });
  const allowedMethods = parseTwoFactorMethods(setup?.twoFactorMethods);
  const emailConfigured = Boolean(setup?.emailConfigured);

  const availableMethods = TWO_FACTOR_METHODS.filter((m) => {
    if (!isMethodAllowed(allowedMethods, m.id)) return false;
    if (m.requiresProvider === 'email') return emailConfigured;
    return true;
  });

  useEffect(() => {
    if (!token?.trim()) {
      navigate('/login', { replace: true });
    }
  }, [token, navigate]);

  const clearChallengeToken = () => {
    try {
      sessionStorage.removeItem(CHALLENGE_TOKEN_KEY);
    } catch {
      // ignore
    }
  };

  const setupMutation = useMutation({
    mutationFn: (method: 'totp' | 'email') => setup2FA(token!, method),
    onSuccess: (data, method) => {
      if (method === 'totp' && data.qrDataUrl && data.secret && data.challengeToken) {
        setQrDataUrl(data.qrDataUrl);
        setSecret(data.secret);
        setChallengeToken(data.challengeToken);
        setStep('totp');
      } else if (method === 'email') {
        setChallengeToken(data.challengeToken ?? token);
        setStep('email');
        setResendCooldown(60);
        const id = setInterval(() => {
          setResendCooldown((c) => (c <= 0 ? 0 : c - 1));
        }, 1000);
        setTimeout(() => clearInterval(id), 60_000);
      }
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      confirm2FASetup(
        challengeToken ?? token!,
        code,
        step === 'totp' ? secret ?? undefined : undefined
      ),
    onSuccess: (data) => {
      clearChallengeToken();
      setUser(data.user);
      navigate('/', { replace: true });
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => send2FAEmailCode(challengeToken ?? token!),
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

  if (!token?.trim()) {
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
              <label className={styles.label}>
                Code
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className={styles.input}
                  placeholder="000000"
                  autoFocus
                />
              </label>
              {confirmMutation.isError && (
                <div className={styles.verificationCardError} role="alert">
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
              <Link to="/login" className={styles.footerActionLink} style={{ display: 'block', marginTop: '0.5rem' }}>
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

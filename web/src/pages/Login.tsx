import { useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { login } from '../api/auth';
import { setupStatus } from '../api/setup';
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
            disabled={mutation.isPending}
            aria-label="Sign in"
          >
            {mutation.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {setup?.registrationEnabled !== false && (
          <p className={styles.footer}>
            No account? <Link to="/register">Register</Link>
          </p>
        )}
        <p className={styles.footer} style={{ marginTop: setup?.registrationEnabled !== false ? '0.5rem' : '1.5rem' }}>
          Forgot your password? <Link to="/reset-password">Reset password</Link>
        </p>
        </div>
        <p className={styles.footerBelowCard}>
          <Link to="/privacy">Privacy Policy</Link>
          <span className={styles.footerBelowCardSep} aria-hidden />
          <Link to="/terms">Terms of Service</Link>
        </p>
      </div>
    </main>
  );
}

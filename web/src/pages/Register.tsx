import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { register } from '../api/auth';
import { setupStatus } from '../api/setup';
import { Captcha, type CaptchaHandle } from '../components/Captcha';
import styles from './Auth.module.css';

export function Register() {
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

  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      let captchaToken: string | undefined;
      if (setup?.captchaProvider && setup.captchaProvider !== 'none' && setup.captchaSiteKey) {
        captchaToken = await captchaRef.current?.getToken();
      }
      return register(email, password, captchaToken);
    },
    onSuccess: (data) => {
      if ('requiresVerification' in data && data.requiresVerification) {
        setVerificationMessage(data.message ?? 'Check your email to verify your account, then sign in.');
        return;
      }
      if ('user' in data) {
        setUser(data.user);
        queryClient.invalidateQueries({ queryKey: ['me'] });
        navigate('/');
      }
    },
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
          <h2 className={styles.setupHeaderTitle}>Register</h2>
        </div>
        {verificationMessage ? (
          <>
            <div className={styles.verificationCard}>
              <p className={styles.verificationCardText}>{verificationMessage}</p>
            </div>
            <p className={styles.verificationCardFooter}>
              <Link to="/login">Sign in</Link> once you’ve verified your email.
            </p>
          </>
        ) : (
          <>
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
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={styles.input}
                  minLength={8}
                  required
                />
              </label>
              {setup?.captchaProvider && setup.captchaProvider !== 'none' && setup.captchaSiteKey && (
                <Captcha ref={captchaRef} provider={setup.captchaProvider} siteKey={setup.captchaSiteKey} />
              )}
              {mutation.isError && (
                <p className={styles.error}>{mutation.error?.message}</p>
              )}
              <button
                type="submit"
                className={styles.submit}
                disabled={mutation.isPending || !email.trim() || password.length < 8}
                aria-label="Create account"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                  <line x1="22" y1="11" x2="16" y2="11" />
                </svg>
                {mutation.isPending ? 'Creating...' : 'Create account'}
              </button>
            </form>
            <p className={styles.footer}>
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
          </>
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

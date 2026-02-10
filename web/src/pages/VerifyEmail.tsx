import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { verifyEmail } from '../api/auth';
import styles from './Auth.module.css';

export function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token?.trim()) {
      setStatus('error');
      setErrorMessage('Missing verification link.');
      return;
    }
    verifyEmail(token)
      .then(() => {
        setStatus('ok');
        navigate('/login?verified=1', { replace: true });
      })
      .catch((err) => {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Verification failed.');
      });
  }, [token, navigate]);

  return (
    <main>
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <img src="/favicon.svg" alt="" className={styles.brandIcon} />
            <h1 className={styles.title}>HarborFM</h1>
          </div>
          <div className={styles.loginHeader}>
            <h2 className={styles.setupHeaderTitle}>Verify your email</h2>
          </div>
          {status === 'loading' && (
            <p className={styles.subtitle}>Verifying your account…</p>
          )}
          {status === 'ok' && (
            <p className={styles.subtitle}>Redirecting to sign in…</p>
          )}
          {status === 'error' && (
            <>
              <div className={styles.verificationCardError}>
                <p className={styles.verificationCardErrorText}>{errorMessage}</p>
              </div>
              <p className={styles.footerBelowCard} style={{ marginTop: '1rem' }}>
                <Link to="/login">Back to sign in</Link>
                <span className={styles.footerBelowCardSep} aria-hidden />
                <Link to="/register">Register again</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

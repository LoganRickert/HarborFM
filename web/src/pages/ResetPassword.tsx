import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { setupStatus } from '../api/setup';
import { forgotPassword, resetPassword, validateResetToken } from '../api/auth';
import styles from './Auth.module.css';

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const { data: setup } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    retry: false,
    staleTime: 10_000,
  });

  const rawToken = token?.trim() ?? '';
  const isResetMode = Boolean(rawToken);

  const tokenValidation = useQuery({
    queryKey: ['validateResetToken', rawToken],
    queryFn: () => validateResetToken(rawToken),
    enabled: isResetMode,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const tokenValid = tokenValidation.isSuccess && tokenValidation.data?.ok === true;
  const tokenInvalid = isResetMode && !tokenValidation.isLoading && (tokenValidation.isError || !tokenValid);

  const forgotMutation = useMutation({
    mutationFn: () => forgotPassword(email),
  });

  const resetMutation = useMutation({
    mutationFn: () => resetPassword(rawToken, password),
  });

  const emailConfigured = setup?.emailConfigured === true;

  function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    forgotMutation.mutate();
  }

  function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      return;
    }
    resetMutation.mutate();
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
            <h2 className={styles.setupHeaderTitle}>
              {isResetMode ? 'Set New Password' : 'Reset Password'}
            </h2>
          </div>

          {!emailConfigured && !isResetMode && (
            <div className={styles.verificationCardError}>
              <p className={styles.verificationCardErrorText}>
                Password reset is not available because no email service is configured. Ask an administrator to set up SMTP or SendGrid in Settings.
              </p>
            </div>
          )}

          {emailConfigured && !isResetMode && (
            <>
              {forgotMutation.isSuccess ? (
                <div className={styles.verificationCard}>
                  <p className={styles.verificationCardText}>
                    If an account exists for that email, we sent a reset link. Check your inbox and use the link within 1 hour.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className={styles.form}>
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
                  {forgotMutation.isError && (
                    <div className={styles.verificationCardError}>
                      <p className={styles.verificationCardErrorText}>
                        {forgotMutation.error?.message}
                      </p>
                    </div>
                  )}
                  <button
                    type="submit"
                    className={styles.submit}
                    disabled={forgotMutation.isPending}
                    aria-label="Send reset link"
                  >
                    {forgotMutation.isPending ? 'Sending...' : 'Send reset link'}
                  </button>
                </form>
              )}
            </>
          )}

          {isResetMode && (
            <>
              {tokenValidation.isLoading && (
                <p className={styles.verificationCardText}>Checking reset link...</p>
              )}
              {tokenInvalid && (
                <div className={styles.verificationCardError}>
                  <p className={styles.verificationCardErrorText}>
                    {tokenValidation.error?.message ?? 'Invalid or expired reset link. Request a new one from the reset password page.'}
                  </p>
                </div>
              )}
              {tokenValid && resetMutation.isSuccess ? (
                <div className={styles.verificationCardSuccess}>
                  <p className={styles.verificationCardSuccessText}>
                    Your password has been reset. You can sign in now.
                  </p>
                </div>
              ) : tokenValid ? (
                <form onSubmit={handleResetSubmit} className={styles.form}>
                  <label className={styles.label}>
                    New password
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
                    Confirm password
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={styles.input}
                      minLength={8}
                      required
                    />
                  </label>
                  {password !== confirmPassword && confirmPassword.length > 0 && (
                    <p className={styles.error}>Passwords do not match.</p>
                  )}
                  {resetMutation.isError && (
                    <div className={styles.verificationCardError}>
                      <p className={styles.verificationCardErrorText}>
                        {resetMutation.error?.message}
                      </p>
                    </div>
                  )}
                  <button
                    type="submit"
                    className={styles.submit}
                    disabled={resetMutation.isPending || password !== confirmPassword || password.length < 8}
                    aria-label="Set New Password"
                  >
                    {resetMutation.isPending ? 'Saving...' : 'Set New Password'}
                  </button>
                </form>
              ) : null}
            </>
          )}

          {(!isResetMode || tokenInvalid || resetMutation.isSuccess) && (
            <p className={styles.footer} style={{ marginTop: '1.5rem' }}>
              <Link to="/login">Back to sign in</Link>
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

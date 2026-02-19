import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { completeAccount } from '../api/auth';
import { USERNAME_REGEX } from '@harborfm/shared';
import styles from './Auth.module.css';

export function CompleteAccount() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const setUser = useAuthStore((s) => s.setUser);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      completeAccount({
        ...(email.trim() && { email: email.trim() }),
        ...(username.trim() && { username: username.trim() }),
      }),
    onSuccess: (data) => {
      if ('needsVerification' in data && data.needsVerification) {
        setVerificationMessage(data.message ?? 'Check your email to verify your address, then sign in again.');
        return;
      }
      if ('user' in data && data.user) {
        setUser(data.user);
        queryClient.invalidateQueries({ queryKey: ['me'] });
        navigate('/', { replace: true });
      }
    },
  });

  const usernameTrimmed = username.trim();
  const usernameTooShort = usernameTrimmed.length > 0 && usernameTrimmed.length < 6;
  const usernameInvalidChars = usernameTrimmed.length > 0 && !USERNAME_REGEX.test(usernameTrimmed);
  const canSubmit =
    (email.trim() || usernameTrimmed) &&
    !usernameTooShort &&
    !usernameInvalidChars;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (canSubmit) {
      mutation.mutate();
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
            <h2 className={styles.setupHeaderTitle}>Complete your account</h2>
            <p className={styles.subtitle}>
              Add an email or username to finish setting up your account.
            </p>
          </div>
          {verificationMessage ? (
            <div className={styles.verificationCard}>
              <p className={styles.verificationCardText}>{verificationMessage}</p>
              <p className={styles.verificationCardFooter}>
                <Link to="/login">Sign in</Link> once you&apos;ve verified your email.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.helperCard}>
                <p className={styles.helperCardText}>
                  Provide at least one. Username completes immediately. Email requires verification.
                </p>
              </div>
              <label className={styles.label}>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={styles.input}
                  placeholder="you@example.com"
                />
              </label>
              <label className={styles.label}>
                Username
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  className={styles.input}
                  placeholder="yourhandle"
                  minLength={6}
                  pattern="[a-zA-Z0-9_]+"
                  aria-invalid={usernameTooShort || usernameInvalidChars}
                  aria-describedby={(usernameTooShort || usernameInvalidChars) ? 'username-error' : undefined}
                />
                {(usernameTooShort || usernameInvalidChars) && (
                  <p id="username-error" className={styles.error} role="alert">
                    {usernameTooShort
                      ? 'Username must be at least 6 characters'
                      : 'Username can only contain letters, numbers, and underscores'}
                  </p>
                )}
              </label>
              {mutation.isError && (
                <div className={styles.verificationCardError} role="alert">
                  <p className={styles.verificationCardErrorText}>
                    {mutation.error?.message}
                  </p>
                </div>
              )}
              <button
                type="submit"
                className={styles.submit}
                disabled={mutation.isPending || !canSubmit}
              >
                {mutation.isPending ? 'Saving...' : 'Complete'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

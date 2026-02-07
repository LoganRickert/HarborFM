import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { login } from '../api/auth';
import { setupStatus } from '../api/setup';
import styles from './Auth.module.css';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const setUser = useAuthStore((s) => s.setUser);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: setup } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    retry: false,
    staleTime: 10_000,
  });

  const mutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: (data) => {
      setUser(data.user);
      // Invalidate the 'me' query so RequireAuth refetches with the new cookie
      queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    },
  });

  function handleSubmit(e: React.FormEvent) {
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
          {mutation.isError && (
            <p className={styles.error}>{mutation.error?.message}</p>
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
      </div>
    </main>
  );
}

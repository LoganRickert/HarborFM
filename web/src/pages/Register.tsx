import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { register } from '../api/auth';
import styles from './Auth.module.css';

export function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const setUser = useAuthStore((s) => s.setUser);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => register(email, password),
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
          <h2 className={styles.setupHeaderTitle}>Register</h2>
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              minLength={8}
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
            aria-label="Create account"
          >
            {mutation.isPending ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className={styles.footer}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
        </div>
      </div>
    </main>
  );
}

import { Link } from 'react-router-dom';
import styles from './Auth.module.css';

export function ResetPassword() {
  return (
    <main>
      <div className={styles.wrap}>
        <div className={styles.card}>
        <div className={styles.brand}>
          <img src="/favicon.svg" alt="" className={styles.brandIcon} />
          <h1 className={styles.title}>HarborFM</h1>
        </div>
        <div className={styles.loginHeader}>
          <h2 className={styles.setupHeaderTitle}>Reset password</h2>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9375rem', lineHeight: 1.5 }}>
          Password reset isn’t wired up yet. This page is a placeholder for now.
          </p>
        </div>

        <p className={styles.footer}>
          <Link to="/login">Back to sign in</Link>
        </p>
        </div>
      </div>
    </main>
  );
}


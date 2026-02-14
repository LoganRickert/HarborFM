import { Link } from 'react-router-dom';
import { useConsent } from '../../hooks/useConsent';
import styles from './ConsentBanner.module.css';

export function ConsentBanner() {
  const { showBanner, accept, reject } = useConsent();

  if (!showBanner) return null;

  return (
    <div
      className={styles.banner}
      role="dialog"
      aria-label="Cookie consent"
      aria-describedby="consent-description"
    >
      <div className={styles.inner}>
        <p id="consent-description" className={styles.text}>
          We use cookies and similar technologies for analytics and to improve the site.
          You can accept or reject non-essential cookies. See our{' '}
          <Link to="/privacy" className={styles.link}>
            Privacy Policy
          </Link>{' '}
          for details.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.reject}
            onClick={reject}
            aria-label="Reject non-essential cookies"
          >
            Reject
          </button>
          <button
            type="button"
            className={styles.accept}
            onClick={accept}
            aria-label="Accept cookies"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

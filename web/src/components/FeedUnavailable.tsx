import { RotateCcw } from 'lucide-react';
import styles from './FeedUnavailable.module.css';

export function FeedUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className={styles.wrap} role="alert">
      <p className={styles.title}>Feed temporarily unavailable</p>
      <p className={styles.message}>
        We couldn’t load this page. Check your connection and try again.
      </p>
      {onRetry && (
        <button
          type="button"
          className={styles.retryBtn}
          onClick={onRetry}
          aria-label="Try again"
        >
          <RotateCcw size={16} aria-hidden />
          Try again
        </button>
      )}
    </div>
  );
}

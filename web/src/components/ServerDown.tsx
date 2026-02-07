import styles from '../pages/Auth.module.css';
import ui from './ServerDown.module.css';
import { WifiOff, RotateCcw } from 'lucide-react';

export function ServerDown({
  title = 'Server is offline',
  message = 'Could not reach HarborFM server. Make sure the server is running, then try again.',
  details,
  onRetry,
}: {
  title?: string;
  message?: string;
  details?: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.wrap}>
      <div className={`${styles.card} ${ui.card}`}>
        <div className={styles.brand}>
          <img src="/favicon.svg" alt="" className={styles.brandIcon} />
          <h1 className={styles.title}>HarborFM</h1>
        </div>
        <div className={ui.content}>
          <div className={ui.header}>
            <div className={ui.status}>
              <div className={ui.iconWrap} aria-hidden="true">
                <WifiOff size={18} />
              </div>
              <div className={ui.statusText}>
                <h2 className={ui.title}>{title}</h2>
                <p className={ui.subtitle}>We couldn’t reach the API right now.</p>
              </div>
            </div>
          </div>

          <p className={ui.body}>{message}</p>

          {details && <div className={ui.details}>{details}</div>}

          {onRetry && (
            <div className={ui.actions}>
              <button
                type="button"
                className={`${styles.submit} ${ui.retry}`}
                onClick={onRetry}
                aria-label="Retry"
              >
                <RotateCcw size={16} aria-hidden="true" />
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


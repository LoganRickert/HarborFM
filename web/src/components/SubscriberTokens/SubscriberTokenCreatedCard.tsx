import { Check, Copy, X } from 'lucide-react';
import localStyles from './SubscriberTokens.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface SubscriberTokenCreatedCardProps {
  token: string;
  baseUrl: string;
  onDismiss: () => void;
  copied: boolean;
  onCopy: (token: string) => void;
}

export function SubscriberTokenCreatedCard({
  token,
  baseUrl,
  onDismiss,
  copied,
  onCopy,
}: SubscriberTokenCreatedCardProps) {
  return (
    <div className={styles.tokenCreatedCard} role="status">
      <div className={styles.tokenCreatedHeader}>
        <div className={styles.tokenCreatedContent}>
          <p className={styles.tokenCreatedTitle}>Token created. Copy the feed URL now - it won&apos;t be shown again.</p>
          <code className={styles.tokenUrl}>
            {baseUrl}/private/{token.slice(0, 12)}...
          </code>
        </div>
        <div className={styles.tokenCreatedActions}>
          <button
            type="button"
            className={styles.tokenCreatedCopyBtn}
            onClick={() => onCopy(token)}
            aria-label="Copy full feed URL"
          >
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? 'Copied' : 'Copy feed URL'}
          </button>
          <button type="button" className={styles.tokenCreatedDismissBtn} onClick={onDismiss}>
            <X size={16} aria-hidden />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

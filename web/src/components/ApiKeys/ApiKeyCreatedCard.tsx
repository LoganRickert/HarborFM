import { Check, Copy, X } from 'lucide-react';
import tokenStyles from '../SubscriberTokens/SubscriberTokens.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...tokenStyles };

interface ApiKeyCreatedCardProps {
  keyValue: string;
  onDismiss: () => void;
  copied: boolean;
  onCopy: () => void;
}

export function ApiKeyCreatedCard({
  keyValue,
  onDismiss,
  copied,
  onCopy,
}: ApiKeyCreatedCardProps) {
  return (
    <div className={styles.tokenCreatedCard} role="status">
      <div className={styles.tokenCreatedHeader}>
        <div className={styles.tokenCreatedContent}>
          <p className={styles.tokenCreatedTitle}>
            API key created. Copy the key now - it won&apos;t be shown again.
          </p>
          <code className={styles.tokenUrl} style={{ fontFamily: 'ui-monospace, monospace' }}>
            {keyValue}
          </code>
        </div>
        <div className={styles.tokenCreatedActions}>
          <button
            type="button"
            className={styles.tokenCreatedCopyBtn}
            onClick={onCopy}
            aria-label="Copy API key"
          >
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? 'Copied' : 'Copy key'}
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

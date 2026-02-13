import { Lock } from 'lucide-react';
import { FeedSubscriberOnlyMessageProps } from '../../../types/feed';
import styles from './FeedSubscriberOnlyMessage.module.css';

export function FeedSubscriberOnlyMessage({
  message = 'Subscriber Only - Subscribe to Listen',
}: FeedSubscriberOnlyMessageProps) {
  return (
    <div className={styles.locked} aria-label="Subscriber only">
      <Lock size={20} strokeWidth={2} className={styles.icon} aria-hidden />
      <p className={styles.label}>{message}</p>
    </div>
  );
}

import { Lock, Settings } from 'lucide-react';
import styles from '../EpisodeEditor.module.css';

export interface EpisodeDetailsSummaryCardProps {
  title: string;
  status: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  /** Resolved URL for episode cover image (optional). */
  artworkUrl?: string | null;
  /** When undefined, Edit button is hidden (e.g. read-only user). */
  onEditClick?: () => void;
  /** When 1, episode is subscriber-only. */
  subscriberOnly?: number;
}

export function EpisodeDetailsSummaryCard({
  title,
  status,
  seasonNumber,
  episodeNumber,
  artworkUrl,
  onEditClick,
  subscriberOnly,
}: EpisodeDetailsSummaryCardProps) {
  const metaParts: string[] = [status];
  if (seasonNumber != null || episodeNumber != null) {
    metaParts.push(`S${seasonNumber ?? '?'} E${episodeNumber ?? '?'}`);
  }
  const isSubscriberOnly = subscriberOnly === 1;
  
  return (
    <div className={isSubscriberOnly ? `${styles.detailsSummaryCard} ${styles.detailsSummaryCardSubscriberOnly}` : styles.detailsSummaryCard}>
      <div className={styles.detailsSummaryRow}>
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt=""
            className={styles.detailsSummaryArtwork}
          />
        ) : null}
        <div className={styles.detailsSummaryMain}>
          <div className={styles.detailsSummaryTitleRow}>
            {isSubscriberOnly && (
              <Lock size={16} strokeWidth={2.5} className={styles.detailsSummaryTitleLock} aria-label="Subscriber only" />
            )}
            <h2 className={styles.detailsSummaryTitle}>{title || 'Untitled episode'}</h2>
          </div>
          <p className={styles.detailsSummaryMeta}>{metaParts.join(' · ')}</p>
        </div>
      </div>
      {onEditClick != null && (
        <button type="button" className={styles.detailsSummaryEditBtn} onClick={onEditClick} aria-label="Edit episode details">
          <Settings size={18} strokeWidth={2} aria-hidden />
          Edit Details
        </button>
      )}
    </div>
  );
}

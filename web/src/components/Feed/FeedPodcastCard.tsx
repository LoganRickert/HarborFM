import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Lock, ArrowUpRight } from 'lucide-react';
import { FeedPodcastCardProps } from '../../types/feed';
import { SubscriptionInfoDialog } from './SubscriptionInfoDialog';
import styles from './FeedPodcastCard.module.css';

function podcastArtworkUrl(podcast: { artworkUrl?: string | null; artworkFilename?: string | null; id: string }): string | null {
  if (podcast.artworkUrl) return podcast.artworkUrl;
  if (podcast.artworkFilename) {
    return `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artworkFilename)}`;
  }
  return null;
}

export function FeedPodcastCard({ podcast, showLockIcon }: FeedPodcastCardProps) {
  const [showLockInfo, setShowLockInfo] = useState(false);
  
  const handleLockClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowLockInfo(true);
  };
  const artwork = podcastArtworkUrl(podcast);
  const isSubscriberOnly = Boolean(podcast.subscriberOnlyFeedEnabled && podcast.publicFeedDisabled);
  const hasSubscriberFeatures = Boolean(podcast.subscriberOnlyFeedEnabled);

  return (
    <>
    <article className={`${styles.card} ${isSubscriberOnly ? styles.cardSubscriberOnly : ''}`}>
      <Link to={`/feed/${podcast.slug}`} className={styles.cardLink}>
        <div className={styles.artworkWrapper}>
          {artwork ? (
            <img
              src={artwork}
              alt=""
              className={styles.artwork}
              loading="lazy"
            />
          ) : (
            <div className={styles.artworkPlaceholder}>
              <Radio size={32} strokeWidth={1.5} />
            </div>
          )}
        </div>
        <div className={styles.body}>
          <h2 className={styles.title}>{podcast.title}</h2>
          <p className={styles.slug}>{podcast.slug}</p>
          {podcast.description ? (
            <p className={styles.desc}>
              {podcast.description.slice(0, 120)}
              {podcast.description.length > 120 ? '...' : ''}
            </p>
          ) : null}
        </div>
        <div className={styles.actions}>
          {showLockIcon && hasSubscriberFeatures && (
            <button
              type="button"
              className={styles.lockButton}
              onClick={handleLockClick}
              aria-label="Subscription information"
            >
              <Lock
                size={18}
                strokeWidth={2}
                className={
                  isSubscriberOnly
                    ? `${styles.lockIcon} ${styles.lockIconGold}`
                    : styles.lockIcon
                }
              />
            </button>
          )}
          <span className={styles.arrow}>
            <ArrowUpRight size={18} strokeWidth={2} aria-hidden />
          </span>
        </div>
      </Link>
      {showLockInfo && (
        <SubscriptionInfoDialog
          open={showLockInfo}
          onClose={() => setShowLockInfo(false)}
          isSubscriberOnly={isSubscriberOnly}
          podcastSlug={podcast.slug}
        />
      )}
    </article>
    </>
  );
}

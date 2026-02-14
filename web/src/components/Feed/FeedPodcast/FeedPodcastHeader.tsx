import { useState } from 'react';
import { Rss, MessageCircle, Lock, Share2 } from 'lucide-react';
import { FeedPodcastHeaderProps } from '../../../types/feed';
import { SubscriptionInfoDialog } from '../SubscriptionInfoDialog';
import { ShareDialog } from '../../ShareDialog';
import { useSubscriberAuth } from '../../../hooks/useSubscriberAuth';
import styles from './FeedPodcastHeader.module.css';

export function FeedPodcastHeader({
  podcast,
  podcastSlug,
  onMessageClick,
  shareUrl,
  shareTitle,
}: FeedPodcastHeaderProps) {
  const [showLockInfo, setShowLockInfo] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { getTokenIdForPodcast } = useSubscriberAuth();
  const isSubscriberOnly = podcast.subscriber_only_feed_enabled === 1 && podcast.public_feed_disabled === 1;
  const hasSubscriberFeatures = podcast.subscriber_only_feed_enabled === 1;
  
  // Use private RSS URL if authenticated
  const tokenId = getTokenIdForPodcast(podcastSlug);
  const isAuthenticated = !!tokenId;
  const rssUrl = tokenId 
    ? `/api/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(tokenId)}/rss`
    : podcast.rss_url ?? `/api/public/podcasts/${podcastSlug}/rss`;
  
  // Disable RSS button if subscriber-only with no public feed and user is not authenticated
  const shouldDisableRss = isSubscriberOnly && !isAuthenticated;

  return (
    <>
      <div className={styles.header}>
        {(podcast.artwork_url || podcast.artwork_filename) && (
          <img
            src={podcast.artwork_url ?? (podcast.artwork_filename ? `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artwork_filename)}` : '')}
            alt={podcast.title}
            className={styles.artwork}
          />
        )}
        <div className={styles.content}>
          <div className={styles.top}>
            <div>
              <h1 className={styles.title}>{podcast.title}</h1>
              {podcast.author_name && (
                <p className={styles.author}>by {podcast.author_name}</p>
              )}
            </div>
            <div className={styles.actions}>
              {hasSubscriberFeatures && (
                <button
                  type="button"
                  className={styles.lockButton}
                  onClick={() => setShowLockInfo(true)}
                  aria-label="Subscription information"
                >
                  <Lock
                    size={18}
                    strokeWidth={2.5}
                    className={
                      isSubscriberOnly
                        ? `${styles.lockIcon} ${styles.lockIconGold}`
                        : styles.lockIcon
                    }
                  />
                </button>
              )}
              <button
                type="button"
                className={styles.messageBtn}
                onClick={onMessageClick}
                aria-label="Send message"
              >
                <MessageCircle size={18} strokeWidth={2.5} aria-hidden />
                Message
              </button>
              {shouldDisableRss ? (
                <button
                  type="button"
                  className={`${styles.rssButton} ${styles.disabled}`}
                  disabled
                  title="Subscriber-only feed. Authenticate to access."
                  aria-label="RSS Feed (Requires subscription)"
                >
                  <Rss size={18} strokeWidth={2.5} />
                </button>
              ) : (
                <a
                  href={rssUrl}
                  className={styles.rssButton}
                  title={tokenId ? 'Private RSS Feed (Subscriber)' : 'RSS Feed'}
                  aria-label={tokenId ? 'Private RSS Feed (Subscriber)' : 'RSS Feed'}
                >
                  <Rss size={18} strokeWidth={2.5} />
                </a>
              )}
              {shareUrl != null && (
                <button
                  type="button"
                  className={styles.shareBtn}
                  onClick={() => setShareOpen(true)}
                  aria-label="Share"
                  title="Share"
                >
                  <Share2 size={18} strokeWidth={2.5} aria-hidden />
                </button>
              )}
            </div>
          </div>
          {podcast.description && (
            <p className={styles.description}>{podcast.description}</p>
          )}
        </div>
      </div>
      {showLockInfo && (
        <SubscriptionInfoDialog
          open={showLockInfo}
          onClose={() => setShowLockInfo(false)}
          isSubscriberOnly={isSubscriberOnly}
          podcastSlug={podcastSlug}
        />
      )}
      {shareUrl != null && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          url={shareUrl}
          title={shareTitle}
        />
      )}
    </>
  );
}

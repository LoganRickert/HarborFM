import { useState } from 'react';
import { Rss, MessageCircle, Lock, Share2 } from 'lucide-react';
import { FeedPodcastHeaderProps } from '../../../types/feed';
import { SubscriptionInfoDialog } from '../SubscriptionInfoDialog';
import { ShareDialog } from '../../ShareDialog';
import { FeedFundingSupport } from '../FeedFundingSupport';
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
  const isSubscriberOnly = Boolean(podcast.subscriberOnlyFeedEnabled && podcast.publicFeedDisabled);
  const hasSubscriberFeatures = Boolean(podcast.subscriberOnlyFeedEnabled);
  
  // Use private RSS URL if authenticated
  const tokenId = getTokenIdForPodcast(podcastSlug);
  const isAuthenticated = !!tokenId;
  const rssUrl = tokenId 
    ? `/api/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(tokenId)}/rss`
    : podcast.rssUrl ?? `/api/public/podcasts/${podcastSlug}/rss`;
  
  // Hide RSS button if subscriber-only with no public feed and user is not authenticated
  const showRssButton = !(isSubscriberOnly && !isAuthenticated);

  return (
    <>
      <div className={styles.header}>
        {(podcast.artworkUrl || podcast.artworkFilename) && (
          <img
            src={podcast.artworkUrl ?? (podcast.artworkFilename ? `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artworkFilename)}` : '')}
            alt={podcast.title}
            className={styles.artwork}
          />
        )}
        <div className={styles.content}>
          <div className={styles.top}>
            <div>
              <h1 className={styles.title}>{podcast.title}</h1>
              {podcast.feedShowAuthor !== false && podcast.authorName && (
                <p className={styles.author}>by {podcast.authorName}</p>
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
                    aria-hidden
                  />
                </button>
              )}
              {onMessageClick && (
                <button
                  type="button"
                  className={styles.messageBtn}
                  onClick={onMessageClick}
                  aria-label="Send message"
                >
                  <MessageCircle size={18} strokeWidth={2.5} aria-hidden />
                  Message
                </button>
              )}
              {showRssButton && (
                <a
                  href={rssUrl}
                  className={styles.rssButton}
                  title={tokenId ? 'Private RSS Feed (Subscriber)' : 'RSS Feed'}
                  aria-label={tokenId ? 'Private RSS Feed (Subscriber)' : 'RSS Feed'}
                >
                  <Rss size={18} strokeWidth={2.5} aria-hidden />
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
          {podcast.feedShowPodcastDescription !== false && podcast.description && (
            <p className={styles.description}>{podcast.description}</p>
          )}
        </div>
      </div>
      {podcast.feedShowFunding !== false && (
        <FeedFundingSupport fundingLinks={podcast.fundingLinks} />
      )}
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

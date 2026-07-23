import { useState } from 'react';
import { Rss, MessageCircle, Lock, Share2, Bell } from 'lucide-react';
import { FeedPodcastHeaderProps } from '../../../types/feed';
import { SubscriptionInfoDialog } from '../SubscriptionInfoDialog';
import { ShareDialog } from '../../ShareDialog';
import { FeedFundingSupport } from '../FeedFundingSupport';
import { useSubscriberAuth } from '../../../hooks/useSubscriberAuth';
import { useManageSubscriptionDialog } from '../../../hooks/useManageSubscriptionDialog';
import styles from './FeedPodcastHeader.module.css';

export function FeedPodcastHeader({
  podcast,
  podcastSlug,
  onMessageClick,
  onAlertsClick,
  shareUrl,
  shareTitle,
  plain = false,
}: FeedPodcastHeaderProps) {
  const [showLockInfo, setShowLockInfo] = useManageSubscriptionDialog();
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

  const actionButtonsClass = plain
    ? `${styles.actionButtons} ${styles.actionButtonsFluid}`
    : styles.actionButtons;
  const textBtnClass = plain
    ? `${styles.messageBtn} ${styles.fluidTextBtn}`
    : styles.messageBtn;
  const iconBtnClass = plain
    ? `${styles.rssButton} ${styles.fluidIconBtn}`
    : styles.rssButton;
  const shareBtnClass = plain
    ? `${styles.shareBtn} ${styles.fluidIconBtn}`
    : styles.shareBtn;
  const lockBtnClass = plain
    ? `${styles.lockButton} ${styles.fluidLockBtn}`
    : styles.lockButton;

  return (
    <>
      <div className={plain ? `${styles.header} ${styles.headerFluid}` : styles.header}>
        {(podcast.artworkUrl || podcast.artworkFilename) && (
          <img
            src={podcast.artworkUrl ?? (podcast.artworkFilename ? `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artworkFilename)}` : '')}
            alt={podcast.title}
            className={plain ? `${styles.artwork} ${styles.artworkFluid}` : styles.artwork}
          />
        )}
        <div className={plain ? `${styles.content} ${styles.contentFluid}` : styles.content}>
          <div className={plain ? `${styles.top} ${styles.topFluid}` : styles.top}>
            <div>
              <h1 className={plain ? `${styles.title} ${styles.titleFluid}` : styles.title}>
                {podcast.title}
              </h1>
              {podcast.feedShowAuthor !== false && podcast.authorName && (
                <p className={plain ? `${styles.author} ${styles.authorFluid}` : styles.author}>
                  by {podcast.authorName}
                </p>
              )}
            </div>
            <div className={plain ? `${styles.actions} ${styles.actionsFluid}` : styles.actions}>
              <div className={actionButtonsClass}>
                {onMessageClick && (
                  <button
                    type="button"
                    className={textBtnClass}
                    onClick={onMessageClick}
                    aria-label="Send message"
                  >
                    <MessageCircle size={plain ? 16 : 18} strokeWidth={2.25} aria-hidden />
                    Message
                  </button>
                )}
                {onAlertsClick && (
                  <button
                    type="button"
                    className={textBtnClass}
                    onClick={onAlertsClick}
                    aria-label="Get episode alerts"
                  >
                    <Bell size={plain ? 16 : 18} strokeWidth={2.25} aria-hidden />
                    Alerts
                  </button>
                )}
                {showRssButton && (
                  <a
                    href={rssUrl}
                    className={iconBtnClass}
                    title={tokenId ? 'Private RSS Feed (Subscriber)' : 'RSS Feed'}
                    aria-label={tokenId ? 'Private RSS Feed (Subscriber)' : 'RSS Feed'}
                  >
                    <Rss size={plain ? 16 : 18} strokeWidth={2.25} aria-hidden />
                    {plain ? 'Feed' : null}
                  </a>
                )}
                {shareUrl != null && (
                  <button
                    type="button"
                    className={shareBtnClass}
                    onClick={() => setShareOpen(true)}
                    aria-label="Share"
                    title="Share"
                  >
                    <Share2 size={plain ? 16 : 18} strokeWidth={2.25} aria-hidden />
                    {plain ? 'Share' : null}
                  </button>
                )}
              </div>
              {hasSubscriberFeatures && (
                <button
                  type="button"
                  className={lockBtnClass}
                  onClick={() => setShowLockInfo(true)}
                  aria-label={isAuthenticated ? 'Manage Subscription' : 'Subscribe'}
                >
                  <Lock
                    size={plain ? 16 : 18}
                    strokeWidth={2.25}
                    className={
                      isSubscriberOnly
                        ? `${styles.lockIcon} ${styles.lockIconGold}`
                        : styles.lockIcon
                    }
                    aria-hidden
                  />
                  {isAuthenticated ? 'Manage Subscription' : 'Subscribe'}
                </button>
              )}
            </div>
          </div>
          {podcast.feedShowPodcastDescription !== false && podcast.description && (
            <p
              className={
                plain ? `${styles.description} ${styles.descriptionFluid}` : styles.description
              }
            >
              {podcast.description}
            </p>
          )}
        </div>
      </div>
      {podcast.feedShowFunding !== false && (
        <FeedFundingSupport fundingLinks={podcast.fundingLinks} plain={plain} />
      )}
      {showLockInfo && (
        <SubscriptionInfoDialog
          open={showLockInfo}
          onClose={() => setShowLockInfo(false)}
          isSubscriberOnly={isSubscriberOnly}
          podcastSlug={podcastSlug}
          canonicalFeedUrl={podcast.canonicalFeedUrl}
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

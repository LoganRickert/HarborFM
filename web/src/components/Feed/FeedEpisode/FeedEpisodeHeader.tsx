import { useState } from 'react';
import { MessageCircle, Lock, Share2 } from 'lucide-react';
import { FeedEpisodeHeaderProps } from '../../../types/feed';
import { formatDate, formatDuration, formatSeasonEpisode } from '../../../utils/format';
import { ShareDialog } from '../../ShareDialog';
import styles from './FeedEpisodeHeader.module.css';

export function FeedEpisodeHeader({
  episode,
  podcast,
  onMessageClick,
  onLockClick,
  shareUrl,
  shareTitle,
  embedCode,
}: FeedEpisodeHeaderProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const hasSubscriberFeatures = Boolean(podcast.subscriberOnlyFeedEnabled);
  const isPodcastSubscriberOnly = Boolean(podcast.publicFeedDisabled);
  const isEpisodeSubscriberOnly = Boolean(episode.subscriberOnly);
  const shouldShowGoldLock = isPodcastSubscriberOnly || isEpisodeSubscriberOnly;

  return (
    <div className={styles.header}>
      {episode.artworkUrl ? (
        <img src={episode.artworkUrl} alt={episode.title} className={styles.artwork} />
      ) : episode.artworkFilename ? (
        <img
          src={`/api/public/artwork/${episode.podcastId}/episodes/${episode.id}/${encodeURIComponent(episode.artworkFilename)}`}
          alt={episode.title}
          className={styles.artwork}
        />
      ) : podcast.artworkUrl || podcast.artworkFilename ? (
        <img
          src={podcast.artworkUrl ?? (podcast.artworkFilename ? `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artworkFilename)}` : '')}
          alt={podcast.title}
          className={styles.artwork}
        />
      ) : null}
      <div className={styles.content}>
        {(episode.seasonNumber != null || episode.episodeNumber != null || episode.audioDurationSec) ? (
          <div className={styles.badgeWrap}>
            {(episode.seasonNumber != null || episode.episodeNumber != null) && (
              <span className={styles.seasonEpisode}>
                {formatSeasonEpisode(episode.seasonNumber, episode.episodeNumber)}
              </span>
            )}
            {episode.audioDurationSec && (
              <>
                {(episode.seasonNumber != null || episode.episodeNumber != null) && (
                  <span className={styles.badgeSep} aria-hidden />
                )}
                <span className={styles.duration}>
                  {formatDuration(episode.audioDurationSec)}
                </span>
              </>
            )}
          </div>
        ) : null}
        <h1 className={styles.title}>{episode.title}</h1>
        <div className={styles.subRow}>
          {hasSubscriberFeatures && onLockClick && (
            <button
              type="button"
              className={styles.lockButton}
              onClick={onLockClick}
              aria-label="Subscription information"
            >
              <Lock
                size={18}
                strokeWidth={2.5}
                className={
                  shouldShowGoldLock
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
          {shareUrl != null && (
            <button
              type="button"
              className={styles.shareBtn}
              onClick={() => setShareOpen(true)}
              aria-label="Share"
              title="Share"
            >
              <Share2 size={18} strokeWidth={2.5} aria-hidden />
              Share
            </button>
          )}
        </div>
        {shareUrl != null && (
          <ShareDialog
            open={shareOpen}
            onOpenChange={setShareOpen}
            url={shareUrl}
            title={shareTitle}
            embedCode={embedCode}
          />
        )}
        <div className={styles.metaRow}>
          {episode.publishAt && (
            <span className={styles.date}>{formatDate(episode.publishAt)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

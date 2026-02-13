import { MessageCircle, Lock } from 'lucide-react';
import { FeedEpisodeHeaderProps } from '../../../types/feed';
import { formatDate, formatDuration, formatSeasonEpisode } from '../../../utils/format';
import styles from './FeedEpisodeHeader.module.css';

export function FeedEpisodeHeader({
  episode,
  podcast,
  onMessageClick,
  onLockClick,
}: FeedEpisodeHeaderProps) {
  const hasSubscriberFeatures = podcast.subscriber_only_feed_enabled === 1;
  const isPodcastSubscriberOnly = podcast.public_feed_disabled === 1;
  const isEpisodeSubscriberOnly = episode.subscriber_only === 1;
  const shouldShowGoldLock = isPodcastSubscriberOnly || isEpisodeSubscriberOnly;

  return (
    <div className={styles.header}>
      {episode.artwork_url ? (
        <img src={episode.artwork_url} alt={episode.title} className={styles.artwork} />
      ) : episode.artwork_filename ? (
        <img
          src={`/api/public/artwork/${episode.podcast_id}/episodes/${episode.id}/${encodeURIComponent(episode.artwork_filename)}`}
          alt={episode.title}
          className={styles.artwork}
        />
      ) : podcast.artwork_url || podcast.artwork_filename ? (
        <img
          src={podcast.artwork_url ?? (podcast.artwork_filename ? `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artwork_filename)}` : '')}
          alt={podcast.title}
          className={styles.artwork}
        />
      ) : null}
      <div className={styles.content}>
        {(episode.season_number != null || episode.episode_number != null || episode.audio_duration_sec) ? (
          <div className={styles.badgeWrap}>
            {(episode.season_number != null || episode.episode_number != null) && (
              <span className={styles.seasonEpisode}>
                {formatSeasonEpisode(episode.season_number, episode.episode_number)}
              </span>
            )}
            {episode.audio_duration_sec && (
              <>
                {(episode.season_number != null || episode.episode_number != null) && (
                  <span className={styles.badgeSep} aria-hidden />
                )}
                <span className={styles.duration}>
                  {formatDuration(episode.audio_duration_sec)}
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
          <button
            type="button"
            className={styles.messageBtn}
            onClick={onMessageClick}
            aria-label="Send message"
          >
            <MessageCircle size={18} strokeWidth={2.5} aria-hidden />
            Message
          </button>
        </div>
        <div className={styles.metaRow}>
          {episode.publish_at && (
            <span className={styles.date}>{formatDate(episode.publish_at)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

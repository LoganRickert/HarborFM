import { useState, type ReactNode } from 'react';
import { MessageCircle, Lock, Share2, FileText, Bell } from 'lucide-react';
import { FeedEpisodeHeaderProps } from '../../../types/feed';
import {
  formatDate,
  formatDateTimeWithZone,
  formatDuration,
  formatSeasonEpisode,
  parseUtc,
} from '../../../utils/format';
import { ShareDialog } from '../../ShareDialog';
import { FeedEpisodeTranscriptDialog } from './FeedEpisodeTranscriptDialog';
import { useSubscriberAuth } from '../../../hooks/useSubscriberAuth';
import styles from './FeedEpisodeHeader.module.css';

export function FeedEpisodeHeader({
  episode,
  podcast,
  podcastSlug,
  onMessageClick,
  onAlertsClick,
  onLockClick,
  shareUrl,
  shareTitle,
  embedCode,
  transcriptUrl,
  onTranscriptSeek,
  currentTime,
  children,
}: FeedEpisodeHeaderProps & { children?: ReactNode }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const { getTokenIdForPodcast } = useSubscriberAuth();
  const hasSubscriberFeatures = Boolean(podcast.subscriberOnlyFeedEnabled);
  const isPodcastSubscriberOnly = Boolean(
    podcast.subscriberOnlyFeedEnabled && podcast.publicFeedDisabled,
  );
  const isEpisodeSubscriberOnly = Boolean(episode.subscriberOnly);
  const shouldShowGoldLock = isPodcastSubscriberOnly || isEpisodeSubscriberOnly;
  const subscriberOnlyWindowLabel = (() => {
    const now = Date.now();
    const startsRaw = episode.subscriberOnlyStartsAt?.trim() || '';
    const endsRaw = episode.subscriberOnlyEndsAt?.trim() || '';
    const startsMs = startsRaw ? parseUtc(startsRaw)?.getTime() : null;
    const endsMs = endsRaw ? parseUtc(endsRaw)?.getTime() : null;

    // Before the window opens: announce the future start.
    if (startsMs != null && Number.isFinite(startsMs) && startsMs > now) {
      const formatted = formatDateTimeWithZone(startsRaw);
      return formatted
        ? { prefix: 'Subscriber Only Starting', date: formatted }
        : null;
    }
    // Inside the window (or end-only): announce the future end. Never after it passes.
    if (endsMs != null && Number.isFinite(endsMs) && endsMs > now) {
      const formatted = formatDateTimeWithZone(endsRaw);
      return formatted
        ? { prefix: 'Subscriber Only until', date: formatted }
        : null;
    }
    return null;
  })();
  const isAuthenticated = Boolean(
    podcastSlug && getTokenIdForPodcast(podcastSlug),
  );
  const hasTranscript = Boolean(transcriptUrl?.trim());
  const episodeType = String(episode.episodeType ?? '').toLowerCase();

  return (
    <div className={styles.header}>
      <div className={styles.headerTop}>
        {(episodeType === 'trailer' || episodeType === 'bonus') && (
          <span
            className={`${styles.typePill} ${
              episodeType === 'trailer' ? styles.typePillTrailer : styles.typePillBonus
            }`}
          >
            {episodeType === 'trailer' ? 'Trailer' : 'Bonus'}
          </span>
        )}
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
          <div className={styles.actions}>
            <div className={styles.subRow}>
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
              {onAlertsClick && (
                <button
                  type="button"
                  className={styles.messageBtn}
                  onClick={onAlertsClick}
                  aria-label="Get episode alerts"
                >
                  <Bell size={18} strokeWidth={2.5} aria-hidden />
                  Get Alerts
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
              {hasTranscript && (
                <button
                  type="button"
                  className={styles.transcriptBtn}
                  onClick={() => setTranscriptOpen(true)}
                  aria-label="Transcript"
                  title="Transcript"
                >
                  <FileText size={18} strokeWidth={2.5} aria-hidden />
                  Transcript
                </button>
              )}
            </div>
            {hasSubscriberFeatures && onLockClick && (
              <button
                type="button"
                className={styles.lockButton}
                onClick={onLockClick}
                aria-label={isAuthenticated ? 'Manage Subscription' : 'Subscribe'}
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
                {isAuthenticated ? 'Manage Subscription' : 'Subscribe'}
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
          {hasTranscript && transcriptUrl && (
            <FeedEpisodeTranscriptDialog
              open={transcriptOpen}
              onOpenChange={setTranscriptOpen}
              transcriptUrl={transcriptUrl}
              episodeTitle={episode.title}
              onSeekTo={onTranscriptSeek}
              currentTime={currentTime}
            />
          )}
          <div className={styles.metaRow}>
            {episode.publishAt && (
              <span className={styles.date}>{formatDate(episode.publishAt)}</span>
            )}
          </div>
        </div>
      </div>
      {subscriberOnlyWindowLabel && (
        <div className={styles.subscriberOnlyWindowCard} role="status">
          <Lock size={18} strokeWidth={2.5} className={styles.subscriberOnlyWindowIcon} aria-hidden />
          <span className={styles.subscriberOnlyWindowText}>
            {subscriberOnlyWindowLabel.prefix}{' '}
            <span className={styles.subscriberOnlyWindowDate}>
              {subscriberOnlyWindowLabel.date}
            </span>
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

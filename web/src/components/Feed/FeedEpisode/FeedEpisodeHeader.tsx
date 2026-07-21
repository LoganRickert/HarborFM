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
  plain = false,
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

  const artworkSrc = episode.artworkUrl
    ? episode.artworkUrl
    : episode.artworkFilename
      ? `/api/public/artwork/${episode.podcastId}/episodes/${episode.id}/${encodeURIComponent(episode.artworkFilename)}`
      : podcast.artworkUrl
        ? podcast.artworkUrl
        : podcast.artworkFilename
          ? `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artworkFilename)}`
          : '';
  const artworkAlt = episode.artworkUrl || episode.artworkFilename ? episode.title : podcast.title;

  return (
    <div className={styles.header} data-harborfm-episode-header>
      <div className={styles.headerTop} data-harborfm-episode-row>
        {(episodeType === 'trailer' || episodeType === 'bonus') && (
          <span
            className={`${styles.typePill} ${
              episodeType === 'trailer' ? styles.typePillTrailer : styles.typePillBonus
            }`}
          >
            {episodeType === 'trailer' ? 'Trailer' : 'Bonus'}
          </span>
        )}
        {artworkSrc ? (
          <img
            src={artworkSrc}
            alt={artworkAlt}
            className={styles.artwork}
            data-harborfm-episode-artwork
          />
        ) : null}
        <div className={styles.content} data-harborfm-episode-body>
          {(episode.seasonNumber != null || episode.episodeNumber != null || episode.audioDurationSec) ? (
            <div className={styles.badgeWrap} data-harborfm-episode-meta>
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
          <h1 className={styles.title} data-harborfm-episode-title>
            {episode.title}
          </h1>
          <div
            className={plain ? `${styles.actions} ${styles.actionsFluid}` : styles.actions}
            data-harborfm-episode-actions
          >
            <div className={plain ? `${styles.subRow} ${styles.subRowFluid}` : styles.subRow}>
              {onMessageClick && (
                <button
                  type="button"
                  className={plain ? `${styles.messageBtn} ${styles.fluidTextBtn}` : styles.messageBtn}
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
                  className={plain ? `${styles.messageBtn} ${styles.fluidTextBtn}` : styles.messageBtn}
                  onClick={onAlertsClick}
                  aria-label="Get episode alerts"
                >
                  <Bell size={plain ? 16 : 18} strokeWidth={2.25} aria-hidden />
                  {plain ? 'Alerts' : 'Get Alerts'}
                </button>
              )}
              {shareUrl != null && (
                <button
                  type="button"
                  className={plain ? `${styles.shareBtn} ${styles.fluidTextBtn}` : styles.shareBtn}
                  onClick={() => setShareOpen(true)}
                  aria-label="Share"
                  title="Share"
                >
                  <Share2 size={plain ? 16 : 18} strokeWidth={2.25} aria-hidden />
                  Share
                </button>
              )}
              {hasTranscript && (
                <button
                  type="button"
                  className={
                    plain ? `${styles.transcriptBtn} ${styles.fluidTextBtn}` : styles.transcriptBtn
                  }
                  onClick={() => setTranscriptOpen(true)}
                  aria-label="Transcript"
                  title="Transcript"
                >
                  <FileText size={plain ? 16 : 18} strokeWidth={2.25} aria-hidden />
                  Transcript
                </button>
              )}
            </div>
            {hasSubscriberFeatures && onLockClick && (
              <button
                type="button"
                className={plain ? `${styles.lockButton} ${styles.fluidLockBtn}` : styles.lockButton}
                onClick={onLockClick}
                aria-label={isAuthenticated ? 'Manage Subscription' : 'Subscribe'}
              >
                <Lock
                  size={plain ? 16 : 18}
                  strokeWidth={2.25}
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
          <div className={styles.metaRow} data-harborfm-episode-meta>
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

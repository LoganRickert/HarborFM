import { Link } from 'react-router-dom';
import { ArrowRight, Lock } from 'lucide-react';
import { FeedEpisodeCardProps } from '../../types/feed';
import { FeedEpisodePlayer } from './FeedEpisodePlayer';
import { formatDate, formatDuration, formatSeasonEpisode } from '../../utils/format';
import { PublicEpisodeWithAuth } from '../../api/public';
import styles from './FeedEpisodeCard.module.css';

export function FeedEpisodeCard({
  episode,
  podcastSlug,
  isSubscriberOnly,
  showPlayer = true,
  playingEpisodeId,
  onPlay,
  onPause,
  useShortEpisodeUrls = false,
}: FeedEpisodeCardProps) {
  const isPlaying = playingEpisodeId === episode.id;
  const episodeLinkTo = useShortEpisodeUrls ? `/${episode.slug}` : `/feed/${podcastSlug}/${episode.slug}`;

  // Check for both private and public audio URLs
  const episodeWithAuth = episode as PublicEpisodeWithAuth;
  const hasAudio = !!(episodeWithAuth.privateAudioUrl || episode.audioUrl);
  const scheduledNotReleased = Boolean(episode.scheduledNotReleased);

  return (
    <li
      className={
        isSubscriberOnly
          ? `${styles.episode} ${styles.episodeSubscriberOnly}`
          : styles.episode
      }
    >
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h3 className={styles.title}>{episode.title}</h3>
          <div className={styles.meta}>
            {(episode.seasonNumber != null || episode.episodeNumber != null) && (
              <span className={styles.seasonEpisode}>
                {formatSeasonEpisode(episode.seasonNumber, episode.episodeNumber)}
              </span>
            )}
            {episode.publishAt && (
              <span className={styles.date}>{formatDate(episode.publishAt)}</span>
            )}
            {episode.audioDurationSec && (
              <span className={styles.duration}>
                {formatDuration(episode.audioDurationSec)}
              </span>
            )}
          </div>
        </div>
        <Link to={episodeLinkTo} className={styles.viewBtn}>
          View Episode
          <ArrowRight size={14} strokeWidth={2.5} />
        </Link>
      </div>
      {episode.description && (
        <p className={styles.description}>{episode.description}</p>
      )}
      {showPlayer && hasAudio ? (
        <FeedEpisodePlayer
          episode={episode}
          podcastSlug={podcastSlug}
          isPlaying={isPlaying}
          onPlay={() => onPlay(episode.id)}
          onPause={onPause}
        />
      ) : scheduledNotReleased && !hasAudio ? (
        <div className={styles.lockedCard} aria-label="Scheduled for future release">
          <Lock size={20} strokeWidth={2} className={styles.lockedIcon} aria-hidden />
          <span className={styles.lockedLabel}>
            {episode.publishAt ? `Premiering ${formatDate(episode.publishAt)}` : 'Premiering soon'}
          </span>
        </div>
      ) : isSubscriberOnly && !hasAudio ? (
        <div className={styles.lockedCard} aria-label="Subscriber only">
          <Lock size={20} strokeWidth={2} className={styles.lockedIcon} aria-hidden />
          <span className={styles.lockedLabel}>Subscriber Only - Subscribe to Listen</span>
        </div>
      ) : showPlayer && !hasAudio ? (
        <div className={styles.noAudioCard} aria-label="No audio">
          <p className={styles.noAudioText}>Audio not available.</p>
        </div>
      ) : null}
    </li>
  );
}

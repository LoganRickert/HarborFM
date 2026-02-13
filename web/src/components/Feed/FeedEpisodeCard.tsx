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
  const hasAudio = !!(episodeWithAuth.private_audio_url || episode.audio_url);

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
            {(episode.season_number != null || episode.episode_number != null) && (
              <span className={styles.seasonEpisode}>
                {formatSeasonEpisode(episode.season_number, episode.episode_number)}
              </span>
            )}
            {episode.publish_at && (
              <span className={styles.date}>{formatDate(episode.publish_at)}</span>
            )}
            {episode.audio_duration_sec && (
              <span className={styles.duration}>
                {formatDuration(episode.audio_duration_sec)}
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
      ) : isSubscriberOnly && !hasAudio ? (
        <div className={styles.lockedCard} aria-label="Subscriber only">
          <Lock size={20} strokeWidth={2} className={styles.lockedIcon} aria-hidden />
          <span className={styles.lockedLabel}>Subscriber Only - Subscribe to Listen</span>
        </div>
      ) : null}
    </li>
  );
}

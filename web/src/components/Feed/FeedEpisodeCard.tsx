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
  showDescription = true,
  plain = false,
}: FeedEpisodeCardProps) {
  const isPlaying = playingEpisodeId === episode.id;
  const episodeLinkTo = useShortEpisodeUrls ? `/${episode.slug}` : `/feed/${podcastSlug}/${episode.slug}`;

  // Check for both private and public audio URLs
  const episodeWithAuth = episode as PublicEpisodeWithAuth;
  const hasAudio = !!(episodeWithAuth.privateAudioUrl || episode.audioUrl);
  const scheduledNotReleased = Boolean(episode.scheduledNotReleased);
  const episodeType = String(episode.episodeType ?? '').toLowerCase();
  const typeAttr =
    episodeType === 'trailer' || episodeType === 'bonus' ? episodeType : undefined;

  const className = [
    styles.episode,
    plain ? styles.episodePlain : '',
    isSubscriberOnly ? styles.episodeSubscriberOnly : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      data-harborfm-episode-item
      data-type={typeAttr}
      data-subscriber-only={isSubscriberOnly ? 'true' : undefined}
      data-plain={plain ? 'true' : undefined}
    >
      {(episodeType === 'trailer' || episodeType === 'bonus') && (
        <span
          className={`${styles.typePill} ${
            episodeType === 'trailer' ? styles.typePillTrailer : styles.typePillBonus
          }`}
          data-harborfm-episode-item-type
        >
          {episodeType === 'trailer' ? 'Trailer' : 'Bonus'}
        </span>
      )}
      <div className={styles.header} data-harborfm-episode-item-header>
        <div className={styles.headerContent}>
          <h3 className={styles.title} data-harborfm-episode-item-title>
            {episode.title}
          </h3>
          <div className={styles.meta} data-harborfm-episode-item-meta>
            {(episode.seasonNumber != null || episode.episodeNumber != null) && (
              <span className={styles.seasonEpisode} data-harborfm-episode-item-season>
                {formatSeasonEpisode(episode.seasonNumber, episode.episodeNumber)}
              </span>
            )}
            {episode.publishAt && (
              <span className={styles.date} data-harborfm-episode-item-date>
                {formatDate(episode.publishAt)}
              </span>
            )}
            {episode.audioDurationSec && (
              <span className={styles.duration} data-harborfm-episode-item-duration>
                {formatDuration(episode.audioDurationSec)}
              </span>
            )}
          </div>
        </div>
        <Link
          to={episodeLinkTo}
          className={plain ? `${styles.viewBtn} ${styles.viewBtnFluid}` : styles.viewBtn}
          data-harborfm-episode-item-link
        >
          {plain ? 'Open' : 'View Episode'}
          <ArrowRight size={14} strokeWidth={2.5} />
        </Link>
      </div>
      {showDescription && episode.description && (
        <p className={styles.description} data-harborfm-episode-item-description>
          {episode.description}
        </p>
      )}
      {showPlayer && hasAudio ? (
        <div data-harborfm-episode-item-player>
          <FeedEpisodePlayer
            episode={episode}
            podcastSlug={podcastSlug}
            isPlaying={isPlaying}
            onPlay={() => onPlay(episode.id)}
            onPause={() => onPause(episode.id)}
          />
        </div>
      ) : scheduledNotReleased && !hasAudio ? (
        <div
          className={styles.lockedCard}
          aria-label="Scheduled for future release"
          data-harborfm-episode-item-locked
        >
          <Lock size={20} strokeWidth={2} className={styles.lockedIcon} aria-hidden />
          <span className={styles.lockedLabel}>
            {episode.publishAt ? `Premiering ${formatDate(episode.publishAt)}` : 'Premiering soon'}
          </span>
        </div>
      ) : isSubscriberOnly && !hasAudio ? (
        <div
          className={styles.lockedCard}
          aria-label="Subscriber only"
          data-harborfm-episode-item-locked
        >
          <Lock size={20} strokeWidth={2} className={styles.lockedIcon} aria-hidden />
          <span className={styles.lockedLabel}>Subscriber Only - Subscribe to Listen</span>
        </div>
      ) : showPlayer && !hasAudio ? (
        <div
          className={styles.noAudioCard}
          aria-label="No audio"
          data-harborfm-episode-item-no-audio
        >
          <p className={styles.noAudioText}>Audio not available.</p>
        </div>
      ) : null}
    </li>
  );
}

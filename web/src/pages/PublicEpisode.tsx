import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPublicPodcast, getPublicEpisode } from '../api/public';
import { FullPageLoading } from '../components/Loading';
import { useMeta } from '../hooks/useMeta';
import styles from './PublicEpisode.module.css';

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function formatSeasonEpisode(seasonNumber: number | null | undefined, episodeNumber: number | null | undefined): string {
  if (seasonNumber != null && episodeNumber != null) {
    return `S${seasonNumber} E${episodeNumber}`;
  }
  if (seasonNumber != null) {
    return `S${seasonNumber}`;
  }
  if (episodeNumber != null) {
    return `E${episodeNumber}`;
  }
  return '';
}

export function PublicEpisode() {
  const { podcastSlug, episodeSlug } = useParams<{ podcastSlug: string; episodeSlug: string }>();
  const { data: podcast, isLoading: podcastLoading } = useQuery({
    queryKey: ['public-podcast', podcastSlug],
    queryFn: () => getPublicPodcast(podcastSlug!),
    enabled: !!podcastSlug,
  });
  const { data: episode, isLoading: episodeLoading, isError: episodeError } = useQuery({
    queryKey: ['public-episode', podcastSlug, episodeSlug],
    queryFn: () => getPublicEpisode(podcastSlug!, episodeSlug!),
    enabled: !!podcastSlug && !!episodeSlug,
  });

  // Update meta tags
  useMeta({
    title: episode && podcast ? `${episode.title} - ${podcast.title} - HarborFM` : undefined,
    description: episode?.description || (episode && podcast ? `Listen to ${episode.title} from ${podcast.title}${podcast.author_name ? ` by ${podcast.author_name}` : ''} on HarborFM.` : undefined),
  });

  if (!podcastSlug || !episodeSlug) return null;

  if (podcastLoading || episodeLoading) {
    return <FullPageLoading />;
  }

  if (episodeError || !episode || !podcast) {
    return (
      <main>
        <div className={styles.wrapper}>
          <div className={styles.container}>
            <div className={styles.error}>Episode not found</div>
          </div>
        </div>
      </main>
    );
  }

  const audioUrl = episode.audio_url;

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        <header className={styles.siteHeader}>
        <div className={styles.siteHeaderContent}>
          <Link to="/" className={styles.logo}>
            <img src="/favicon.svg" alt="" className={styles.logoIcon} />
            HarborFM
          </Link>
        </div>
      </header>
      <main>
        <Link to={`/feed/${podcastSlug}`} className={styles.back}>
          ← Back to {podcast.title}
        </Link>

        <div className={styles.card}>
        <div className={styles.header}>
          {episode.artwork_url ? (
            <img src={episode.artwork_url} alt={episode.title} className={styles.artwork} />
          ) : podcast.artwork_url ? (
            <img src={podcast.artwork_url} alt={podcast.title} className={styles.artwork} />
          ) : null}
          <div className={styles.headerContent}>
            {(episode.season_number != null || episode.episode_number != null) && (
              <div className={styles.seasonEpisode}>
                {formatSeasonEpisode(episode.season_number, episode.episode_number)}
              </div>
            )}
            <h1 className={styles.title}>{episode.title}</h1>
            <div className={styles.meta}>
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
        </div>

        {audioUrl && (
          <div className={styles.player}>
            <audio controls className={styles.audio} preload="metadata">
              <source src={audioUrl} type={episode.audio_mime || 'audio/mpeg'} />
              Your browser does not support the audio element.
            </audio>
          </div>
        )}

        {!audioUrl && (
          <div className={styles.noAudio}>
            <p>Audio not available.</p>
          </div>
        )}

        {episode.description && (
          <div className={styles.description}>
            <p>{episode.description}</p>
          </div>
        )}
        </div>
      </main>
      </div>
    </div>
  );
}

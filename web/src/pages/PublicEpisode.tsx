import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Play, Pause, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getPublicPodcast, getPublicEpisode, publicEpisodeWaveformUrl } from '../api/public';
import { FullPageLoading } from '../components/Loading';
import { useMeta } from '../hooks/useMeta';
import { WaveformCanvas, type WaveformData } from './EpisodeEditor/WaveformCanvas';
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

  const audioRef = useRef<HTMLAudioElement>(null);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioUrl = episode?.audio_url ?? null;
  const durationSec = episode?.audio_duration_sec ?? 0;
  const hasWaveform = Boolean(waveformData && durationSec > 0);

  useEffect(() => {
    if (!podcastSlug || !episodeSlug || durationSec <= 0 || !audioUrl) {
      setWaveformData(null);
      return;
    }
    let cancelled = false;
    fetch(publicEpisodeWaveformUrl(podcastSlug, episodeSlug))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.data?.length) setWaveformData(data as WaveformData);
        else if (!cancelled) setWaveformData(null);
      })
      .catch(() => {
        if (!cancelled) setWaveformData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [podcastSlug, episodeSlug, durationSec, audioUrl]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onLoadedMetadata = () => setCurrentTime(el.currentTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [audioUrl]);

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

  function togglePlay() {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      if (!el.src || el.ended) {
        el.src = audioUrl;
      }
      el.currentTime = currentTime;
      el.play().catch(() => setIsPlaying(false));
    }
  }

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
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link to={`/feed/${podcastSlug}`} className={styles.breadcrumbLink}>{podcast.title}</Link>
          <ChevronRight size={16} className={styles.breadcrumbSep} aria-hidden />
          <span className={styles.breadcrumbCurrent} title={episode.title}>
            {episode.title}
          </span>
        </nav>

        <div className={styles.card}>
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
            {hasWaveform && (
              <div className={styles.playbackRow}>
                <button
                  type="button"
                  className={styles.playPauseBtn}
                  onClick={togglePlay}
                  title={isPlaying ? 'Pause' : 'Play'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={22} aria-hidden /> : <Play size={22} aria-hidden />}
                </button>
                <WaveformCanvas
                  data={waveformData!}
                  durationSec={durationSec}
                  currentTime={currentTime}
                  onSeek={(time) => {
                    const el = audioRef.current;
                    if (el) {
                      el.currentTime = time;
                      setCurrentTime(time);
                    }
                  }}
                  className={styles.waveform}
                />
              </div>
            )}
            {hasWaveform ? (
              <audio ref={audioRef} preload="metadata" style={{ display: 'none' }}>
                <source src={audioUrl} type={episode.audio_mime || 'audio/mpeg'} />
              </audio>
            ) : (
              <audio ref={audioRef} controls className={styles.audio} preload="metadata">
                <source src={audioUrl} type={episode.audio_mime || 'audio/mpeg'} />
                Your browser does not support the audio element.
              </audio>
            )}
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

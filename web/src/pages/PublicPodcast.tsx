import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowDown, ArrowUp, Rss, Play, Pause } from 'lucide-react';
import { getPublicPodcast, getPublicEpisodes, publicEpisodeWaveformUrl } from '../api/public';
import type { PublicEpisode } from '../api/public';
import { FullPageLoading } from '../components/Loading';
import { useMeta } from '../hooks/useMeta';
import { WaveformCanvas, type WaveformData } from './EpisodeEditor/WaveformCanvas';
import styles from './PublicPodcast.module.css';

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

function EpisodePlayer({
  episode,
  podcastSlug,
  isPlaying,
  onPlay,
  onPause,
}: {
  episode: PublicEpisode;
  podcastSlug: string;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const audioUrl = episode.audio_url ?? null;
  const durationSec = episode.audio_duration_sec ?? 0;
  const hasWaveform = Boolean(waveformData && durationSec > 0);

  useEffect(() => {
    if (!podcastSlug || !episode.slug || durationSec <= 0 || !audioUrl) {
      setWaveformData(null);
      return;
    }
    let cancelled = false;
    fetch(publicEpisodeWaveformUrl(podcastSlug, episode.slug))
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
  }, [podcastSlug, episode.slug, durationSec, audioUrl]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    const onPauseEvt = () => onPause();
    const onEnded = () => {
      setCurrentTime(0);
      onPause();
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onLoadedMetadata = () => setCurrentTime(el.currentTime);
    el.addEventListener('pause', onPauseEvt);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      el.removeEventListener('pause', onPauseEvt);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [audioUrl, onPause]);

  function togglePlay() {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    if (isPlaying) {
      el.pause();
      onPause();
    } else {
      onPlay();
      el.src = audioUrl;
      el.play().catch(() => onPause());
    }
  }

  if (!audioUrl) return null;

  return (
    <div className={styles.episodePlayer}>
      {hasWaveform ? (
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
      ) : null}
      {hasWaveform ? (
        <audio
          ref={audioRef}
          id={`audio-${episode.id}`}
          preload="metadata"
          style={{ display: 'none' }}
        >
          <source src={audioUrl} type={episode.audio_mime || 'audio/mpeg'} />
        </audio>
      ) : (
        <audio
          ref={audioRef}
          id={`audio-${episode.id}`}
          src={audioUrl}
          controls
          className={styles.audio}
          preload="metadata"
          onPlay={onPlay}
          onPause={onPause}
          onEnded={onPause}
        />
      )}
    </div>
  );
}

export function PublicPodcast() {
  const { podcastSlug } = useParams<{ podcastSlug: string }>();
  const [playingEpisodeId, setPlayingEpisodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const { data: podcast, isLoading: podcastLoading, isError: podcastError } = useQuery({
    queryKey: ['public-podcast', podcastSlug],
    queryFn: () => getPublicPodcast(podcastSlug!),
    enabled: !!podcastSlug,
    refetchOnMount: 'always',
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: episodesLoading,
  } = useInfiniteQuery({
    queryKey: ['public-episodes', podcastSlug],
    queryFn: ({ pageParam = 0 }) => getPublicEpisodes(podcastSlug!, 50, pageParam),
    enabled: !!podcastSlug,
    refetchOnMount: 'always',
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore) {
        return lastPage.offset + lastPage.episodes.length;
      }
      return undefined;
    },
    initialPageParam: 0,
  });

  // Flatten all loaded episodes
  const allEpisodes = useMemo(() => {
    return data?.pages.flatMap((page) => page.episodes) ?? [];
  }, [data]);

  const handlePlay = useCallback((episodeId: string) => {
    setPlayingEpisodeId((prev) => {
      if (prev && prev !== episodeId) {
        const audio = document.getElementById(`audio-${prev}`) as HTMLAudioElement;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
      }
      return episodeId;
    });
  }, []);

  const handlePause = useCallback(() => {
    setPlayingEpisodeId(null);
  }, []);

  // Filter and sort episodes (client-side filtering on loaded episodes)
  const filteredAndSortedEpisodes = useMemo(() => {
    return allEpisodes
      .filter((ep) => {
        if (!searchQuery.trim()) return true;
        const query = searchQuery.toLowerCase();
        return (
          ep.title.toLowerCase().includes(query) ||
          ep.description?.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        const dateA = a.publish_at ? new Date(a.publish_at).getTime() : new Date(a.created_at).getTime();
        const dateB = b.publish_at ? new Date(b.publish_at).getTime() : new Date(b.created_at).getTime();
        return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
      });
  }, [allEpisodes, searchQuery, sortOrder]);

  // Update meta tags
  useMeta({
    title: podcast ? `${podcast.title} - HarborFM` : undefined,
    description: podcast?.description || (podcast ? `Listen to ${podcast.title}${podcast.author_name ? ` by ${podcast.author_name}` : ''} on HarborFM.` : undefined),
  });

  if (!podcastSlug) return null;

  if (podcastLoading) {
    return <FullPageLoading />;
  }

  if (podcastError || !podcast) {
    return (
      <main>
        <div className={styles.container}>
          <div className={styles.error}>Podcast not found</div>
        </div>
      </main>
    );
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
        <div className={styles.card}>
        <div className={styles.header}>
          {(podcast.artwork_url || podcast.artwork_filename) && (
            <img
              src={podcast.artwork_url ?? (podcast.artwork_filename ? `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artwork_filename)}` : '')}
              alt={podcast.title}
              className={styles.artwork}
            />
          )}
          <div className={styles.headerContent}>
            <div className={styles.headerTop}>
              <div>
                <h1 className={styles.title}>{podcast.title}</h1>
                {podcast.author_name && (
                  <p className={styles.author}>by {podcast.author_name}</p>
                )}
              </div>
              <a
                href={podcast.rss_url ?? `/api/public/podcasts/${podcastSlug}/rss`}
                className={styles.rssButton}
                title="RSS Feed"
                aria-label="RSS Feed"
                {...(podcast.rss_url ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                <Rss size={18} strokeWidth={2.5} />
              </a>
            </div>
            {podcast.description && (
              <p className={styles.description}>{podcast.description}</p>
            )}
          </div>
        </div>
      </div>

      <div className={`${styles.card} ${styles.episodesCard}`}>
        <div className={styles.episodes}>
        <div className={styles.episodesHeader}>
          <h2 className={styles.episodesTitle}>Episodes</h2>
        </div>
        <div className={styles.episodesControls}>
          <input
            type="search"
            placeholder="Search episodes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />
          <div className={styles.sortToggle}>
            <button
              type="button"
              className={sortOrder === 'newest' ? styles.sortToggleActive : styles.sortToggleBtn}
              onClick={() => setSortOrder('newest')}
              aria-label="Sort by newest"
              aria-pressed={sortOrder === 'newest'}
            >
              <ArrowDown size={14} strokeWidth={2.5} />
              Newest
            </button>
            <button
              type="button"
              className={sortOrder === 'oldest' ? styles.sortToggleActive : styles.sortToggleBtn}
              onClick={() => setSortOrder('oldest')}
              aria-label="Sort by oldest"
              aria-pressed={sortOrder === 'oldest'}
            >
              <ArrowUp size={14} strokeWidth={2.5} />
              Oldest
            </button>
          </div>
        </div>
        {episodesLoading && <p className={styles.muted}>Loading episodes…</p>}
        {!episodesLoading && filteredAndSortedEpisodes.length === 0 && (
          <p className={styles.muted}>
            {searchQuery ? 'No episodes match your search.' : 'No episodes yet.'}
          </p>
        )}
        {!episodesLoading && filteredAndSortedEpisodes.length > 0 && (
          <>
            <ul className={styles.episodesList}>
              {filteredAndSortedEpisodes.map((ep) => (
                  <li key={ep.id} className={styles.episode}>
                    <div className={styles.episodeHeader}>
                      <div className={styles.episodeHeaderContent}>
                        <h3 className={styles.episodeTitle}>{ep.title}</h3>
                        <div className={styles.episodeMeta}>
                          {(ep.season_number != null || ep.episode_number != null) && (
                            <span className={styles.seasonEpisode}>
                              {formatSeasonEpisode(ep.season_number, ep.episode_number)}
                            </span>
                          )}
                          {ep.publish_at && (
                            <span className={styles.episodeDate}>{formatDate(ep.publish_at)}</span>
                          )}
                          {ep.audio_duration_sec && (
                            <span className={styles.episodeDuration}>
                              {formatDuration(ep.audio_duration_sec)}
                            </span>
                          )}
                        </div>
                      </div>
                      <Link to={`/feed/${podcastSlug}/${ep.slug}`} className={styles.viewMoreBtn}>
                        View episode
                        <ArrowRight size={14} strokeWidth={2.5} />
                      </Link>
                    </div>
                    {ep.description && (
                      <p className={styles.episodeDescription}>{ep.description}</p>
                    )}
                    {ep.audio_url && (
                      <EpisodePlayer
                        episode={ep}
                        podcastSlug={podcastSlug}
                        isPlaying={playingEpisodeId === ep.id}
                        onPlay={() => handlePlay(ep.id)}
                        onPause={handlePause}
                      />
                    )}
                  </li>
              ))}
            </ul>
            {hasNextPage && (
              <div className={styles.loadMoreContainer}>
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className={styles.loadMoreBtn}
                  aria-label="Load more episodes"
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load more episodes'}
                </button>
              </div>
            )}
          </>
        )}
        </div>
      </div>
      </main>
      </div>
    </div>
  );
}

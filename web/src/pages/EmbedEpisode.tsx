import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { Play, Pause, Share2, Download, Rss, FileText, Volume2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPublicConfig,
  getPublicPodcast,
  getPublicEpisode,
  publicEpisodeWaveformUrl,
  type PublicEpisodeWithAuth,
} from '../api/public';
import { getPublicRssUrl } from '../api/rss';
import { FullPageLoading } from '../components/Loading';
import { isFeedUnavailableError } from '../api/client';
import { FeedUnavailable } from '../components/FeedUnavailable';
import { FeedSubscriberOnlyMessage } from '../components/Feed';
import { useFeedAudioPlayer } from '../hooks/useFeedAudioPlayer';
import { WaveformCanvas } from './EpisodeEditor/WaveformCanvas';
import { formatDurationEmbed, formatSeasonEpisode, formatSeasonEpisodeLong } from '../utils/format';
import styles from './EmbedEpisode.module.css';

const EMBED_HEIGHT_MESSAGE_TYPE = 'harborfm-embed-height';

export function EmbedEpisode() {
  const queryClient = useQueryClient();
  const params = useParams<{ podcastSlug?: string; episodeSlug: string }>();
  const podcastSlugParam = params.podcastSlug;
  const episodeSlug = params.episodeSlug ?? '';

  const rootRef = useRef<HTMLDivElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [audioLoadFailed, setAudioLoadFailed] = useState(false);

  const host = typeof window !== 'undefined' ? window.location.host : '';
  const { data: config, isLoading: configLoading, isFetched: configFetched } = useQuery({
    queryKey: ['publicConfig', host],
    queryFn: getPublicConfig,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: !podcastSlugParam,
  });

  const effectivePodcastSlug = podcastSlugParam ?? config?.customFeedSlug ?? '';
  const isCustomDomain = !podcastSlugParam && !!config?.customFeedSlug;

  const { data: podcast, isLoading: podcastLoading, isError: podcastError, error: podcastQueryError, refetch: refetchPodcast } = useQuery({
    queryKey: ['public-podcast', effectivePodcastSlug],
    queryFn: () => getPublicPodcast(effectivePodcastSlug!),
    enabled: !!effectivePodcastSlug,
  });
  const { data: episode, isLoading: episodeLoading, isError: episodeError, error: episodeQueryError, refetch: refetchEpisode } = useQuery({
    queryKey: ['public-episode', effectivePodcastSlug, episodeSlug],
    queryFn: () => getPublicEpisode(effectivePodcastSlug!, episodeSlug!) as Promise<PublicEpisodeWithAuth>,
    enabled: !!effectivePodcastSlug && !!episodeSlug,
  });

  useEffect(() => {
    queryClient.cancelQueries({ queryKey: ['activeImport'] });
    queryClient.removeQueries({ queryKey: ['activeImport'] });
  }, [queryClient]);

  const audioUrl = episode?.privateAudioUrl || episode?.audioUrl || null;
  const durationSec = episode?.audioDurationSec ?? 0;

  useEffect(() => setAudioLoadFailed(false), [audioUrl]);

  const {
    audioRef,
    waveformData,
    currentTime,
    isPlaying,
    hasWaveform,
    togglePlay,
    seek,
  } = useFeedAudioPlayer({
    audioUrl,
    podcastSlug: effectivePodcastSlug,
    episodeSlug,
    durationSec,
    waveformUrlFn: publicEpisodeWaveformUrl,
    privateWaveformUrl: episode?.privateWaveformUrl,
  });

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
  }, [audioRef, playbackRate]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
  }, [audioRef, volume]);

  const cyclePlaybackRate = useCallback(() => {
    setPlaybackRate((r) => (r === 1 ? 1.5 : r === 1.5 ? 2 : r === 2 ? 2.5 : 1));
  }, []);

  const handleWrapperKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Space') return;
      const target = document.activeElement;
      const isInteractive =
        target &&
        (target.tagName === 'BUTTON' || target.tagName === 'A' || target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
      if (isInteractive) return;
      e.preventDefault();
      togglePlay();
    },
    [togglePlay]
  );

  const handleActionKeyDown = useCallback((e: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.click();
    }
  }, []);

  const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
  const hasResolvedSlugs = !!effectivePodcastSlug && !!episodeSlug;
  const configReadyForOneParam = podcastSlugParam !== undefined || configFetched;

  if (!episodeSlug) return null;

  if (!podcastSlugParam && configFetched && !config?.customFeedSlug) {
    return <Navigate to="/" replace />;
  }

  if (!isEmbedded && configReadyForOneParam && hasResolvedSlugs) {
    const to = isCustomDomain ? `/${episodeSlug}` : `/feed/${effectivePodcastSlug}/${episodeSlug}`;
    return <Navigate to={to} replace />;
  }

  if (!effectivePodcastSlug) {
    if (!podcastSlugParam && (configLoading || !configFetched)) return <FullPageLoading />;
    return <div className={styles.wrapper}><div className={styles.error}>Episode not found</div></div>;
  }

  if (podcastLoading || episodeLoading) {
    return <FullPageLoading />;
  }

  const podcastUnavailable = podcastError && isFeedUnavailableError(podcastQueryError);
  const episodeUnavailable = episodeError && isFeedUnavailableError(episodeQueryError);
  if (podcastUnavailable) {
    return (
      <div className={styles.wrapper}>
        <FeedUnavailable onRetry={() => void refetchPodcast()} />
      </div>
    );
  }
  if (episodeUnavailable) {
    return (
      <div className={styles.wrapper}>
        <FeedUnavailable onRetry={() => void refetchEpisode()} />
      </div>
    );
  }
  if (episodeError || !episode || !podcast) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.error}>Episode not found</div>
      </div>
    );
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const canonicalEpisodePath = isCustomDomain ? `/${episodeSlug}` : `/feed/${effectivePodcastSlug}/${episodeSlug}`;
  const shareUrl = `${origin}${canonicalEpisodePath}`;
  const rssPath = getPublicRssUrl(effectivePodcastSlug);
  const subscribeUrl = `${origin}${rssPath}`;
  const downloadUrl = audioUrl ? (audioUrl.startsWith('http') ? audioUrl : `${origin}${audioUrl}`) : null;
  const transcriptUrl = (episode.privateSrtUrl || episode.srtUrl)
    ? ((episode.privateSrtUrl || episode.srtUrl)!.startsWith('http')
      ? (episode.privateSrtUrl || episode.srtUrl)!
      : `${origin}${episode.privateSrtUrl || episode.srtUrl}`)
    : null;

  const seasonEpisodeLong = formatSeasonEpisodeLong(episode.seasonNumber, episode.episodeNumber);
  const seasonEpisodeShort = formatSeasonEpisode(episode.seasonNumber, episode.episodeNumber);

  const scheduledNotReleased = Boolean(episode.scheduledNotReleased);
  const isSubscriberOnly = !audioUrl && !audioLoadFailed && Boolean(episode.subscriberOnly) && !scheduledNotReleased;

  let artworkSrc: string | null = null;
  if (episode.artworkUrl) {
    artworkSrc = episode.artworkUrl;
  } else if (episode.artworkFilename) {
    artworkSrc = `/api/public/artwork/${episode.podcastId}/episodes/${episode.id}/${encodeURIComponent(episode.artworkFilename)}`;
  } else if (podcast.artworkUrl) {
    artworkSrc = podcast.artworkUrl;
  } else if (podcast.artworkFilename) {
    artworkSrc = `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artworkFilename)}`;
  }

  return (
    <div
      ref={rootRef}
      className={styles.wrapper}
      tabIndex={0}
      onKeyDown={handleWrapperKeyDown}
      role="region"
      aria-label="Episode player"
    >
      <div className={styles.layout}>
        <div className={styles.artworkWrap}>
          {artworkSrc ? (
            <img src={artworkSrc} alt={episode.title} className={styles.artwork} />
          ) : (
            <div className={styles.artworkPlaceholder} aria-hidden>
              No image
            </div>
          )}
        </div>
        <div className={styles.content}>
          <div className={styles.titleRowWrapper}>
            <div className={styles.topRow}>
              <span className={styles.podcastTitle}>{podcast.title}</span>
              <div className={styles.topRowRight}>
                {seasonEpisodeLong && <span className={styles.seasonEpisode}>{seasonEpisodeLong}</span>}
                <a href={origin + (isCustomDomain ? '/' : '/feed')} target="_blank" rel="noopener noreferrer" className={styles.brand}>
                  <img src="/favicon.png" alt="" className={styles.favicon} onError={(e) => { (e.target as HTMLImageElement).src = '/favicon.svg'; }} />
                  HarborFM
                </a>
              </div>
            </div>
            <h1 className={styles.episodeTitle} title={episode.title}>{episode.title}</h1>
          </div>
          <div className={styles.metaRowMobile}>
            {seasonEpisodeShort && <span className={styles.seasonEpisodeShort}>{seasonEpisodeShort}</span>}
            <a href={origin + (isCustomDomain ? '/' : '/feed')} target="_blank" rel="noopener noreferrer" className={styles.brandMobile}>
              <img src="/favicon.png" alt="" className={styles.favicon} onError={(e) => { (e.target as HTMLImageElement).src = '/favicon.svg'; }} />
              HarborFM
            </a>
          </div>

          {scheduledNotReleased ? (
            <div className={styles.scheduledPlaceholder} aria-label="Scheduled for future release">
              <p className={styles.noAudioText}>
                {episode.publishAt ? `Premiering ${new Date(episode.publishAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}` : 'Premiering soon'}
              </p>
            </div>
          ) : isSubscriberOnly ? (
            <>
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.subscriberOnlyCardLink}
              >
                <FeedSubscriberOnlyMessage />
              </a>
            </>
          ) : audioUrl && !audioLoadFailed ? (
            <>
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
                      markers={episode.markers ?? []}
                      onSeek={seek}
                      className={styles.waveform}
                    />
                  </div>
                )}
                {hasWaveform ? (
                  <audio ref={audioRef} preload="metadata" style={{ display: 'none' }} onError={() => setAudioLoadFailed(true)}>
                    <source src={audioUrl} type={episode.audioMime || 'audio/mpeg'} />
                  </audio>
                ) : (
                  <audio ref={audioRef} controls className={styles.audioNative} preload="metadata" onError={() => setAudioLoadFailed(true)}>
                    <source src={audioUrl} type={episode.audioMime || 'audio/mpeg'} />
                  </audio>
                )}
              </div>

              <div className={styles.actions}>
                <a href={shareUrl} target="_blank" rel="noopener noreferrer" className={styles.actionBtn} onKeyDown={handleActionKeyDown}>
                  <span className={styles.actionBtnIcon}><Share2 size={16} aria-hidden /></span>
                  <span className={styles.actionBtnLabel}>Share</span>
                </a>
                {downloadUrl && (
                  <a href={downloadUrl} download className={styles.actionBtn} onKeyDown={handleActionKeyDown}>
                    <span className={styles.actionBtnIcon}><Download size={16} aria-hidden /></span>
                    <span className={styles.actionBtnLabel}>Download</span>
                  </a>
                )}
                <a href={subscribeUrl} target="_blank" rel="noopener noreferrer" className={styles.actionBtn} onKeyDown={handleActionKeyDown}>
                  <span className={styles.actionBtnIcon}><Rss size={16} aria-hidden /></span>
                  <span className={styles.actionBtnLabel}>Subscribe</span>
                </a>
                {transcriptUrl && (
                  <a href={transcriptUrl} target="_blank" rel="noopener noreferrer" className={styles.actionBtn} onKeyDown={handleActionKeyDown}>
                    <span className={styles.actionBtnIcon}><FileText size={16} aria-hidden /></span>
                    <span className={styles.actionBtnLabel}>Transcript</span>
                  </a>
                )}
              </div>

              <div className={styles.controlsRow}>
                <span className={styles.time}>
                  {formatDurationEmbed(Math.ceil(currentTime))} / {formatDurationEmbed(Math.ceil(durationSec))}
                </span>
                <button type="button" className={styles.speedBtn} onClick={cyclePlaybackRate} aria-label="Playback speed">
                  {playbackRate}x
                </button>
                <div className={styles.volumeWrap}>
                  <Volume2 size={18} className={styles.volumeIcon} aria-hidden />
                  <input
                    id="embed-volume"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className={styles.volumeSlider}
                    aria-label="Volume"
                  />
                </div>
              </div>
            </>
          ) : (
            <p className={styles.noAudioText}>Audio not available.</p>
          )}
        </div>
      </div>
      <EmbedResizeObserver rootRef={rootRef} />
    </div>
  );
}

function EmbedResizeObserver({ rootRef }: { rootRef: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    let rafId: number;
    const sendHeight = () => {
      rafId = requestAnimationFrame(() => {
        const h = el.offsetHeight;
        window.parent.postMessage({ type: EMBED_HEIGHT_MESSAGE_TYPE, height: h }, '*');
      });
    };

    const ro = new ResizeObserver(() => {
      sendHeight();
    });
    ro.observe(el);
    sendHeight();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [rootRef]);
  return null;
}

import { useState, useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Play, Pause } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPublicPodcast, getPublicEpisode, publicEpisodeWaveformUrl, type PublicEpisodeWithAuth } from '../api/public';
import { FullPageLoading } from '../components/Loading';
import { isFeedUnavailableError } from '../api/client';
import { FeedUnavailable } from '../components/FeedUnavailable';
import { FeedbackModal } from '../components/FeedbackModal';
import { useMeta } from '../hooks/useMeta';
import { useFeedAudioPlayer } from '../hooks/useFeedAudioPlayer';
import { WaveformCanvas } from './EpisodeEditor/WaveformCanvas';
import {
  FeedSiteHeader,
  FeedBreadcrumbs,
  FeedEpisodeHeader,
  FeedSubscriberOnlyMessage,
  SubscriptionInfoDialog,
} from '../components/Feed';
import sharedStyles from '../styles/shared.module.css';
import styles from './FeedEpisode.module.css';

export function FeedEpisode({
  podcastSlugOverride,
  episodeSlugOverride,
}: {
  podcastSlugOverride?: string;
  episodeSlugOverride?: string;
} = {}) {
  const queryClient = useQueryClient();
  const params = useParams<{ podcastSlug: string; episodeSlug: string }>();
  const podcastSlug = podcastSlugOverride ?? params.podcastSlug ?? '';
  const episodeSlug = episodeSlugOverride ?? params.episodeSlug ?? '';
  const isCustomFeed = !!(podcastSlugOverride && episodeSlugOverride);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [showLockInfo, setShowLockInfo] = useState(false);

  // Cancel any active import polling when on feed pages
  useEffect(() => {
    queryClient.cancelQueries({ queryKey: ['activeImport'] });
    queryClient.removeQueries({ queryKey: ['activeImport'] });
  }, [queryClient]);
  const { data: podcast, isLoading: podcastLoading, isError: podcastError, error: podcastQueryError, refetch: refetchPodcast } = useQuery({
    queryKey: ['public-podcast', podcastSlug],
    queryFn: () => getPublicPodcast(podcastSlug!),
    enabled: !!podcastSlug,
  });
  const { data: episode, isLoading: episodeLoading, isError: episodeError, error: episodeQueryError, refetch: refetchEpisode } = useQuery({
    queryKey: ['public-episode', podcastSlug, episodeSlug],
    queryFn: () => getPublicEpisode(podcastSlug!, episodeSlug!) as Promise<PublicEpisodeWithAuth>,
    enabled: !!podcastSlug && !!episodeSlug,
  });

  // Use private URLs if available, otherwise fallback to public
  const audioUrl = episode?.private_audio_url || episode?.audio_url || null;
  const durationSec = episode?.audio_duration_sec ?? 0;

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
    podcastSlug,
    episodeSlug,
    durationSec,
    waveformUrlFn: publicEpisodeWaveformUrl,
    privateWaveformUrl: episode?.private_waveform_url,
  });

  useMeta({
    title: episode && podcast ? `${episode.title} - ${podcast.title} - HarborFM` : undefined,
    description: episode?.description || (episode && podcast ? `Listen to ${episode.title} from ${podcast.title}${podcast.author_name ? ` by ${podcast.author_name}` : ''} on HarborFM.` : undefined),
  });

  if (!podcastSlug || !episodeSlug) return null;

  if (podcastLoading || episodeLoading) {
    return <FullPageLoading />;
  }

  const podcastUnavailable = podcastError && isFeedUnavailableError(podcastQueryError);
  const episodeUnavailable = episodeError && isFeedUnavailableError(episodeQueryError);
  const feedErrorLayout = (content: ReactNode) => (
    <div className={sharedStyles.wrapper}>
      <div className={sharedStyles.container}>
        <FeedSiteHeader />
        <main>{content}</main>
      </div>
    </div>
  );
  if (podcastUnavailable) {
    return feedErrorLayout(<FeedUnavailable onRetry={() => void refetchPodcast()} />);
  }
  if (episodeUnavailable) {
    return feedErrorLayout(<FeedUnavailable onRetry={() => void refetchEpisode()} />);
  }
  if (episodeError || !episode || !podcast) {
    return feedErrorLayout(<div className={sharedStyles.error}>Episode not found</div>);
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const shareUrl = `${origin}${isCustomFeed ? `/${episodeSlug}` : `/feed/${podcastSlug}/${episodeSlug}`}`;
  const shareTitle = `${episode.title} - ${podcast.title}`;
  const embedUrl = `${origin}${isCustomFeed ? `/embed/${episodeSlug}` : `/embed/${podcastSlug}/${episodeSlug}`}`;
  const embedCode = `<iframe src="${embedUrl}" width="100%" height="200" frameborder="0" allowfullscreen></iframe>`;

  return (
    <div className={sharedStyles.wrapper}>
      <div className={sharedStyles.container}>
        <FeedSiteHeader />
        <main>
          <FeedBreadcrumbs podcast={podcast} episode={episode} podcastSlug={podcastSlug} feedRootTo={isCustomFeed ? '/' : undefined} />

          <div className={sharedStyles.card}>
            <FeedEpisodeHeader
              episode={episode}
              podcast={podcast}
              onMessageClick={() => setFeedbackOpen(true)}
              onLockClick={() => setShowLockInfo(true)}
              shareUrl={shareUrl}
              shareTitle={shareTitle}
              embedCode={embedCode}
            />

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
                      onSeek={seek}
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
              episode.subscriber_only === 1 || podcast.subscriber_only_feed_enabled === 1 ? (
                <FeedSubscriberOnlyMessage />
              ) : (
                <p className={styles.noAudioText}>Audio not available.</p>
              )
            )}

            {episode.description && (
              <div className={styles.description}>
                <p>{episode.description}</p>
              </div>
            )}
          </div>
        </main>
      </div>

      <FeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        context={{
          podcastSlug: podcastSlug ?? undefined,
          episodeSlug: episodeSlug ?? undefined,
          podcastTitle: podcast.title,
          episodeTitle: episode.title,
        }}
      />

      {showLockInfo && (
        <SubscriptionInfoDialog
          open={showLockInfo}
          onClose={() => setShowLockInfo(false)}
          isSubscriberOnly={podcast.subscriber_only_feed_enabled === 1 && podcast.public_feed_disabled === 1}
          podcastSlug={podcastSlug}
        />
      )}
    </div>
  );
}

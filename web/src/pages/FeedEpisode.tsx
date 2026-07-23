import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Play, Pause } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPublicPodcast,
  getPublicEpisode,
  getPublicEpisodeCast,
  getPublicConfig,
  getPublicPodcastArtworkUrl,
  getPublicEpisodeArtworkUrl,
  getEpisodeThemeRender,
  publicEpisodeWaveformUrl,
  type PublicEpisodeWithAuth,
} from '../api/public';
import { FullPageLoading } from '../components/Loading';
import { isFeedUnavailableError, type ApiError } from '../api/client';
import { FeedUnavailable } from '../components/FeedUnavailable';
import { FeedbackModal } from '../components/FeedbackModal';
import { GetAlertsModal } from '../components/GetAlertsModal';
import { getPublicEpisodeAlerts } from '../api/episodeAlerts';
import { useMeta } from '../hooks/useMeta';
import { getSiteDisplayName } from '../utils/siteBranding';
import { isLiquidFeedTheme } from '../utils/feedTheme';
import { useFeedAudioPlayer } from '../hooks/useFeedAudioPlayer';
import { WaveformCanvas } from './EpisodeEditor/WaveformCanvas';
import {
  FeedSiteHeader,
  FeedBreadcrumbs,
  FeedEpisodeHeader,
  FeedSubscriberOnlyMessage,
  FeedPlaybackControls,
  SubscriptionInfoDialog,
  PodcastLinksCard,
  hasPodcastLinks,
  FeedCastList,
  FeedVideoPlayer,
  ReviewsCard,
  FeedEpisodeChapters,
  FeedEpisodeSoundbites,
  FeedEpisodePoll,
  FeedEpisodeFiles,
  FeedFundingSupport,
} from '../components/Feed';
import { LiquidFeedPage, type LiquidFeedBlocks } from '../components/Feed/LiquidFeedPage';
import type { HarborfmActionHandlers } from '../components/Feed/harborfmActions';
import { ShareDialog } from '../components/ShareDialog';
import { ReviewSubmitModal } from '../components/Feed/ReviewSubmitModal';
import { useSubscriberAuth } from '../hooks/useSubscriberAuth';
import { useManageSubscriptionDialog } from '../hooks/useManageSubscriptionDialog';
import { feedAccentCssVars } from '../utils/feedAccent';
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
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [writeReviewOpen, setWriteReviewOpen] = useState(false);
  const [showLockInfo, setShowLockInfo] = useManageSubscriptionDialog();
  const [audioLoadFailed, setAudioLoadFailed] = useState(false);

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
  const { data: publicConfig } = useQuery({
    queryKey: ['publicConfig', typeof window !== 'undefined' ? window.location.host : ''],
    queryFn: getPublicConfig,
    staleTime: 5 * 60 * 1000,
  });

  const { data: alertsInfo } = useQuery({
    queryKey: ['public-episode-alerts', podcastSlug],
    queryFn: () => getPublicEpisodeAlerts(podcastSlug!),
    enabled: !!podcastSlug,
    staleTime: 60_000,
  });

  const { data: episodeCast } = useQuery({
    queryKey: ['public-episode-cast', podcastSlug, episodeSlug],
    queryFn: () => getPublicEpisodeCast(podcastSlug!, episodeSlug!),
    enabled: !!podcastSlug && !!episodeSlug,
  });

  const wantsLiquidTheme = Boolean(podcast && isLiquidFeedTheme(podcast.feedTheme));

  const {
    data: themeRender,
    isLoading: themeRenderLoading,
    isError: themeRenderError,
    error: themeRenderQueryError,
    refetch: refetchThemeRender,
  } = useQuery({
    queryKey: ['theme-render-episode', podcastSlug, episodeSlug],
    queryFn: () => getEpisodeThemeRender(podcastSlug!, episodeSlug!),
    enabled: !!podcastSlug && !!episodeSlug && wantsLiquidTheme,
    retry: false,
  });

  const themeRenderStatus = (themeRenderQueryError as ApiError | undefined)?.status;
  const themeRenderFallback =
    wantsLiquidTheme && themeRenderError && (themeRenderStatus === 400 || themeRenderStatus === 404);
  const themeRenderHardError = wantsLiquidTheme && themeRenderError && !themeRenderFallback;
  const useLiquidLayout = wantsLiquidTheme && !themeRenderFallback && !!themeRender;

  const { isAuthenticatedForPodcast } = useSubscriberAuth();
  const episodeHosts = useMemo(
    () => episodeCast?.cast?.filter((c) => c.role === 'host') ?? [],
    [episodeCast],
  );
  const episodeGuests = useMemo(
    () => episodeCast?.cast?.filter((c) => c.role === 'guest') ?? [],
    [episodeCast],
  );

  // Use private URLs if available, otherwise fallback to public
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
    seekAndPlay,
    volume,
    setVolume,
    playbackRate,
    cyclePlaybackRate,
  } = useFeedAudioPlayer({
    audioUrl,
    podcastSlug,
    episodeSlug,
    durationSec,
    waveformUrlFn: publicEpisodeWaveformUrl,
    privateWaveformUrl: episode?.privateWaveformUrl,
    persistPlaybackPosition: true,
  });

  const siteName = getSiteDisplayName(publicConfig?.whiteLabel);
  const episodeArtwork =
    episode && podcast ? getPublicEpisodeArtworkUrl(episode, podcast) : null;
  const podcastArtwork = podcast ? getPublicPodcastArtworkUrl(podcast) : null;
  const pageUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : undefined;

  useMeta({
    title: episode && podcast ? `${episode.title} | ${podcast.title} | ${siteName}` : undefined,
    siteName: podcast ? siteName : undefined,
    description: episode?.description?.trim() || podcast?.description?.trim() || undefined,
    image: episodeArtwork ?? undefined,
    url: episode && podcast ? pageUrl : undefined,
    favicon: publicConfig?.customFeedSlug ? podcastArtwork : undefined,
    appleWebAppTitle: publicConfig?.customFeedSlug ? podcast?.title : undefined,
    appleTouchIcon: publicConfig?.customFeedSlug ? podcastArtwork : undefined,
  });

  const canWriteReview =
    podcast && episode && (!podcast.subscriberOnlyReviews || isAuthenticatedForPodcast(podcastSlug));
  const canShowMessage =
    podcast && episode && (!podcast.subscriberOnlyMessages || isAuthenticatedForPodcast(podcastSlug));

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const shareUrl =
    episode && podcast
      ? `${origin}${isCustomFeed ? `/${episodeSlug}` : `/feed/${podcastSlug}/${episodeSlug}`}`
      : '';
  const shareTitle = episode && podcast ? `${episode.title} - ${podcast.title}` : '';
  const embedUrl =
    episode && podcast
      ? `${origin}${isCustomFeed ? `/embed/${episodeSlug}` : `/embed/${podcastSlug}/${episodeSlug}`}`
      : '';
  const embedCode = embedUrl
    ? `<iframe src="${embedUrl}" width="100%" height="200" frameborder="0" allowfullscreen></iframe>`
    : '';

  const scheduledNotReleased = Boolean(episode?.scheduledNotReleased);
  const videoUrlRaw = scheduledNotReleased ? null : (episode?.privateVideoUrl ?? episode?.videoUrl ?? null);
  const videoUrl =
    !videoUrlRaw
      ? ''
      : videoUrlRaw.startsWith('http')
        ? videoUrlRaw
        : videoUrlRaw.startsWith('/')
          ? videoUrlRaw
          : `${origin}/${videoUrlRaw}`;

  const liquidActions = useMemo((): HarborfmActionHandlers | undefined => {
    if (!useLiquidLayout || !podcast || !episode) return undefined;
    return {
      message: canShowMessage ? () => setFeedbackOpen(true) : undefined,
      alerts: alertsInfo?.emailSignupAvailable ? () => setAlertsOpen(true) : undefined,
      share: shareUrl ? () => setShareOpen(true) : undefined,
      subscribe: podcast.subscriberOnlyFeedEnabled
        ? () => setShowLockInfo(true)
        : undefined,
      feedHref: `/api/public/podcasts/${encodeURIComponent(podcastSlug)}/rss`,
      writeReview:
        publicConfig?.reviewsEnabled === true &&
        podcast.feedShowReviewsEpisode !== false &&
        canWriteReview
          ? () => setWriteReviewOpen(true)
          : undefined,
    };
  }, [
    useLiquidLayout,
    podcast,
    episode,
    canShowMessage,
    alertsInfo?.emailSignupAvailable,
    shareUrl,
    podcastSlug,
    publicConfig?.reviewsEnabled,
    canWriteReview,
    setShowLockInfo,
  ]);

  const liquidBlocks = useMemo((): LiquidFeedBlocks => {
    if (!useLiquidLayout || !podcast || !episode) return {};

    const playerBlock = (
      <div className={styles.mainCard} data-harborfm-episode-card>
        <FeedEpisodeHeader
          episode={episode}
          podcast={podcast}
          podcastSlug={podcastSlug}
          plain
          onMessageClick={canShowMessage ? () => setFeedbackOpen(true) : undefined}
          onAlertsClick={
            alertsInfo?.emailSignupAvailable ? () => setAlertsOpen(true) : undefined
          }
          onLockClick={() => setShowLockInfo(true)}
          shareUrl={shareUrl}
          shareTitle={shareTitle}
          embedCode={embedCode}
          transcriptUrl={
            (episode as PublicEpisodeWithAuth).privateSrtUrl || episode.srtUrl || null
          }
          onTranscriptSeek={seekAndPlay}
          currentTime={currentTime}
        >
          <FeedEpisodePoll podcastSlug={podcastSlug} episodeSlug={episodeSlug} />
        </FeedEpisodeHeader>

        {videoUrl && (
          <div className={styles.videoWrap}>
            <FeedVideoPlayer
              key={videoUrl}
              src={videoUrl}
              poster={
                episode.artworkUrl
                  ? episode.artworkUrl
                  : episode.artworkFilename
                    ? `/api/public/artwork/${episode.podcastId}/episodes/${episode.id}/${encodeURIComponent(episode.artworkFilename)}`
                    : podcast.artworkUrl
                      ? podcast.artworkUrl
                      : podcast.artworkFilename
                        ? `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artworkFilename)}`
                        : undefined
              }
              ariaLabel={`Video for ${episode.title}`}
              className={styles.video}
            />
          </div>
        )}

        {audioUrl && !audioLoadFailed && (
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
              <FeedPlaybackControls
                currentTime={currentTime}
                durationSec={durationSec}
                volume={volume}
                setVolume={setVolume}
                playbackRate={playbackRate}
                cyclePlaybackRate={cyclePlaybackRate}
              />
            ) : null}
            {hasWaveform ? (
              <audio ref={audioRef} preload="none" style={{ display: 'none' }} onError={() => setAudioLoadFailed(true)}>
                <source src={audioUrl} type={episode.audioMime || 'audio/mpeg'} />
              </audio>
            ) : (
              <audio ref={audioRef} controls className={styles.audio} preload="none" onError={() => setAudioLoadFailed(true)}>
                <source src={audioUrl} type={episode.audioMime || 'audio/mpeg'} />
                Your browser does not support the audio element.
              </audio>
            )}
          </div>
        )}

        {(!audioUrl || audioLoadFailed) && (
          scheduledNotReleased ? (
            <div className={styles.scheduledPlaceholder} aria-label="Scheduled for future release">
              <p className={styles.noAudioText}>
                {episode.publishAt ? `Premiering ${new Date(episode.publishAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}` : 'Premiering soon'}
              </p>
            </div>
          ) : audioLoadFailed || !episode.subscriberOnly ? (
            <p className={styles.noAudioText}>Audio not available.</p>
          ) : (
            <FeedSubscriberOnlyMessage />
          )
        )}

        {audioUrl && !audioLoadFailed && (episode.markers?.length ?? 0) > 0 && (
          <FeedEpisodeChapters
            markers={episode.markers ?? []}
            currentTime={currentTime}
            durationSec={durationSec}
            isPlaying={isPlaying}
            onPlayChapter={seekAndPlay}
            onPause={togglePlay}
            onResume={togglePlay}
          />
        )}

        {audioUrl && !audioLoadFailed && (episode.soundbites?.length ?? 0) > 0 && (
          <FeedEpisodeSoundbites
            soundbites={episode.soundbites ?? []}
            currentTime={currentTime}
            isPlaying={isPlaying}
            seekAndPlay={seekAndPlay}
            onPause={togglePlay}
            onResume={togglePlay}
          />
        )}

        {podcast.feedShowEpisodeDescription !== false && episode.description && (
          <div className={styles.description}>
            <p>{episode.description}</p>
          </div>
        )}
        <FeedEpisodeFiles podcastSlug={podcastSlug!} episodeSlug={episodeSlug!} />
      </div>
    );

    return {
      site_header: <FeedSiteHeader flush />,
      breadcrumbs: (
        <FeedBreadcrumbs
          podcast={podcast}
          episode={episode}
          podcastSlug={podcastSlug}
          feedRootTo={isCustomFeed ? '/' : undefined}
        />
      ),
      player: playerBlock,
      funding:
        podcast.feedShowFunding !== false ? (
          <FeedFundingSupport
            fundingLinks={
              (episode.fundingLinks?.length ? episode.fundingLinks : podcast.fundingLinks) ?? null
            }
            plain
          />
        ) : undefined,
      cast:
        podcast.feedShowCast !== false && (episodeHosts.length > 0 || episodeGuests.length > 0) ? (
          <div className={styles.castCard}>
            <h2 className={styles.castTitle}>Cast</h2>
            {episodeHosts.length > 0 && (
              <section style={{ marginBottom: '1.5rem' }}>
                <h3 className={styles.castSectionTitle}>Hosts</h3>
                <FeedCastList cast={episodeHosts} />
              </section>
            )}
            {episodeGuests.length > 0 && (
              <section>
                <h3 className={styles.castSectionTitle}>Guests</h3>
                <FeedCastList cast={episodeGuests} />
              </section>
            )}
          </div>
        ) : undefined,
      reviews:
        publicConfig?.reviewsEnabled === true && podcast.feedShowReviewsEpisode !== false ? (
          <ReviewsCard
            podcastSlug={podcastSlug}
            episodeSlug={episodeSlug}
            enabled
            showWriteButton={Boolean(canWriteReview)}
            plain
          />
        ) : undefined,
      links: hasPodcastLinks(podcast) ? <PodcastLinksCard podcast={podcast} plain /> : undefined,
    };
  }, [
    useLiquidLayout,
    podcast,
    episode,
    podcastSlug,
    episodeSlug,
    canShowMessage,
    alertsInfo?.emailSignupAvailable,
    shareUrl,
    shareTitle,
    embedCode,
    currentTime,
    seekAndPlay,
    videoUrl,
    audioUrl,
    audioLoadFailed,
    hasWaveform,
    waveformData,
    durationSec,
    seek,
    togglePlay,
    isPlaying,
    volume,
    setVolume,
    playbackRate,
    cyclePlaybackRate,
    audioRef,
    scheduledNotReleased,
    episodeHosts,
    episodeGuests,
    isCustomFeed,
    publicConfig?.reviewsEnabled,
    canWriteReview,
    setShowLockInfo,
  ]);

  if (!podcastSlug || !episodeSlug) return null;

  if (
    podcastLoading ||
    episodeLoading ||
    (wantsLiquidTheme && themeRenderLoading && !themeRenderFallback)
  ) {
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

  if (themeRenderHardError) {
    return feedErrorLayout(<FeedUnavailable onRetry={() => void refetchThemeRender()} />);
  }

  const modals = (
    <>
      <FeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        context={{
          podcastSlug: podcastSlug ?? undefined,
          episodeSlug: episodeSlug ?? undefined,
          podcastTitle: podcast.title,
          episodeTitle: episode.title,
        }}
        accent={podcast.feedAccent}
      />

      <GetAlertsModal
        open={alertsOpen}
        onOpenChange={setAlertsOpen}
        podcastSlug={podcastSlug}
        podcastTitle={podcast.title}
        accent={podcast.feedAccent}
      />

      {showLockInfo && (
        <SubscriptionInfoDialog
          open={showLockInfo}
          onClose={() => setShowLockInfo(false)}
          isSubscriberOnly={Boolean(podcast.subscriberOnlyFeedEnabled && podcast.publicFeedDisabled)}
          podcastSlug={podcastSlug}
          canonicalFeedUrl={podcast.canonicalFeedUrl}
        />
      )}
      {shareUrl && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          url={shareUrl}
          title={shareTitle}
          embedCode={embedCode}
        />
      )}
      {canWriteReview && (
        <ReviewSubmitModal
          open={writeReviewOpen}
          onClose={() => setWriteReviewOpen(false)}
          podcastSlug={podcastSlug}
          episodeSlug={episodeSlug}
        />
      )}
    </>
  );

  if (useLiquidLayout && themeRender) {
    return (
      <LiquidFeedPage
        html={themeRender.html}
        cssHrefs={themeRender.cssHrefs}
        accent={podcast.feedAccent}
        blocks={liquidBlocks}
        actions={liquidActions}
        dialogs={modals}
      />
    );
  }

  return (
    <div className={sharedStyles.wrapper} style={feedAccentCssVars(podcast.feedAccent)}>
      <div className={sharedStyles.container}>
        <FeedSiteHeader />
        <main>
          <FeedBreadcrumbs podcast={podcast} episode={episode} podcastSlug={podcastSlug} feedRootTo={isCustomFeed ? '/' : undefined} />

          <div className={`${sharedStyles.card} ${styles.mainCard}`} data-harborfm-episode-card>
            <FeedEpisodeHeader
              episode={episode}
              podcast={podcast}
              podcastSlug={podcastSlug}
              onMessageClick={canShowMessage ? () => setFeedbackOpen(true) : undefined}
              onAlertsClick={
                alertsInfo?.emailSignupAvailable ? () => setAlertsOpen(true) : undefined
              }
              onLockClick={() => setShowLockInfo(true)}
              shareUrl={shareUrl}
              shareTitle={shareTitle}
              embedCode={embedCode}
              transcriptUrl={
                (episode as PublicEpisodeWithAuth).privateSrtUrl || episode.srtUrl || null
              }
              onTranscriptSeek={seekAndPlay}
              currentTime={currentTime}
            >
              <FeedEpisodePoll podcastSlug={podcastSlug} episodeSlug={episodeSlug} />
            </FeedEpisodeHeader>

            {videoUrl && (
              <div className={styles.videoWrap}>
                <FeedVideoPlayer
                  key={videoUrl}
                  src={videoUrl}
                  poster={
                    episode.artworkUrl
                      ? episode.artworkUrl
                      : episode.artworkFilename
                        ? `/api/public/artwork/${episode.podcastId}/episodes/${episode.id}/${encodeURIComponent(episode.artworkFilename)}`
                        : podcast.artworkUrl
                          ? podcast.artworkUrl
                          : podcast.artworkFilename
                            ? `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artworkFilename)}`
                            : undefined
                  }
                  ariaLabel={`Video for ${episode.title}`}
                  className={styles.video}
                />
              </div>
            )}

            {audioUrl && !audioLoadFailed && (
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
                  <FeedPlaybackControls
                    currentTime={currentTime}
                    durationSec={durationSec}
                    volume={volume}
                    setVolume={setVolume}
                    playbackRate={playbackRate}
                    cyclePlaybackRate={cyclePlaybackRate}
                  />
                ) : null}
                {hasWaveform ? (
                  <audio ref={audioRef} preload="none" style={{ display: 'none' }} onError={() => setAudioLoadFailed(true)}>
                    <source src={audioUrl} type={episode.audioMime || 'audio/mpeg'} />
                  </audio>
                ) : (
                  <audio ref={audioRef} controls className={styles.audio} preload="none" onError={() => setAudioLoadFailed(true)}>
                    <source src={audioUrl} type={episode.audioMime || 'audio/mpeg'} />
                    Your browser does not support the audio element.
                  </audio>
                )}
              </div>
            )}

            {(!audioUrl || audioLoadFailed) && (
              scheduledNotReleased ? (
                <div className={styles.scheduledPlaceholder} aria-label="Scheduled for future release">
                  <p className={styles.noAudioText}>
                    {episode.publishAt ? `Premiering ${new Date(episode.publishAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}` : 'Premiering soon'}
                  </p>
                </div>
              ) : audioLoadFailed || !episode.subscriberOnly ? (
                <p className={styles.noAudioText}>Audio not available.</p>
              ) : (
                <FeedSubscriberOnlyMessage />
              )
            )}

            {audioUrl && !audioLoadFailed && (episode.markers?.length ?? 0) > 0 && (
              <FeedEpisodeChapters
                markers={episode.markers ?? []}
                currentTime={currentTime}
                durationSec={durationSec}
                isPlaying={isPlaying}
                onPlayChapter={seekAndPlay}
                onPause={togglePlay}
                onResume={togglePlay}
              />
            )}

            {audioUrl && !audioLoadFailed && (episode.soundbites?.length ?? 0) > 0 && (
              <FeedEpisodeSoundbites
                soundbites={episode.soundbites ?? []}
                currentTime={currentTime}
                isPlaying={isPlaying}
                seekAndPlay={seekAndPlay}
                onPause={togglePlay}
                onResume={togglePlay}
              />
            )}

            {podcast.feedShowEpisodeDescription !== false && episode.description && (
              <div className={styles.description}>
                <p>{episode.description}</p>
              </div>
            )}
            <FeedEpisodeFiles podcastSlug={podcastSlug!} episodeSlug={episodeSlug!} />
            {podcast.feedShowFunding !== false && (
              <FeedFundingSupport
                fundingLinks={
                  (episode.fundingLinks?.length
                    ? episode.fundingLinks
                    : podcast.fundingLinks) ?? null
                }
              />
            )}
          </div>

          {podcast.feedShowCast !== false && (episodeHosts.length > 0 || episodeGuests.length > 0) && (
            <div className={`${sharedStyles.card} ${styles.castCard}`}>
              <h2 className={styles.castTitle}>Cast</h2>
              {episodeHosts.length > 0 && (
                <section style={{ marginBottom: '1.5rem' }}>
                  <h3 className={styles.castSectionTitle}>Hosts</h3>
                  <FeedCastList cast={episodeHosts} />
                </section>
              )}
              {episodeGuests.length > 0 && (
                <section>
                  <h3 className={styles.castSectionTitle}>Guests</h3>
                  <FeedCastList cast={episodeGuests} />
                </section>
              )}
            </div>
          )}

          {publicConfig?.reviewsEnabled === true && podcast.feedShowReviewsEpisode !== false && (
            <ReviewsCard podcastSlug={podcastSlug} episodeSlug={episodeSlug} enabled showWriteButton={canWriteReview} />
          )}

          {hasPodcastLinks(podcast) && (
            <div className={styles.linksCardWrap}>
              <PodcastLinksCard podcast={podcast} />
            </div>
          )}
        </main>
      </div>

      {modals}
    </div>
  );
}

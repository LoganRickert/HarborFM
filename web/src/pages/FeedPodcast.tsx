import { useState, useMemo, useCallback, useEffect } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPublicPodcast,
  getPublicEpisodes,
  getPublicConfig,
  getPublicPodcastArtworkUrl,
  getPodcastThemeRender,
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
import {
  FeedSiteHeader,
  FeedPodcastHeader,
  PodcastLinksCard,
  hasPodcastLinks,
  FeedSearchControls,
  FeedEpisodesList,
  FeedEpisodeCard,
  FeedCastCard,
  ReviewsCard,
  FeedPodrollCard,
  FeedFundingSupport,
} from '../components/Feed';
import { LiquidFeedPage, type LiquidFeedBlocks } from '../components/Feed/LiquidFeedPage';
import { useSubscriberAuth } from '../hooks/useSubscriberAuth';
import { feedAccentCssVars } from '../utils/feedAccent';
import sharedStyles from '../styles/shared.module.css';
import listStyles from '../components/Feed/FeedPodcast/FeedEpisodesList.module.css';
import styles from './FeedPodcast.module.css';

function episodeHasPlayableAudio(ep: PublicEpisodeWithAuth): boolean {
  return Boolean(ep.privateAudioUrl || ep.audioUrl);
}

export function FeedPodcast({ podcastSlugOverride }: { podcastSlugOverride?: string } = {}) {
  const queryClient = useQueryClient();
  const { podcastSlug: podcastSlugParam } = useParams<{ podcastSlug: string }>();
  const podcastSlug = podcastSlugOverride ?? podcastSlugParam ?? '';
  const [playingEpisodeId, setPlayingEpisodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchDebounced = useDebouncedValue(searchQuery);
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);

  // Cancel any active import polling when on feed pages
  useEffect(() => {
    queryClient.cancelQueries({ queryKey: ['activeImport'] });
    queryClient.removeQueries({ queryKey: ['activeImport'] });
  }, [queryClient]);

  const { isAuthenticatedForPodcast } = useSubscriberAuth();
  const subscriberAuthed = isAuthenticatedForPodcast(podcastSlug);

  const { data: publicConfig } = useQuery({
    queryKey: ['publicConfig', typeof window !== 'undefined' ? window.location.host : ''],
    queryFn: getPublicConfig,
    staleTime: 5 * 60 * 1000,
  });

  const { data: podcast, isLoading: podcastLoading, isError: podcastError, error: podcastQueryError, refetch: refetchPodcast } = useQuery({
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
    queryKey: ['public-episodes', podcastSlug, sortNewestFirst, searchDebounced, subscriberAuthed],
    queryFn: ({ pageParam = 0 }) =>
      getPublicEpisodes(
        podcastSlug!,
        10,
        pageParam,
        sortNewestFirst ? 'newest' : 'oldest',
        searchDebounced || undefined
      ),
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

  const { data: trailerEpisodesData } = useQuery({
    queryKey: ['public-episodes-trailers', podcastSlug, subscriberAuthed],
    queryFn: () => getPublicEpisodes(podcastSlug!, 20, 0, 'newest', undefined, 'trailer'),
    enabled: !!podcastSlug,
    refetchOnMount: 'always',
  });

  const { data: alertsInfo } = useQuery({
    queryKey: ['public-episode-alerts', podcastSlug],
    queryFn: () => getPublicEpisodeAlerts(podcastSlug!),
    enabled: !!podcastSlug,
    staleTime: 60_000,
  });

  const wantsLiquidTheme = Boolean(podcast && isLiquidFeedTheme(podcast.feedTheme));

  const {
    data: themeRender,
    isLoading: themeRenderLoading,
    isError: themeRenderError,
    error: themeRenderQueryError,
    refetch: refetchThemeRender,
  } = useQuery({
    queryKey: ['theme-render-podcast', podcastSlug],
    queryFn: () => getPodcastThemeRender(podcastSlug!),
    enabled: !!podcastSlug && wantsLiquidTheme,
    retry: false,
  });

  const themeRenderStatus = (themeRenderQueryError as ApiError | undefined)?.status;
  const themeRenderFallback =
    wantsLiquidTheme && themeRenderError && (themeRenderStatus === 400 || themeRenderStatus === 404);
  const themeRenderHardError = wantsLiquidTheme && themeRenderError && !themeRenderFallback;
  const useLiquidLayout = wantsLiquidTheme && !themeRenderFallback && !!themeRender;

  const featuredTrailer = useMemo(() => {
    const trailers = trailerEpisodesData?.episodes ?? [];
    return (
      trailers.find(
        (ep) =>
          String(ep.episodeType ?? '').toLowerCase() === 'trailer' &&
          episodeHasPlayableAudio(ep as PublicEpisodeWithAuth),
      ) ?? null
    );
  }, [trailerEpisodesData]);

  // Flatten all loaded episodes
  const allEpisodes = useMemo(() => {
    return data?.pages.flatMap((page) => page.episodes) ?? [];
  }, [data]);

  const handlePlay = useCallback((episodeId: string) => {
    setPlayingEpisodeId((prev) => {
      if (prev && prev !== episodeId) {
        const audio = document.getElementById(`audio-${prev}`) as HTMLAudioElement | null;
        audio?.pause();
      }
      return episodeId;
    });
  }, []);

  const handlePause = useCallback((episodeId: string) => {
    setPlayingEpisodeId((current) => (current === episodeId ? null : current));
  }, []);

  // Episodes from server are already filtered (by search) and sorted; exclude featured trailer when shown
  const filteredAndSortedEpisodes = useMemo(() => {
    const featuredId = featuredTrailer?.id;
    return [...allEpisodes]
      .filter((ep) => !featuredId || ep.id !== featuredId)
      .sort((a, b) => {
        const dateA = a.publishAt ? new Date(a.publishAt).getTime() : new Date(a.createdAt).getTime();
        const dateB = b.publishAt ? new Date(b.publishAt).getTime() : new Date(b.createdAt).getTime();
        return sortNewestFirst ? dateB - dateA : dateA - dateB;
      });
  }, [allEpisodes, sortNewestFirst, featuredTrailer?.id]);

  const siteName = getSiteDisplayName(publicConfig?.whiteLabel);
  const podcastArtwork = podcast ? getPublicPodcastArtworkUrl(podcast) : null;
  const pageUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : undefined;

  // Update meta tags
  const isCustomDomain = !!publicConfig?.customFeedSlug;
  useMeta({
    title: podcast ? `${podcast.title} | ${siteName}` : undefined,
    siteName: podcast ? siteName : undefined,
    description: podcast?.description?.trim() || undefined,
    image: podcastArtwork ?? undefined,
    url: podcast ? pageUrl : undefined,
    favicon: isCustomDomain ? podcastArtwork : undefined,
  });

  const canWriteReview =
    podcast && (!podcast.subscriberOnlyReviews || isAuthenticatedForPodcast(podcastSlug));
  const canShowMessage =
    podcast && (!podcast.subscriberOnlyMessages || isAuthenticatedForPodcast(podcastSlug));

  const liquidBlocks = useMemo((): LiquidFeedBlocks => {
    if (!useLiquidLayout || !podcast) return {};
    return {
      site_header: <FeedSiteHeader flush />,
      show_header: (
        <FeedPodcastHeader
          podcast={podcast}
          podcastSlug={podcastSlug}
          plain
          onMessageClick={canShowMessage ? () => setFeedbackOpen(true) : undefined}
          onAlertsClick={
            alertsInfo?.emailSignupAvailable ? () => setAlertsOpen(true) : undefined
          }
          shareUrl={
            podcast.canonicalFeedUrl ??
            (typeof window !== 'undefined'
              ? `${window.location.origin}${window.location.pathname}`
              : undefined)
          }
          shareTitle={`${podcast.title} - HarborFM`}
        />
      ),
      search: (
        <FeedSearchControls
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortNewestFirst={sortNewestFirst}
          onSortToggle={setSortNewestFirst}
          placeholder="Search episodes..."
          plain
        />
      ),
      episodes: (
        <>
          {episodesLoading && <p className={sharedStyles.muted}>Loading episodes...</p>}
          {!episodesLoading && filteredAndSortedEpisodes.length === 0 && (
            <p className={sharedStyles.muted}>
              {searchQuery
                ? 'No episodes match your search.'
                : featuredTrailer
                  ? 'No other episodes yet.'
                  : 'No episodes yet.'}
            </p>
          )}
          {!episodesLoading && filteredAndSortedEpisodes.length > 0 && (
            <FeedEpisodesList
              episodes={filteredAndSortedEpisodes}
              podcast={podcast}
              podcastSlug={podcastSlug}
              playingEpisodeId={playingEpisodeId}
              onPlay={handlePlay}
              onPause={handlePause}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={() => fetchNextPage()}
              useShortEpisodeUrls={!!podcastSlugOverride}
              plain
            />
          )}
        </>
      ),
      funding:
        podcast.feedShowFunding !== false ? (
          <FeedFundingSupport fundingLinks={podcast.fundingLinks ?? null} plain />
        ) : undefined,
      links: hasPodcastLinks(podcast) ? (
        <PodcastLinksCard podcast={podcast} plain />
      ) : undefined,
      cast:
        podcast.feedShowCast !== false ? (
          <FeedCastCard podcastSlug={podcastSlug} plain />
        ) : undefined,
      podroll:
        podcast.feedShowPodroll !== false ? (
          <FeedPodrollCard podroll={podcast.podroll} plain />
        ) : undefined,
      reviews:
        publicConfig?.reviewsEnabled === true && podcast.feedShowReviewsPodcast !== false ? (
          <ReviewsCard
            podcastSlug={podcastSlug}
            enabled
            showWriteButton={Boolean(canWriteReview)}
            plain
          />
        ) : undefined,
    };
  }, [
    useLiquidLayout,
    podcast,
    searchQuery,
    sortNewestFirst,
    episodesLoading,
    filteredAndSortedEpisodes,
    featuredTrailer,
    podcastSlug,
    playingEpisodeId,
    handlePlay,
    handlePause,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    podcastSlugOverride,
    publicConfig?.reviewsEnabled,
    canWriteReview,
    canShowMessage,
    alertsInfo?.emailSignupAvailable,
  ]);

  if (!podcastSlug) return null;

  if (podcastLoading || (wantsLiquidTheme && themeRenderLoading && !themeRenderFallback)) {
    return <FullPageLoading />;
  }

  if (podcastError || !podcast) {
    const showUnavailable = podcastError && isFeedUnavailableError(podcastQueryError);
    return (
      <div className={sharedStyles.wrapper}>
        <div className={sharedStyles.container}>
          <FeedSiteHeader />
          <main>
            {showUnavailable ? (
              <FeedUnavailable onRetry={() => void refetchPodcast()} />
            ) : (
              <div className={sharedStyles.error}>Podcast not found</div>
            )}
          </main>
        </div>
      </div>
    );
  }

  const isSubscriberOnly = Boolean(podcast.subscriberOnlyFeedEnabled && podcast.publicFeedDisabled);

  if (themeRenderHardError) {
    return (
      <div className={sharedStyles.wrapper}>
        <div className={sharedStyles.container}>
          <FeedSiteHeader />
          <main>
            <FeedUnavailable onRetry={() => void refetchThemeRender()} />
          </main>
        </div>
      </div>
    );
  }

  const modals = (
    <>
      <FeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        context={{ podcastSlug: podcastSlug ?? undefined, podcastTitle: podcast.title }}
        accent={podcast.feedAccent}
      />
      <GetAlertsModal
        open={alertsOpen}
        onOpenChange={setAlertsOpen}
        podcastSlug={podcastSlug}
        podcastTitle={podcast.title}
        accent={podcast.feedAccent}
      />
    </>
  );

  if (useLiquidLayout && themeRender) {
    return (
      <>
        <LiquidFeedPage
          html={themeRender.html}
          cssHrefs={themeRender.cssHrefs}
          accent={podcast.feedAccent}
          blocks={liquidBlocks}
        />
        {modals}
      </>
    );
  }

  return (
    <div className={sharedStyles.wrapper} style={feedAccentCssVars(podcast.feedAccent)}>
      <div className={sharedStyles.container}>
        <FeedSiteHeader />
        <main>
          <div className={`${sharedStyles.card} ${isSubscriberOnly ? styles.heroCardSubscriberOnly : ''}`}>
            <FeedPodcastHeader
              podcast={podcast}
              podcastSlug={podcastSlug}
              onMessageClick={canShowMessage ? () => setFeedbackOpen(true) : undefined}
              onAlertsClick={
                alertsInfo?.emailSignupAvailable ? () => setAlertsOpen(true) : undefined
              }
              shareUrl={
                podcast?.canonicalFeedUrl ??
                (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined)
              }
              shareTitle={podcast ? `${podcast.title} - HarborFM` : undefined}
            />
          </div>

          {featuredTrailer && (
            <div className={`${sharedStyles.card} ${styles.trailerCard}`}>
              <ul className={listStyles.list}>
                <FeedEpisodeCard
                  episode={featuredTrailer}
                  podcastSlug={podcastSlug}
                  isSubscriberOnly={
                    Boolean(featuredTrailer.subscriberOnly) || Boolean(podcast.publicFeedDisabled)
                  }
                  showPlayer={true}
                  playingEpisodeId={playingEpisodeId}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  useShortEpisodeUrls={!!podcastSlugOverride}
                  showDescription={podcast.feedShowEpisodeDescription !== false}
                />
              </ul>
            </div>
          )}

          {podcast && hasPodcastLinks(podcast) && (
            <div className={styles.linksCardWrap}>
              <PodcastLinksCard podcast={podcast} />
            </div>
          )}

          <div className={`${sharedStyles.card} ${styles.episodesCard}`}>
            <div className={styles.episodes}>
              <div className={styles.episodesHeader}>
                <h2 className={styles.episodesTitle}>Episodes</h2>
              </div>
              <FeedSearchControls
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                sortNewestFirst={sortNewestFirst}
                onSortToggle={setSortNewestFirst}
                placeholder="Search episodes..."
              />
              {episodesLoading && <p className={sharedStyles.muted}>Loading episodes...</p>}
              {!episodesLoading && filteredAndSortedEpisodes.length === 0 && (
                <p className={sharedStyles.muted}>
                  {searchQuery
                    ? 'No episodes match your search.'
                    : featuredTrailer
                      ? 'No other episodes yet.'
                      : 'No episodes yet.'}
                </p>
              )}
              {!episodesLoading && filteredAndSortedEpisodes.length > 0 && (
                <FeedEpisodesList
                  episodes={filteredAndSortedEpisodes}
                  podcast={podcast}
                  podcastSlug={podcastSlug}
                  playingEpisodeId={playingEpisodeId}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  hasNextPage={hasNextPage}
                  isFetchingNextPage={isFetchingNextPage}
                  onLoadMore={() => fetchNextPage()}
                  useShortEpisodeUrls={!!podcastSlugOverride}
                />
              )}
            </div>
          </div>

          {podcast.feedShowCast !== false && <FeedCastCard podcastSlug={podcastSlug} />}
          {podcast.feedShowPodroll !== false && <FeedPodrollCard podroll={podcast.podroll} />}
          {publicConfig?.reviewsEnabled === true && podcast.feedShowReviewsPodcast !== false && (
            <ReviewsCard podcastSlug={podcastSlug} enabled showWriteButton={canWriteReview} />
          )}
        </main>
      </div>

      {modals}
    </div>
  );
}

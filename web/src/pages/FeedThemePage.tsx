import { useMemo, useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPublicPodcast,
  getPublicEpisodes,
  getPublicConfig,
  getPublicPodcastArtworkUrl,
  getThemePageRender,
} from '../api/public';
import { FullPageLoading } from '../components/Loading';
import { isFeedUnavailableError, type ApiError } from '../api/client';
import { FeedUnavailable } from '../components/FeedUnavailable';
import { FeedbackModal } from '../components/FeedbackModal';
import { GetAlertsModal } from '../components/GetAlertsModal';
import { getPublicEpisodeAlerts } from '../api/episodeAlerts';
import { useMeta } from '../hooks/useMeta';
import { getSiteDisplayName } from '../utils/siteBranding';
import { isLiquidFeedTheme, normalizeThemePageFile } from '../utils/feedTheme';
import {
  FeedSiteHeader,
  FeedPodcastHeader,
  PodcastLinksCard,
  hasPodcastLinks,
  FeedSearchControls,
  FeedEpisodesList,
  FeedCastCard,
  ReviewsCard,
  FeedPodrollCard,
  FeedFundingSupport,
  SubscriptionInfoDialog,
} from '../components/Feed';
import { LiquidFeedPage, type LiquidFeedBlocks } from '../components/Feed/LiquidFeedPage';
import type { HarborfmActionHandlers } from '../components/Feed/harborfmActions';
import { ShareDialog } from '../components/ShareDialog';
import { ReviewSubmitModal } from '../components/Feed/ReviewSubmitModal';
import { useSubscriberAuth } from '../hooks/useSubscriberAuth';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import sharedStyles from '../styles/shared.module.css';

export function FeedThemePage({
  podcastSlugOverride,
  pageFileOverride,
}: {
  podcastSlugOverride?: string;
  pageFileOverride?: string;
} = {}) {
  const queryClient = useQueryClient();
  const { podcastSlug: podcastSlugParam, pageFile: pageFileParam } = useParams<{
    podcastSlug?: string;
    pageFile?: string;
  }>();
  const podcastSlug = podcastSlugOverride ?? podcastSlugParam ?? '';
  const pageFile = normalizeThemePageFile(pageFileOverride ?? pageFileParam);

  const [playingEpisodeId, setPlayingEpisodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchDebounced = useDebouncedValue(searchQuery);
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [writeReviewOpen, setWriteReviewOpen] = useState(false);

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

  const {
    data: podcast,
    isLoading: podcastLoading,
    isError: podcastError,
    error: podcastQueryError,
    refetch: refetchPodcast,
  } = useQuery({
    queryKey: ['public-podcast', podcastSlug],
    queryFn: () => getPublicPodcast(podcastSlug),
    enabled: !!podcastSlug && !!pageFile,
    refetchOnMount: 'always',
  });

  const wantsLiquidTheme = Boolean(podcast && isLiquidFeedTheme(podcast.feedTheme));

  const {
    data: themeRender,
    isLoading: themeRenderLoading,
    isError: themeRenderError,
    error: themeRenderQueryError,
    refetch: refetchThemeRender,
  } = useQuery({
    queryKey: ['theme-render-page', podcastSlug, pageFile],
    queryFn: () => getThemePageRender(podcastSlug, pageFile!),
    enabled: !!podcastSlug && !!pageFile && wantsLiquidTheme,
    retry: false,
  });

  const {
    data: episodesData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: episodesLoading,
  } = useInfiniteQuery({
    queryKey: ['public-episodes', podcastSlug, sortNewestFirst, searchDebounced, subscriberAuthed],
    queryFn: ({ pageParam = 0 }) =>
      getPublicEpisodes(
        podcastSlug,
        10,
        pageParam,
        sortNewestFirst ? 'newest' : 'oldest',
        searchDebounced || undefined,
      ),
    enabled: !!podcastSlug && !!themeRender,
    refetchOnMount: 'always',
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore) {
        return lastPage.offset + lastPage.episodes.length;
      }
      return undefined;
    },
    initialPageParam: 0,
  });

  const { data: alertsInfo } = useQuery({
    queryKey: ['public-episode-alerts', podcastSlug],
    queryFn: () => getPublicEpisodeAlerts(podcastSlug),
    enabled: !!podcastSlug,
    staleTime: 60_000,
  });

  const allEpisodes = useMemo(
    () => episodesData?.pages.flatMap((page) => page.episodes) ?? [],
    [episodesData],
  );

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

  const siteName = getSiteDisplayName(publicConfig?.whiteLabel);
  const pageTitle = podcast ? `${podcast.title} | ${siteName}` : undefined;
  const podcastArtwork = podcast ? getPublicPodcastArtworkUrl(podcast) : null;
  const pageUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : undefined;
  const isCustomDomain = !!publicConfig?.customFeedSlug;

  useMeta({
    title: pageTitle,
    siteName: podcast ? siteName : undefined,
    description: podcast?.description?.trim() || undefined,
    image: podcastArtwork ?? undefined,
    url: podcast ? pageUrl : undefined,
    favicon: isCustomDomain ? podcastArtwork : undefined,
    appleWebAppTitle: isCustomDomain ? podcast?.title : undefined,
    appleTouchIcon: isCustomDomain ? podcastArtwork : undefined,
  });

  const canWriteReview =
    podcast && (!podcast.subscriberOnlyReviews || isAuthenticatedForPodcast(podcastSlug));
  const canShowMessage =
    podcast && (!podcast.subscriberOnlyMessages || isAuthenticatedForPodcast(podcastSlug));
  const hasSubscriberFeatures = Boolean(podcast?.subscriberOnlyFeedEnabled);
  const isSubscriberOnly = Boolean(
    podcast?.subscriberOnlyFeedEnabled && podcast?.publicFeedDisabled,
  );
  const shareUrl =
    podcast?.canonicalFeedUrl ??
    (typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : undefined);
  const rssUrl = podcast
    ? `/api/public/podcasts/${encodeURIComponent(podcastSlug)}/rss`
    : null;

  const liquidActions = useMemo((): HarborfmActionHandlers | undefined => {
    if (!podcast) return undefined;
    return {
      message: canShowMessage ? () => setFeedbackOpen(true) : undefined,
      alerts: alertsInfo?.emailSignupAvailable ? () => setAlertsOpen(true) : undefined,
      share: shareUrl ? () => setShareOpen(true) : undefined,
      subscribe: hasSubscriberFeatures ? () => setSubscribeOpen(true) : undefined,
      feedHref: rssUrl,
      writeReview:
        publicConfig?.reviewsEnabled === true &&
        podcast.feedShowReviewsPodcast !== false &&
        canWriteReview
          ? () => setWriteReviewOpen(true)
          : undefined,
    };
  }, [
    podcast,
    canShowMessage,
    alertsInfo?.emailSignupAvailable,
    shareUrl,
    hasSubscriberFeatures,
    rssUrl,
    publicConfig?.reviewsEnabled,
    canWriteReview,
  ]);

  const liquidBlocks = useMemo((): LiquidFeedBlocks => {
    if (!podcast || !themeRender) return {};
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
          shareTitle={pageTitle}
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
          {!episodesLoading && allEpisodes.length === 0 && (
            <p className={sharedStyles.muted}>
              {searchQuery ? 'No episodes match your search.' : 'No episodes yet.'}
            </p>
          )}
          {!episodesLoading && allEpisodes.length > 0 && (
            <FeedEpisodesList
              episodes={allEpisodes}
              podcast={podcast}
              podcastSlug={podcastSlug}
              playingEpisodeId={playingEpisodeId}
              onPlay={handlePlay}
              onPause={handlePause}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={() => fetchNextPage()}
              useShortEpisodeUrls={isCustomDomain}
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
    podcast,
    pageTitle,
    themeRender,
    podcastSlug,
    searchQuery,
    sortNewestFirst,
    episodesLoading,
    allEpisodes,
    playingEpisodeId,
    handlePlay,
    handlePause,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isCustomDomain,
    publicConfig?.reviewsEnabled,
    canWriteReview,
    canShowMessage,
    alertsInfo?.emailSignupAvailable,
  ]);

  if (!pageFile || !podcastSlug) {
    return (
      <div className={sharedStyles.wrapper}>
        <div className={sharedStyles.container}>
          <FeedSiteHeader />
          <main>
            <div className={sharedStyles.error}>Page not found</div>
          </main>
        </div>
      </div>
    );
  }

  if (podcastLoading || (wantsLiquidTheme && themeRenderLoading)) {
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

  if (!wantsLiquidTheme) {
    return (
      <div className={sharedStyles.wrapper}>
        <div className={sharedStyles.container}>
          <FeedSiteHeader />
          <main>
            <div className={sharedStyles.error}>Page not found</div>
          </main>
        </div>
      </div>
    );
  }

  const themeStatus = (themeRenderQueryError as ApiError | undefined)?.status;
  if (themeRenderError || !themeRender) {
    if (themeStatus === 404 || themeStatus === 400) {
      return (
        <div className={sharedStyles.wrapper}>
          <div className={sharedStyles.container}>
            <FeedSiteHeader />
            <main>
              <div className={sharedStyles.error}>Page not found</div>
            </main>
          </div>
        </div>
      );
    }
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

  return (
    <LiquidFeedPage
      html={themeRender.html}
      cssHrefs={themeRender.cssHrefs}
      accent={podcast.feedAccent}
      blocks={liquidBlocks}
      actions={liquidActions}
      dialogs={
        <>
          <FeedbackModal
            open={feedbackOpen}
            onOpenChange={setFeedbackOpen}
            context={{ podcastSlug, podcastTitle: podcast.title }}
            accent={podcast.feedAccent}
          />
          <GetAlertsModal
            open={alertsOpen}
            onOpenChange={setAlertsOpen}
            podcastSlug={podcastSlug}
            podcastTitle={podcast.title}
            accent={podcast.feedAccent}
          />
          {shareUrl != null && (
            <ShareDialog
              open={shareOpen}
              onOpenChange={setShareOpen}
              url={shareUrl}
              title={pageTitle ?? podcast.title}
            />
          )}
          {hasSubscriberFeatures && (
            <SubscriptionInfoDialog
              open={subscribeOpen}
              onClose={() => setSubscribeOpen(false)}
              isSubscriberOnly={isSubscriberOnly}
              podcastSlug={podcastSlug}
              canonicalFeedUrl={podcast.canonicalFeedUrl}
            />
          )}
          {canWriteReview && (
            <ReviewSubmitModal
              open={writeReviewOpen}
              onClose={() => setWriteReviewOpen(false)}
              podcastSlug={podcastSlug}
            />
          )}
        </>
      }
    />
  );
}

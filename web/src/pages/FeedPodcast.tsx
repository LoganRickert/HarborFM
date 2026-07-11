import { useState, useMemo, useCallback, useEffect } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { getPublicPodcast, getPublicEpisodes, getPublicConfig, getPublicPodcastArtworkUrl } from '../api/public';
import { FullPageLoading } from '../components/Loading';
import { isFeedUnavailableError } from '../api/client';
import { FeedUnavailable } from '../components/FeedUnavailable';
import { FeedbackModal } from '../components/FeedbackModal';
import { useMeta } from '../hooks/useMeta';
import { getSiteDisplayName } from '../utils/siteBranding';
import {
  FeedSiteHeader,
  FeedPodcastHeader,
  PodcastLinksCard,
  hasPodcastLinks,
  FeedSearchControls,
  FeedEpisodesList,
  FeedCastCard,
  ReviewsCard,
} from '../components/Feed';
import { useSubscriberAuth } from '../hooks/useSubscriberAuth';
import sharedStyles from '../styles/shared.module.css';
import styles from './FeedPodcast.module.css';

export function FeedPodcast({ podcastSlugOverride }: { podcastSlugOverride?: string } = {}) {
  const queryClient = useQueryClient();
  const { podcastSlug: podcastSlugParam } = useParams<{ podcastSlug: string }>();
  const podcastSlug = podcastSlugOverride ?? podcastSlugParam ?? '';
  const [playingEpisodeId, setPlayingEpisodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchDebounced = useDebouncedValue(searchQuery);
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Cancel any active import polling when on feed pages
  useEffect(() => {
    queryClient.cancelQueries({ queryKey: ['activeImport'] });
    queryClient.removeQueries({ queryKey: ['activeImport'] });
  }, [queryClient]);

  const { isAuthenticatedForPodcast } = useSubscriberAuth();

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
    queryKey: ['public-episodes', podcastSlug, sortNewestFirst, searchDebounced],
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

  // Episodes from server are already filtered (by search) and sorted
  const filteredAndSortedEpisodes = useMemo(() => {
    return [...allEpisodes].sort((a, b) => {
      const dateA = a.publishAt ? new Date(a.publishAt).getTime() : new Date(a.createdAt).getTime();
      const dateB = b.publishAt ? new Date(b.publishAt).getTime() : new Date(b.createdAt).getTime();
      return sortNewestFirst ? dateB - dateA : dateA - dateB;
    });
  }, [allEpisodes, sortNewestFirst]);

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

  if (!podcastSlug) return null;

  if (podcastLoading) {
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
  const canWriteReview = !podcast.subscriberOnlyReviews || isAuthenticatedForPodcast(podcastSlug);
  const canShowMessage = !podcast.subscriberOnlyMessages || isAuthenticatedForPodcast(podcastSlug);

  return (
    <div className={sharedStyles.wrapper}>
      <div className={sharedStyles.container}>
        <FeedSiteHeader />
        <main>
          <div className={`${sharedStyles.card} ${isSubscriberOnly ? styles.heroCardSubscriberOnly : ''}`}>
            <FeedPodcastHeader
              podcast={podcast}
              podcastSlug={podcastSlug}
              onMessageClick={canShowMessage ? () => setFeedbackOpen(true) : undefined}
              shareUrl={
                podcast?.canonicalFeedUrl ??
                (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined)
              }
              shareTitle={podcast ? `${podcast.title} - HarborFM` : undefined}
            />
          </div>

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
                  {searchQuery ? 'No episodes match your search.' : 'No episodes yet.'}
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

          <FeedCastCard podcastSlug={podcastSlug} />
          {publicConfig?.reviewsEnabled === true && (
            <ReviewsCard podcastSlug={podcastSlug} enabled showWriteButton={canWriteReview} />
          )}
        </main>
      </div>

      <FeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        context={{ podcastSlug: podcastSlug ?? undefined, podcastTitle: podcast.title }}
      />
    </div>
  );
}

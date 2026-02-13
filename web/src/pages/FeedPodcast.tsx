import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { getPublicPodcast, getPublicEpisodes } from '../api/public';
import { FullPageLoading } from '../components/Loading';
import { isFeedUnavailableError } from '../api/client';
import { FeedUnavailable } from '../components/FeedUnavailable';
import { FeedbackModal } from '../components/FeedbackModal';
import { useMeta } from '../hooks/useMeta';
import {
  FeedSiteHeader,
  FeedPodcastHeader,
  FeedSearchControls,
  FeedEpisodesList,
} from '../components/Feed';
import sharedStyles from '../styles/shared.module.css';
import styles from './FeedPodcast.module.css';

export function FeedPodcast({ podcastSlugOverride }: { podcastSlugOverride?: string } = {}) {
  const queryClient = useQueryClient();
  const { podcastSlug: podcastSlugParam } = useParams<{ podcastSlug: string }>();
  const podcastSlug = podcastSlugOverride ?? podcastSlugParam ?? '';
  const [playingEpisodeId, setPlayingEpisodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Cancel any active import polling when on feed pages
  useEffect(() => {
    queryClient.cancelQueries({ queryKey: ['activeImport'] });
    queryClient.removeQueries({ queryKey: ['activeImport'] });
  }, [queryClient]);

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
        return sortNewestFirst ? dateB - dateA : dateA - dateB;
      });
  }, [allEpisodes, searchQuery, sortNewestFirst]);

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

  const isSubscriberOnly = podcast.subscriber_only_feed_enabled === 1 && podcast.public_feed_disabled === 1;

  return (
    <div className={sharedStyles.wrapper}>
      <div className={sharedStyles.container}>
        <FeedSiteHeader />
        <main>
          <div className={`${sharedStyles.card} ${isSubscriberOnly ? styles.heroCardSubscriberOnly : ''}`}>
            <FeedPodcastHeader
              podcast={podcast}
              podcastSlug={podcastSlug}
              onMessageClick={() => setFeedbackOpen(true)}
            />
          </div>

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

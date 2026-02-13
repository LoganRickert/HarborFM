import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPublicPodcasts } from '../api/public';
import { FeedUnavailable } from '../components/FeedUnavailable';
import { useMeta } from '../hooks/useMeta';
import { useFeedSearch } from '../hooks/useFeedSearch';
import {
  FeedSiteHeader,
  FeedPromoCard,
  FeedSearchControls,
  FeedPodcastCard,
  FeedEmptyState,
  FeedPagination,
} from '../components/Feed';
import sharedStyles from '../styles/shared.module.css';
import styles from './FeedHome.module.css';

const FEED_PAGE_SIZE = 25;

export function FeedHome() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const { searchQuery, searchDebounced, setSearchQuery, sortNewestFirst, setSortNewestFirst } = useFeedSearch();

  // Cancel any active import polling when on feed pages
  useEffect(() => {
    console.log('[FeedHome] canceling active import polling');
    queryClient.cancelQueries({ queryKey: ['activeImport'] });
    queryClient.removeQueries({ queryKey: ['activeImport'] });
  }, [queryClient]);

  useEffect(() => {
    setPage(1);
  }, [searchDebounced]);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [
      'public-podcasts',
      page,
      searchDebounced,
      sortNewestFirst ? 'newest' : 'oldest',
    ],
    queryFn: () =>
      getPublicPodcasts({
        limit: FEED_PAGE_SIZE,
        offset: (page - 1) * FEED_PAGE_SIZE,
        q: searchDebounced || undefined,
        sort: sortNewestFirst ? 'newest' : 'oldest',
      }),
    refetchOnMount: 'always',
    placeholderData: (previousData) => previousData,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / FEED_PAGE_SIZE));
  const podcasts = data?.podcasts ?? [];
  const rangeStart = total === 0 ? 0 : (data?.offset ?? 0) + 1;
  const rangeEnd = (data?.offset ?? 0) + podcasts.length;

  useEffect(() => {
    setPage((p) => (p > totalPages ? Math.max(1, totalPages) : p));
  }, [totalPages]);

  useMeta({
    title: 'Podcasts - HarborFM',
    description: 'Browse all podcasts on HarborFM.',
  });

  return (
    <div className={sharedStyles.wrapper}>
      <div className={sharedStyles.container}>
        <FeedSiteHeader />
        <main>
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <h1 className={styles.title}>Podcasts</h1>
              <p className={styles.subtitle}>
                {data != null
                  ? total > 0
                    ? `${total} show${total === 1 ? '' : 's'} · Browse and listen`
                    : 'Browse and listen to shows on the platform'
                  : 'Browse and listen to shows on the platform'}
              </p>
            </div>
          </header>

          <FeedPromoCard />

          {isError && (
            <FeedUnavailable onRetry={() => void refetch()} />
          )}

          {!isError && (
            <>
              <FeedSearchControls
                searchQuery={searchQuery}
                onSearchChange={(value) => {
                  setSearchQuery(value);
                  setPage(1);
                }}
                sortNewestFirst={sortNewestFirst}
                onSortToggle={(newest) => {
                  setSortNewestFirst(newest);
                  setPage(1);
                }}
                placeholder="Search by title, author, or description..."
              />

              {isLoading && !data && (
                <div className={styles.loading}>
                  <div className={styles.loadingSpinner} />
                  <p>Loading...</p>
                </div>
              )}

              {isFetching && data && (
                <div className={styles.searchingIndicator}>
                  <div className={styles.searchingSpinner} />
                  <span>Searching...</span>
                </div>
              )}

              {!isLoading && data != null && total === 0 && (
                <FeedEmptyState searchQuery={searchQuery} />
              )}

              {data != null && total > 0 && (
                <>
                  <div className={styles.grid}>
                    {podcasts.map((podcast) => (
                      <FeedPodcastCard
                        key={podcast.id}
                        podcast={podcast}
                        showLockIcon={true}
                      />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <FeedPagination
                      currentPage={page}
                      totalPages={totalPages}
                      onPageChange={(newPage) => {
                        setPage(newPage);
                        window.scrollTo(0, 0);
                      }}
                      totalItems={total}
                      itemsPerPage={FEED_PAGE_SIZE}
                      rangeStart={rangeStart}
                      rangeEnd={rangeEnd}
                    />
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

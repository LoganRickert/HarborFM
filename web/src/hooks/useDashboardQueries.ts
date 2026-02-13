import { useQuery } from '@tanstack/react-query';
import { listPodcasts, listPodcastsForUser, getActiveImport } from '../api/podcasts';
import { getUser } from '../api/users';
import { me } from '../api/auth';
import { getPublicConfig } from '../api/public';

const PODCASTS_PAGE_SIZE = 10;

interface UseDashboardQueriesParams {
  userId?: string;
  page: number;
  searchDebounced: string;
  sortNewestFirst: boolean;
}

export function useDashboardQueries({
  userId,
  page,
  searchDebounced,
  sortNewestFirst,
}: UseDashboardQueriesParams) {
  const isAdminView = Boolean(userId);
  const selectedUserQuery = useQuery({
    queryKey: ['user', userId],
    queryFn: () => getUser(userId!),
    enabled: !!userId,
  });

  // Podcasts list query
  const podcastsQuery = useQuery({
    queryKey: ['podcasts', userId, page, searchDebounced, sortNewestFirst ? 'newest' : 'oldest'],
    queryFn: () =>
      userId
        ? listPodcastsForUser(userId, {
            limit: PODCASTS_PAGE_SIZE,
            offset: (page - 1) * PODCASTS_PAGE_SIZE,
            q: searchDebounced || undefined,
            sort: sortNewestFirst ? 'newest' : 'oldest',
          })
        : listPodcasts({
            limit: PODCASTS_PAGE_SIZE,
            offset: (page - 1) * PODCASTS_PAGE_SIZE,
            q: searchDebounced || undefined,
            sort: sortNewestFirst ? 'newest' : 'oldest',
          }),
  });

  // Current user data query
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: me,
    enabled: !isAdminView,
  });

  // Public config query
  const publicConfigQuery = useQuery({
    queryKey: ['publicConfig', typeof window !== 'undefined' ? window.location.host : ''],
    queryFn: getPublicConfig,
    staleTime: 10_000,
  });

  // Active import query - only poll when there's an active import
  const activeImportQuery = useQuery({
    queryKey: ['activeImport'],
    queryFn: getActiveImport,
    enabled: !isAdminView,
    refetchInterval: (query) => {
      const data = query.state.data;
      const active = data?.status === 'pending' || data?.status === 'importing';
      return active ? 5000 : false;
    },
    refetchIntervalInBackground: false,
    gcTime: 0, // Immediately remove from cache when Dashboard unmounts
  });

  return {
    selectedUser: selectedUserQuery.data,
    podcasts: podcastsQuery.data?.podcasts ?? [],
    total: podcastsQuery.data?.total ?? 0,
    isLoading: podcastsQuery.isLoading,
    isFetching: podcastsQuery.isFetching,
    isError: podcastsQuery.isError,
    meData: meQuery.data,
    publicConfig: publicConfigQuery.data,
    activeImport: activeImportQuery.data,
    podcastsData: podcastsQuery.data,
  };
}

export { PODCASTS_PAGE_SIZE };

import { PublicPodcast, PublicEpisode } from '../api/public';

export interface FeedSearchControlsProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortNewestFirst: boolean;
  onSortToggle: (newest: boolean) => void;
  placeholder?: string;
}

export interface FeedEpisodePlayerProps {
  episode: PublicEpisode;
  podcastSlug: string;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
}

export interface FeedPodcastCardProps {
  podcast: PublicPodcast;
  showLockIcon: boolean;
}

export interface FeedEpisodeCardProps {
  episode: PublicEpisode;
  podcastSlug: string;
  isSubscriberOnly: boolean;
  showPlayer?: boolean;
  playingEpisodeId: string | null;
  onPlay: (episodeId: string) => void;
  onPause: () => void;
  /** When true (e.g. custom domain), link to /{episode.slug} instead of /feed/{podcastSlug}/{episode.slug} */
  useShortEpisodeUrls?: boolean;
}

export interface FeedPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
  itemsPerPage: number;
  rangeStart: number;
  rangeEnd: number;
}

export interface FeedPromoCardProps {
  onCreateClick: () => void;
}

export interface FeedEmptyStateProps {
  searchQuery: string;
}

export interface FeedPodcastHeaderProps {
  podcast: PublicPodcast;
  podcastSlug: string;
  onMessageClick: () => void;
  /** When set, a Share button (icon only) is shown. Embed option is hidden in ShareDialog. */
  shareUrl?: string;
  shareTitle?: string;
}

export interface FeedEpisodesListProps {
  episodes: PublicEpisode[];
  podcast: PublicPodcast;
  podcastSlug: string;
  playingEpisodeId: string | null;
  onPlay: (episodeId: string) => void;
  onPause: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  useShortEpisodeUrls?: boolean;
}

export interface FeedBreadcrumbsProps {
  podcast: PublicPodcast;
  episode: PublicEpisode;
  podcastSlug: string;
  /** When set (e.g. "/" for custom domain), breadcrumb link to feed uses this instead of /feed/{podcastSlug} */
  feedRootTo?: string;
}

export interface FeedEpisodeHeaderProps {
  episode: PublicEpisode;
  podcast: PublicPodcast;
  onMessageClick: () => void;
  onLockClick?: () => void;
  /** When set, a Share button is shown that opens ShareDialog with this URL and optional title/embedCode. */
  shareUrl?: string;
  shareTitle?: string;
  embedCode?: string;
}

export interface FeedSubscriberOnlyMessageProps {
  message?: string;
}

export interface FeedSearchState {
  query: string;
  debounced: string;
  sortNewestFirst: boolean;
}

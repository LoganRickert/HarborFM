import { Podcast } from '../api/podcasts';

// DashboardPodcast is the same as Podcast, but we keep this alias
// for clarity and future extensibility
export type DashboardPodcast = Podcast;

export interface DashboardHeaderProps {
  isAdminView: boolean;
  selectedUser?: { email: string } | null;
  total?: number;
  readOnly: boolean;
  atPodcastLimit: boolean;
}

export interface PodcastCardProps {
  podcast: DashboardPodcast;
  isAdminView: boolean;
  readOnly: boolean;
  publicFeedsEnabled: boolean;
  onEditClick: (podcastId: string) => void;
}

export interface DashboardSearchControlsProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortNewestFirst: boolean;
  onSortChange: (newest: boolean) => void;
}

export interface DashboardPaginationProps {
  rangeStart: number;
  rangeEnd: number;
  total: number;
  searchQuery: string;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export interface ImportPodcastCardProps {
  onImportClick: () => void;
}

export interface DashboardEmptyStateProps {
  isAdminView: boolean;
  readOnly: boolean;
  atPodcastLimit: boolean;
}

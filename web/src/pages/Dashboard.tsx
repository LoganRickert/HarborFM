import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { isReadOnly } from '../api/auth';
import { useAuthStore } from '../store/auth';
import { EditShowDetailsDialog } from './EditShowDetailsDialog';
import { ImportPodcastDialog } from './ImportPodcastDialog';
import { useSearchAndSort } from '../hooks/useSearchAndSort';
import { useDashboardQueries, PODCASTS_PAGE_SIZE } from '../hooks/useDashboardQueries';
import {
  DashboardHeader,
  DashboardSearchControls,
  PodcastCard,
  DashboardPagination,
  ImportPodcastCard,
  DashboardEmptyState,
} from '../components/Dashboard';
import { JoinCallDialog } from '../components/JoinCallDialog';
import { FailedToLoadCard } from '../components/FailedToLoadCard';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const { userId } = useParams<{ userId?: string }>();
  const [editingPodcastId, setEditingPodcastId] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [joinCallDialogOpen, setJoinCallDialogOpen] = useState(false);
  const [activeImportPodcastId, setActiveImportPodcastId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const userClosedImportDialogRef = useRef(false);
  const isAdminView = Boolean(userId);

  // Use custom hooks
  const { searchQuery, searchDebounced, setSearchQuery, sortNewestFirst, setSortNewestFirst } =
    useSearchAndSort();

  const {
    selectedUser,
    podcasts,
    total,
    isLoading,
    isFetching,
    isError,
    meData,
    publicConfig,
    activeImport,
    podcastsData,
  } = useDashboardQueries({
    userId,
    page,
    searchDebounced,
    sortNewestFirst,
  });

  // Handle active import dialog
  useEffect(() => {
    if (isAdminView) return;
    const status = activeImport?.status;
    if (
      (status === 'pending' || status === 'importing') &&
      activeImport?.podcast_id &&
      !userClosedImportDialogRef.current
    ) {
      setImportDialogOpen(true);
      setActiveImportPodcastId(activeImport.podcast_id);
    }
  }, [isAdminView, activeImport?.status, activeImport?.podcast_id]);

  // Computed values
  const publicFeedsEnabled = publicConfig?.public_feeds_enabled !== false;
  const maxPodcasts = meData?.user?.max_podcasts ?? null;
  const podcastCount = meData?.podcast_count ?? 0;
  const atPodcastLimit =
    !isAdminView && maxPodcasts != null && maxPodcasts > 0 && podcastCount >= maxPodcasts;
  const user = useAuthStore((s) => s.user);
  const readOnly = !isAdminView && isReadOnly(meData?.user ?? user);

  const totalPages = Math.max(1, Math.ceil(total / PODCASTS_PAGE_SIZE));
  const pageClamped = Math.max(1, Math.min(page, totalPages));
  const rangeStart = total === 0 ? 0 : (pageClamped - 1) * PODCASTS_PAGE_SIZE + 1;
  const rangeEnd = (pageClamped - 1) * PODCASTS_PAGE_SIZE + podcasts.length;
  const showImportCard = !isAdminView && !readOnly && !atPodcastLimit;

  // Scroll to top on page change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  // Reset search when query changes
  useEffect(() => {
    setPage(1);
  }, [searchDebounced]);

  // Clamp page when data changes
  useEffect(() => {
    if (podcastsData != null && total > 0) {
      setPage((p) => (p > totalPages ? Math.max(1, totalPages) : p));
    }
  }, [totalPages, podcastsData, total]);

  return (
    <div className={styles.dashboard}>
      <DashboardHeader
        isAdminView={isAdminView}
        selectedUser={selectedUser}
        total={total}
        readOnly={readOnly}
        atPodcastLimit={atPodcastLimit}
        webrtcEnabled={publicConfig?.webrtc_enabled}
        onJoinCallClick={() => setJoinCallDialogOpen(true)}
      />

      {isError && <FailedToLoadCard title="Failed to load podcasts" />}

      {!isError && (
        <DashboardSearchControls
          searchQuery={searchQuery}
          onSearchChange={(query) => {
            setSearchQuery(query);
            setPage(1);
          }}
          sortNewestFirst={sortNewestFirst}
          onSortChange={(newest) => {
            setSortNewestFirst(newest);
            setPage(1);
          }}
        />
      )}

      {isLoading && !podcastsData && (
        <div className={styles.loading}>
          <div className={styles.loadingSpinner}></div>
          <p>Loading...</p>
        </div>
      )}

      {isFetching && podcastsData && (
        <div className={styles.searchingIndicator}>
          <div className={styles.searchingSpinner} />
          <span>Searching...</span>
        </div>
      )}

      {!isLoading && !isError && podcasts.length === 0 && searchQuery.trim() && (
        <div className={styles.noMatch}>
          <p className={styles.noMatchText}>No shows match your search.</p>
        </div>
      )}

      {!isLoading && !isError && podcasts.length === 0 && !searchQuery.trim() && (
        <DashboardEmptyState
          isAdminView={isAdminView}
          readOnly={readOnly}
          atPodcastLimit={atPodcastLimit}
        />
      )}

      {!isLoading && !isError && (podcasts.length > 0 || showImportCard) && (
        <>
          <div className={styles.grid}>
            {podcasts.map((p) => (
              <PodcastCard
                key={p.id}
                podcast={p}
                isAdminView={isAdminView}
                readOnly={readOnly}
                publicFeedsEnabled={publicFeedsEnabled}
                onEditClick={setEditingPodcastId}
              />
            ))}
          </div>
          <DashboardPagination
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={total}
            searchQuery={searchQuery}
            page={pageClamped}
            totalPages={totalPages}
            onPageChange={setPage}
          />
          {showImportCard && <ImportPodcastCard onImportClick={() => setImportDialogOpen(true)} />}
        </>
      )}

      {editingPodcastId != null && (
        <EditShowDetailsDialog
          open
          podcastId={editingPodcastId}
          onClose={() => setEditingPodcastId(null)}
        />
      )}

      <ImportPodcastDialog
        open={importDialogOpen}
        initialPodcastId={activeImportPodcastId}
        onClose={() => {
          setImportDialogOpen(false);
          setActiveImportPodcastId(null);
          userClosedImportDialogRef.current = true;
        }}
      />

      <JoinCallDialog
        open={joinCallDialogOpen}
        onOpenChange={setJoinCallDialogOpen}
      />
    </div>
  );
}

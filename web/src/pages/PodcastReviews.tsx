import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, CheckCircle, Trash2, X } from 'lucide-react';
import { getPodcast } from '../api/podcasts';
import { listPodcastReviews, approveReview, deletePodcastReview, type AdminReviewDto } from '../api/reviews';
import { formatDateTime } from '../utils/format';
import { FullPageLoading } from '../components/Loading';
import { FailedToLoadCard } from '../components/FailedToLoadCard';
import { Breadcrumb } from '../components/Breadcrumb';
import { ReviewStars } from '../components/Feed';
import styles from './PodcastReviews.module.css';

const LIMIT = 10;
const SEARCH_DEBOUNCE_MS = 300;

export function PodcastReviews() {
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');

  useEffect(() => {
    if (search === '') {
      setSearchDebounced('');
      setPage(1);
      return;
    }
    const t = window.setTimeout(() => {
      setSearchDebounced(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const { data: podcast, isLoading: podcastLoading } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['podcast-reviews', id, page, searchDebounced, sort],
    queryFn: () =>
      listPodcastReviews(id!, {
        page,
        limit: LIMIT,
        q: searchDebounced || undefined,
        sort,
      }),
    enabled: !!id,
    refetchOnMount: 'always',
  });

  const approveMutation = useMutation({
    mutationFn: ({ reviewId }: { reviewId: string }) => approveReview(id!, reviewId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast-reviews', id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ reviewId }: { reviewId: string }) => deletePodcastReview(id!, reviewId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast-reviews', id] });
      setReviewIdToDelete(null);
    },
  });

  const [reviewIdToDelete, setReviewIdToDelete] = useState<string | null>(null);

  function handleDeleteConfirm() {
    if (reviewIdToDelete) deleteMutation.mutate({ reviewId: reviewIdToDelete });
  }

  if (!id) return null;
  if (podcastLoading) return <FullPageLoading />;
  if (!podcast) return <FailedToLoadCard title="Podcast not found" />;

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: podcast.title, href: `/podcasts/${id}`, mobileLabel: 'Show' },
    { label: 'Reviews' },
  ];

  const reviews = data?.reviews ?? [];
  const pagination = data?.pagination;

  function setSortNewest() {
    setSort('newest');
    setPage(1);
  }
  function setSortOldest() {
    setSort('oldest');
    setPage(1);
  }

  return (
    <div className={styles.wrap}>
      <Breadcrumb items={breadcrumbItems} />
      <div className={styles.head}>
        <h1 className={styles.title}>Reviews</h1>
      </div>
      <div className={styles.bar}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search by name, email, or review..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search reviews"
        />
        <div className={styles.sortToggle} role="group" aria-label="Sort order">
          <button
            type="button"
            className={sort === 'newest' ? styles.sortBtnActive : styles.sortBtn}
            onClick={setSortNewest}
            aria-label="Sort newest first"
          >
            <ArrowDown size={16} strokeWidth={2} aria-hidden />
            Newest
          </button>
          <button
            type="button"
            className={sort === 'oldest' ? styles.sortBtnActive : styles.sortBtn}
            onClick={setSortOldest}
            aria-label="Sort oldest first"
          >
            <ArrowUp size={16} strokeWidth={2} aria-hidden />
            Oldest
          </button>
        </div>
      </div>
      {isLoading && <p className={styles.muted}>Loading reviews...</p>}
      {isError && <FailedToLoadCard title="Failed to load reviews" />}
      {!isLoading && !isError && (
        <>
          {reviews.length === 0 ? (
            <div className={styles.emptyCard}>
              <p className={styles.emptyCardText}>No reviews yet.</p>
            </div>
          ) : (
            <ReviewsList
              reviews={reviews}
              onApprove={(reviewId) => approveMutation.mutate({ reviewId })}
              isApproving={(reviewId) => approveMutation.isPending && approveMutation.variables?.reviewId === reviewId}
              onDeleteClick={(reviewId) => setReviewIdToDelete(reviewId)}
              isDeleting={(reviewId) => deleteMutation.isPending && deleteMutation.variables?.reviewId === reviewId}
            />
          )}
          {reviewIdToDelete !== null && (
            <Dialog.Root open onOpenChange={(open) => !open && setReviewIdToDelete(null)}>
              <Dialog.Portal>
                <Dialog.Overlay className={styles.confirmOverlay} />
                <Dialog.Content className={styles.confirmContent}>
                  <div className={styles.confirmHeader}>
                    <Dialog.Title className={styles.confirmTitle}>Delete review?</Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" className={styles.confirmClose} aria-label="Close">
                        <X size={18} strokeWidth={2} aria-hidden />
                      </button>
                    </Dialog.Close>
                  </div>
                  <Dialog.Description className={styles.confirmDescription}>
                    This will hide the review from the public feed and from this list. This cannot be undone.
                  </Dialog.Description>
                  <div className={styles.confirmActions}>
                    <Dialog.Close asChild>
                      <button type="button" className={styles.confirmCancel} aria-label="Cancel">
                        Cancel
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      className={styles.confirmDelete}
                      onClick={handleDeleteConfirm}
                      disabled={deleteMutation.isPending}
                      aria-label="Confirm delete review"
                    >
                      {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          )}
          {pagination && (
            <p className={styles.subtitleRight}>
              Showing {reviews.length} of {pagination.total} reviews
              {searchDebounced && ` matching "${searchDebounced}"`}
            </p>
          )}
          {pagination && pagination.totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Previous page"
              >
                Previous
              </button>
              <span className={styles.pageInfo}>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                aria-label="Next page"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewsList({
  reviews,
  onApprove,
  isApproving,
  onDeleteClick,
  isDeleting,
}: {
  reviews: AdminReviewDto[];
  onApprove: (reviewId: string) => void;
  isApproving: (reviewId: string) => boolean;
  onDeleteClick: (reviewId: string) => void;
  isDeleting: (reviewId: string) => boolean;
}) {
  const BODY_SNIPPET_LEN = 120;
  return (
    <ul className={styles.list}>
      {reviews.map((r) => (
        <li key={r.id} className={styles.reviewCard}>
          <div className={styles.reviewNameRow}>
            <span className={styles.reviewName} title={r.name}>
              {r.name}
            </span>
            <span className={styles.reviewStars}>
              <ReviewStars rating={r.rating} size={16} />
            </span>
          </div>
          <div className={styles.reviewMeta}>
            <time dateTime={r.createdAt} className={styles.reviewDate}>
              {formatDateTime(r.createdAt)}
            </time>
            {r.verified ? (
              <span className={styles.verifiedBadge} title="Verified reviewer">
                Verified
              </span>
            ) : (
              <span className={styles.reviewNotVerified}>Not verified</span>
            )}
            {r.spam && (
              <span className={styles.spamBadge} title="Flagged as spam by system">
                Spam
              </span>
            )}
          </div>
          <p className={styles.reviewEmail}>
            <a href={`mailto:${r.email}`} className={styles.emailLink}>
              {r.email}
            </a>
          </p>
          {r.episodeTitle && (
            <p className={styles.reviewContext}>Episode: {r.episodeTitle}</p>
          )}
          <p className={styles.reviewBody}>
            {r.body.length > BODY_SNIPPET_LEN ? `${r.body.slice(0, BODY_SNIPPET_LEN)}…` : r.body}
          </p>
          <div className={styles.reviewActions}>
            <div className={styles.reviewActionsLeft}>
              {!r.approved ? (
                <button
                  type="button"
                  className={styles.approveBtn}
                  onClick={() => onApprove(r.id)}
                  disabled={isApproving(r.id)}
                  aria-label="Approve review"
                >
                  <CheckCircle size={16} strokeWidth={2} aria-hidden />
                  {isApproving(r.id) ? 'Approving…' : 'Approve'}
                </button>
              ) : (
                <span className={styles.approvedLabel}>
                  <CheckCircle size={16} strokeWidth={2} aria-hidden />
                  Approved
                </span>
              )}
            </div>
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={() => onDeleteClick(r.id)}
              disabled={isDeleting(r.id)}
              aria-label="Delete review"
            >
              <Trash2 size={16} strokeWidth={2} aria-hidden />
              {isDeleting(r.id) ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

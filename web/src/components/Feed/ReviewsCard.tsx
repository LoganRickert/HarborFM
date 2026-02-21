import { useState, useRef, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { MessageSquare, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPublicReviews, deleteReview, type PublicReviewDto } from '../../api/reviews';
import { formatDateTime } from '../../utils/format';
import { ReviewStars } from './ReviewStars';
import { ReviewSubmitModal } from './ReviewSubmitModal';
import styles from './ReviewsCard.module.css';

export interface ReviewsCardProps {
  podcastSlug: string;
  episodeSlug?: string;
  /** When false, do not render (reviews disabled). */
  enabled?: boolean;
  /** When false, hide the "Write a review" button (e.g. when only subscribers can review and user is not a subscriber). Default true. */
  showWriteButton?: boolean;
}

export function ReviewsCard({ podcastSlug, episodeSlug, enabled = true, showWriteButton = true }: ReviewsCardProps) {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [reviewIdToDelete, setReviewIdToDelete] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['public-reviews', podcastSlug, episodeSlug],
    queryFn: () => getPublicReviews(podcastSlug, { episodeSlug, limit: 10, offset: 0 }),
    enabled: enabled && !!podcastSlug,
    staleTime: 60 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: (reviewId: string) => deleteReview(reviewId),
    onSuccess: () => {
      setReviewIdToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['public-reviews', podcastSlug, episodeSlug] });
    },
  });

  function handleDeleteClick(reviewId: string) {
    setReviewIdToDelete(reviewId);
  }

  function handleDeleteConfirm() {
    if (reviewIdToDelete) {
      deleteMutation.mutate(reviewIdToDelete);
    }
  }

  const reviews = data?.reviews ?? [];

  if (!enabled) return null;

  return (
    <section className={styles.card} aria-labelledby="reviews-card-title">
      <div className={styles.header}>
        <h2 id="reviews-card-title" className={styles.title}>
          Reviews
        </h2>
        {showWriteButton && (
          <button
            type="button"
            className={styles.writeBtn}
            onClick={() => setModalOpen(true)}
            aria-label="Write a review"
          >
            <MessageSquare size={16} strokeWidth={2} aria-hidden />
            Write A Review
          </button>
        )}
      </div>
      {isLoading ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>Loading reviews…</p>
      ) : reviews.length > 0 ? (
        <ul className={styles.list}>
          {reviews.map((r) => (
            <ReviewItem
              key={r.id}
              review={r}
              onDelete={r.canDelete ? () => handleDeleteClick(r.id) : undefined}
              isDeleting={deleteMutation.isPending && deleteMutation.variables === r.id}
            />
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
          No reviews yet. Be the first to leave one.
        </p>
      )}
      <ReviewSubmitModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        podcastSlug={podcastSlug}
        episodeSlug={episodeSlug}
      />

      <Dialog.Root open={reviewIdToDelete !== null} onOpenChange={(open) => !open && setReviewIdToDelete(null)}>
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
              This will hide your review. This cannot be undone.
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
    </section>
  );
}

interface ReviewItemProps {
  review: PublicReviewDto;
  onDelete?: () => void;
  isDeleting?: boolean;
}

function ReviewItem({ review: r, onDelete, isDeleting }: ReviewItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const body = r.body.trim();

  useEffect(() => {
    if (expanded || !body) return;
    const check = () => {
      if (!bodyRef.current) return;
      const truncated = bodyRef.current.scrollHeight > bodyRef.current.clientHeight;
      setHasOverflow(truncated);
    };
    check();
    const t = requestAnimationFrame(() => requestAnimationFrame(check));
    return () => cancelAnimationFrame(t);
  }, [expanded, body]);

  const likelyOverflows = body.length > 200;
  const showAsOverflow = hasOverflow || (likelyOverflows && !expanded);
  const showToggle = showAsOverflow || expanded;

  return (
    <li className={styles.reviewItem}>
      <div className={styles.reviewNameRow}>
        <span className={styles.reviewName} title={r.name}>
          {r.name}
        </span>
        <span className={styles.reviewStars}>
          <ReviewStars rating={r.rating} size={16} />
        </span>
      </div>
      <div className={styles.reviewMeta}>
        <time className={styles.reviewDate} dateTime={r.createdAt}>
          {formatDateTime(r.createdAt)}
        </time>
        {r.verified ? (
          <span className={styles.reviewVerified} title="Verified reviewer">
            Verified
          </span>
        ) : (
          <span className={styles.reviewNotVerified}>Not verified</span>
        )}
      </div>
      <div>
        <p
          ref={bodyRef}
          className={
            expanded ? styles.reviewBody : `${styles.reviewBody} ${styles.reviewBodyClamped}`
          }
        >
          {body}
        </p>
        {showToggle && (
          <div className={styles.viewMoreWrap}>
            <button
              type="button"
              className={styles.viewMoreBtn}
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          </div>
        )}
      </div>
      {onDelete && (
        <div className={styles.reviewActions}>
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={onDelete}
            disabled={isDeleting}
            aria-label="Delete review"
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </li>
  );
}

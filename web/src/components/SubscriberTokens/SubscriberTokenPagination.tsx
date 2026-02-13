import localStyles from './SubscriberTokens.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface SubscriberTokenPaginationProps {
  page: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  totalTokens: number;
  onPageChange: (page: number) => void;
  /** Label for the item (e.g. "token" -> "tokens", "key" -> "keys"). Default "token". */
  itemLabel?: string;
}

export function SubscriberTokenPagination({
  page,
  totalPages,
  rangeStart,
  rangeEnd,
  totalTokens,
  onPageChange,
  itemLabel = 'token',
}: SubscriberTokenPaginationProps) {
  if (totalPages <= 1) return null;

  const label = totalTokens === 1 ? itemLabel : `${itemLabel}s`;

  return (
    <div className={styles.tokenPaginationWrap}>
      <p className={styles.tokenPaginationMeta}>
        Showing {rangeStart}–{rangeEnd} of {totalTokens} {label}
      </p>
      <div className={styles.tokenPagination}>
        <button
          type="button"
          className={styles.tokenPageBtn}
          onClick={() => {
            const prevPage = Math.max(1, page - 1);
            if (prevPage !== page) {
              onPageChange(prevPage);
            }
          }}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          Previous
        </button>
        <span className={styles.tokenPageInfo}>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className={styles.tokenPageBtn}
          onClick={() => {
            const nextPage = Math.min(totalPages, page + 1);
            if (nextPage !== page) {
              onPageChange(nextPage);
            }
          }}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}

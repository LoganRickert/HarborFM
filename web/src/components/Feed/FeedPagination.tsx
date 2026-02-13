import { FeedPaginationProps } from '../../types/feed';
import styles from './FeedPagination.module.css';

export function FeedPagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  rangeStart,
  rangeEnd,
}: FeedPaginationProps) {
  return (
    <div className={styles.pagination}>
      <p className={styles.meta}>
        Showing {rangeStart}–{rangeEnd} of {totalItems}
      </p>
      <div className={styles.controls}>
        <button
          className={styles.button}
          onClick={() => {
            const prevPage = Math.max(1, currentPage - 1);
            if (prevPage !== currentPage) {
              onPageChange(prevPage);
            }
          }}
          disabled={currentPage === 1}
          aria-label="Previous page"
        >
          Previous
        </button>
        <span className={styles.pageInfo}>
          Page {currentPage} of {totalPages}
        </span>
        <button
          className={styles.button}
          onClick={() => {
            const nextPage = Math.min(totalPages, currentPage + 1);
            if (nextPage !== currentPage) {
              onPageChange(nextPage);
            }
          }}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}

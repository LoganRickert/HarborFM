import { DashboardPaginationProps } from '../../types/dashboard';
import styles from './DashboardPagination.module.css';

export function DashboardPagination({
  rangeStart,
  rangeEnd,
  total,
  searchQuery,
  page,
  totalPages,
  onPageChange,
}: DashboardPaginationProps) {
  if (total === 0) return null;

  return (
    <div className={styles.paginationWrap}>
      <p className={styles.paginationMeta}>
        Showing {rangeStart}–{rangeEnd} of {total} shows
        {searchQuery.trim() && ` matching "${searchQuery.trim()}"`}
      </p>
      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            Previous
          </button>
          <span className={styles.pageInfo}>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

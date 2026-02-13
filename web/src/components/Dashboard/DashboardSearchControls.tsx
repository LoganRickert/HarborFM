import { Search, ArrowDown, ArrowUp } from 'lucide-react';
import { DashboardSearchControlsProps } from '../../types/dashboard';
import styles from './DashboardSearchControls.module.css';

export function DashboardSearchControls({
  searchQuery,
  onSearchChange,
  sortNewestFirst,
  onSortChange,
}: DashboardSearchControlsProps) {
  return (
    <div className={styles.controls}>
      <div className={styles.searchWrapper}>
        <Search className={styles.searchIcon} size={18} strokeWidth={2} aria-hidden />
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search by title, author, or description..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search podcasts"
        />
      </div>
      <div className={styles.sortToggle} role="group" aria-label="Sort order">
        <button
          type="button"
          className={sortNewestFirst ? styles.sortBtnActive : styles.sortBtn}
          aria-label="Sort newest first"
          onClick={() => onSortChange(true)}
        >
          <ArrowDown size={16} strokeWidth={2} aria-hidden />
          Newest
        </button>
        <button
          type="button"
          className={!sortNewestFirst ? styles.sortBtnActive : styles.sortBtn}
          aria-label="Sort oldest first"
          onClick={() => onSortChange(false)}
        >
          <ArrowUp size={16} strokeWidth={2} aria-hidden />
          Oldest
        </button>
      </div>
    </div>
  );
}

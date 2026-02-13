import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { FeedSearchControlsProps } from '../../types/feed';
import styles from './FeedSearchControls.module.css';

export function FeedSearchControls({
  searchQuery,
  onSearchChange,
  sortNewestFirst,
  onSortToggle,
  placeholder = 'Search...',
}: FeedSearchControlsProps) {
  return (
    <div className={styles.controls}>
      <div className={styles.searchWrap}>
        <Search size={18} className={styles.searchIcon} aria-hidden />
        <input
          type="search"
          placeholder={placeholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className={styles.searchInput}
          aria-label={placeholder}
        />
      </div>
      <div className={styles.sortToggle}>
        <button
          type="button"
          className={sortNewestFirst ? styles.sortBtnActive : styles.sortBtn}
          onClick={() => onSortToggle(true)}
          aria-label="Sort by newest"
          aria-pressed={sortNewestFirst}
        >
          <ArrowDown size={14} strokeWidth={2.5} aria-hidden />
          Newest
        </button>
        <button
          type="button"
          className={!sortNewestFirst ? styles.sortBtnActive : styles.sortBtn}
          onClick={() => onSortToggle(false)}
          aria-label="Sort by oldest"
          aria-pressed={!sortNewestFirst}
        >
          <ArrowUp size={14} strokeWidth={2.5} aria-hidden />
          Oldest
        </button>
      </div>
    </div>
  );
}

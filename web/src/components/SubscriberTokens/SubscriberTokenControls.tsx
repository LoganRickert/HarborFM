import { Search, ArrowDown, ArrowUp } from 'lucide-react';
import localStyles from './SubscriberTokens.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface SubscriberTokenControlsProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortNewestFirst: boolean;
  onSortChange: (newestFirst: boolean) => void;
  totalCount: number;
}

export function SubscriberTokenControls({
  searchQuery,
  onSearchChange,
  sortNewestFirst,
  onSortChange,
  totalCount,
}: SubscriberTokenControlsProps) {
  if (totalCount === 0) return null;

  return (
    <div className={styles.tokenControls}>
      <div className={styles.tokenSearchWrapper}>
        <Search className={styles.tokenSearchIcon} size={18} strokeWidth={2} aria-hidden />
        <input
          type="search"
          className={styles.tokenSearchInput}
          placeholder="Search by name..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search tokens"
        />
      </div>
      <div className={styles.tokenSortToggle} role="group" aria-label="Sort order">
        <button
          type="button"
          className={sortNewestFirst ? styles.tokenSortBtnActive : styles.tokenSortBtn}
          aria-label="Sort newest first"
          onClick={() => onSortChange(true)}
        >
          <ArrowDown size={16} strokeWidth={2} aria-hidden />
          Newest
        </button>
        <button
          type="button"
          className={!sortNewestFirst ? styles.tokenSortBtnActive : styles.tokenSortBtn}
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

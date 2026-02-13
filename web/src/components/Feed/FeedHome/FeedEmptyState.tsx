import { FeedEmptyStateProps } from '../../../types/feed';
import styles from './FeedEmptyState.module.css';

export function FeedEmptyState({ searchQuery }: FeedEmptyStateProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyText}>
        {searchQuery
          ? 'No podcasts match your search. Try a different search term.'
          : 'No podcasts available yet. Check back soon!'}
      </p>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { Plus, Radio } from 'lucide-react';
import { DashboardEmptyStateProps } from '../../types/dashboard';
import styles from './DashboardEmptyState.module.css';

export function DashboardEmptyState({
  isAdminView,
  readOnly,
  atPodcastLimit,
}: DashboardEmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>
        <Radio size={40} strokeWidth={1.5} />
      </div>
      <h2 className={styles.emptyTitle}>No podcasts yet</h2>
      <p className={styles.emptyMessage}>
        Create your first show to get started publishing episodes.
      </p>
      {!isAdminView && (
        readOnly ? (
          <span className={`${styles.emptyBtn} ${styles.emptyBtnDisabled}`} title="Read-only account">
            <Plus size={18} strokeWidth={2.5} />
            Create Your First Show
          </span>
        ) : atPodcastLimit ? (
          <span
            className={`${styles.emptyBtn} ${styles.emptyBtnDisabled}`}
            title="You're at max shows"
          >
            <Plus size={18} strokeWidth={2.5} />
            Create Your First Show
          </span>
        ) : (
          <Link to="/podcasts/new" className={styles.emptyBtn}>
            <Plus size={18} strokeWidth={2.5} />
            Create Your First Show
          </Link>
        )
      )}
    </div>
  );
}

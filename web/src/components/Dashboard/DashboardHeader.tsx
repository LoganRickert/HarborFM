import { Link } from 'react-router-dom';
import { Plus, Phone } from 'lucide-react';
import { DashboardHeaderProps } from '../../types/dashboard';
import styles from './DashboardHeader.module.css';

export function DashboardHeader({
  isAdminView,
  selectedUser,
  total,
  readOnly,
  atPodcastLimit,
  webrtcEnabled,
  onJoinCallClick,
}: DashboardHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <h1 className={styles.title}>
          {isAdminView ? `Podcasts (${selectedUser?.email ?? 'Loading...'})` : 'Your shows'}
        </h1>
        <p className={styles.subtitle}>
          {total != null
            ? total > 0
              ? `${total} show${total === 1 ? '' : 's'} · Manage and publish episodes`
              : 'Manage your shows and publish episodes'
            : 'Manage your shows and publish episodes'}
        </p>
      </div>
      {!isAdminView && (
        <div className={styles.headerActions}>
          {webrtcEnabled && (
            <button
              type="button"
              className={styles.joinCallBtn}
              onClick={onJoinCallClick}
              aria-label="Join call"
              title="Join call with 4-digit code"
            >
              <Phone size={18} strokeWidth={2.5} />
              Join Call
            </button>
          )}
          {readOnly ? (
            <span className={`${styles.createBtn} ${styles.createBtnDisabled}`} title="Read-only account">
              <Plus size={18} strokeWidth={2.5} />
              New Show
            </span>
          ) : atPodcastLimit ? (
            <span
              className={`${styles.createBtn} ${styles.createBtnDisabled}`}
              title="You're at max shows"
            >
              <Plus size={18} strokeWidth={2.5} />
              New Show
            </span>
          ) : (
            <Link to="/podcasts/new" className={styles.createBtn}>
              <Plus size={18} strokeWidth={2.5} />
              New Show
            </Link>
          )}
        </div>
      )}
    </header>
  );
}

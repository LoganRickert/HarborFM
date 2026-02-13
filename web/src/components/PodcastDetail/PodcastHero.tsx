import { Link } from 'react-router-dom';
import { BarChart3, List, Settings as GearIcon, Lock } from 'lucide-react';
import localStyles from './PodcastDetail.module.css';
import sharedStyles from './shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface PodcastHeroProps {
  podcast: {
    id: string;
    title: string;
    description?: string | null;
    artwork_url?: string | null;
    artwork_filename?: string | null;
    subscriber_only_feed_enabled?: number;
    public_feed_disabled?: number;
  };
  readOnly: boolean;
  canManageShow: boolean;
  onEditClick: () => void;
  /** When true, center the podcast title (e.g. on the podcast detail page). */
  centerTitle?: boolean;
}

export function PodcastHero({ podcast, readOnly, canManageShow, onEditClick, centerTitle }: PodcastHeroProps) {
  return (
    <div className={styles.podcastHero}>
      {(podcast.artwork_url || podcast.artwork_filename) && (
        <img
          src={podcast.artwork_url ?? (podcast.artwork_filename ? `/api/podcasts/${podcast.id}/artwork/${encodeURIComponent(podcast.artwork_filename)}` : '')}
          alt=""
          className={styles.podcastHeroArtwork}
        />
      )}
      <div className={styles.podcastHeroMain}>
        <div className={centerTitle ? `${styles.podcastHeroTitleRow} ${styles.podcastHeroTitleRowCentered}` : styles.podcastHeroTitleRow}>
          {podcast.subscriber_only_feed_enabled === 1 && (
            <Lock
              size={22}
              strokeWidth={2}
              className={
                podcast.public_feed_disabled === 1
                  ? `${styles.podcastHeroTitleLock} ${styles.podcastHeroTitleLockGold}`
                  : styles.podcastHeroTitleLock
              }
              aria-hidden
            />
          )}
          <h1 className={styles.cardTitle}>{podcast.title}</h1>
        </div>
        {podcast.description && (
          <p className={styles.podcastHeroDescription}>{podcast.description}</p>
        )}
        <div className={styles.cardHeaderActions}>
          <Link to={`/podcasts/${podcast.id}/analytics`} className={styles.cardHeaderSecondary}>
            <BarChart3 size={16} strokeWidth={2} aria-hidden />
            Analytics
          </Link>
          <Link to={`/podcasts/${podcast.id}/episodes`} className={styles.cardHeaderPrimary}>
            <List size={16} strokeWidth={2} aria-hidden />
            Episodes
          </Link>
          {!readOnly && canManageShow && (
            <button
              type="button"
              className={styles.cardSettings}
              onClick={onEditClick}
              aria-label={`Edit details for ${podcast.title}`}
            >
              <GearIcon size={18} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

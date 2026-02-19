import { Link } from 'react-router-dom';
import { BarChart3, List, Link2, Settings as GearIcon, Lock, Rss } from 'lucide-react';
import { getPublicRssUrl } from '../../api/rss';
import localStyles from './PodcastDetail.module.css';
import sharedStyles from './shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface PodcastHeroProps {
  podcast: {
    id: string;
    title: string;
    slug: string;
    description?: string | null;
    artworkUrl?: string | null;
    artworkFilename?: string | null;
    subscriberOnlyFeedEnabled?: boolean;
    publicFeedDisabled?: boolean;
  };
  readOnly: boolean;
  canManageShow: boolean;
  onEditClick: () => void;
  /** Opens the Edit Social Links dialog. */
  onLinksClick?: () => void;
  /** When true, center the podcast title (e.g. on the podcast detail page). */
  centerTitle?: boolean;
  /** When set, show Public Page / Public RSS buttons at bottom left. */
  publicFeedsEnabled?: boolean;
}

export function PodcastHero({ podcast, readOnly, canManageShow, onEditClick, onLinksClick, centerTitle, publicFeedsEnabled }: PodcastHeroProps) {
  const showFeedButtons = publicFeedsEnabled !== undefined;

  return (
    <div className={styles.podcastHero}>
      {(podcast.artworkUrl || podcast.artworkFilename) && (
        <img
          src={podcast.artworkUrl ?? (podcast.artworkFilename ? `/api/podcasts/${podcast.id}/artwork/${encodeURIComponent(podcast.artworkFilename)}` : '')}
          alt=""
          className={styles.podcastHeroArtwork}
        />
      )}
      <div className={styles.podcastHeroMain}>
        <div className={centerTitle ? `${styles.podcastHeroTitleRow} ${styles.podcastHeroTitleRowCentered}` : styles.podcastHeroTitleRow}>
          {podcast.subscriberOnlyFeedEnabled && (
            <Lock
              size={22}
              strokeWidth={2}
              className={
                podcast.publicFeedDisabled
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
        {showFeedButtons && (
          <div className={styles.podcastHeroFeedRow}>
            <div className={styles.podcastDetailsActions}>
              {publicFeedsEnabled && (
                <Link to={`/feed/${podcast.slug}`} className={styles.podcastDetailsActionLink}>
                  <Rss size={16} strokeWidth={2} aria-hidden />
                  Public Page
                </Link>
              )}
              <a
                href={getPublicRssUrl(podcast.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.podcastDetailsActionLink}
              >
                <Rss size={16} strokeWidth={2} aria-hidden />
                Public RSS
              </a>
            </div>
          </div>
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
            <>
              <button
                type="button"
                className={styles.cardSettings}
                onClick={onEditClick}
                aria-label={`Edit details for ${podcast.title}`}
              >
                <GearIcon size={18} strokeWidth={2} />
              </button>
              {onLinksClick && (
                <button
                  type="button"
                  className={styles.cardSettings}
                  onClick={onLinksClick}
                  aria-label={`Edit links for ${podcast.title}`}
                  title="Edit links"
                >
                  <Link2 size={18} strokeWidth={2} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

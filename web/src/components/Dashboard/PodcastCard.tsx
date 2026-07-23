import { Link } from 'react-router-dom';
import { Settings, List, Mic2, Radio, Rss, ArrowUpRight, Lock } from 'lucide-react';
import { getPublicRssUrl } from '../../api/rss';
import { canManageShow } from '../../utils/podcastPermissions';
import { PodcastCardProps } from '../../types/dashboard';
import styles from './PodcastCard.module.css';

export function PodcastCard({
  podcast,
  isAdminView,
  readOnly,
  publicFeedsEnabled,
  onEditClick,
}: PodcastCardProps) {
  const myRole = podcast.myRole;
  const canManage = canManageShow(readOnly, myRole);
  const maxEp = podcast.maxEpisodes ?? null;
  const epCount = Number(podcast.episodeCount ?? 0);
  const atEpisodeLimit = maxEp != null && maxEp > 0 && epCount >= Number(maxEp);

  return (
    <article
      key={podcast.id}
      className={
        podcast.publicFeedDisabled
          ? `${styles.card} ${styles.cardSubscriberOnly}`
          : styles.card
      }
    >
      <Link to={`/podcasts/${podcast.id}`} className={styles.cardLink}>
        <div className={styles.cardArtworkWrapper}>
          {podcast.artworkUrl || podcast.artworkFilename ? (
            <img
              src={
                podcast.artworkUrl ??
                (podcast.artworkFilename
                  ? `/api/podcasts/${podcast.id}/artwork/${encodeURIComponent(
                      podcast.artworkFilename
                    )}`
                  : '')
              }
              alt={podcast.title}
              className={styles.cardArtwork}
            />
          ) : (
            <div className={styles.cardArtworkPlaceholder}>
              <Radio size={32} strokeWidth={1.5} aria-hidden />
            </div>
          )}
        </div>
        <div className={styles.cardBody}>
          <div className={styles.cardTitleRow}>
            {!!podcast.subscriberOnlyFeedEnabled && (
              <Lock
                size={18}
                strokeWidth={2}
                className={
                  podcast.publicFeedDisabled
                    ? `${styles.cardTitleLock} ${styles.cardTitleLockGold}`
                    : styles.cardTitleLock
                }
                aria-hidden
              />
            )}
            <h2 className={styles.cardTitle}>{podcast.title}</h2>
          </div>
          <p className={styles.cardSlug}>
            {podcast.slug}
            {podcast.isShared && (
              <span className={styles.sharedBadge} title="Shared with you">
                Shared
              </span>
            )}
          </p>
          {podcast.description && (
            <p className={styles.cardDesc}>
              {podcast.description.slice(0, 120)}
              {podcast.description.length > 120 ? '...' : ''}
            </p>
          )}
        </div>
        <span className={styles.cardArrow}>
          <ArrowUpRight size={18} strokeWidth={2} aria-hidden="true" />
        </span>
      </Link>
      <div className={styles.cardFooter}>
        <div className={styles.cardActions}>
          {publicFeedsEnabled ? (
            podcast.canonicalFeedUrl?.trim() ? (
              <a
                href={podcast.canonicalFeedUrl.trim()}
                className={styles.cardAction}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Public page for ${podcast.title}`}
              >
                <Rss size={16} strokeWidth={2} aria-hidden />
                <span className={styles.cardActionLabel}>Feed</span>
              </a>
            ) : (
              <Link
                to={`/feed/${podcast.slug}`}
                className={styles.cardAction}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Public page for ${podcast.title}`}
              >
                <Rss size={16} strokeWidth={2} aria-hidden />
                <span className={styles.cardActionLabel}>Feed</span>
              </Link>
            )
          ) : (
            <a
              href={getPublicRssUrl(podcast.slug)}
              className={styles.cardAction}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`RSS feed XML for ${podcast.title}`}
            >
              <Rss size={16} strokeWidth={2} aria-hidden />
              <span className={styles.cardActionLabel}>Feed</span>
            </a>
          )}
          {!isAdminView && (
            <>
              {!canManage ? (
                <span
                  className={`${styles.cardAction} ${styles.cardActionDisabled}`}
                  title={
                    myRole && myRole !== 'owner' && myRole !== 'manager'
                      ? 'Only managers and the owner can edit show settings'
                      : 'Read-only account'
                  }
                >
                  <Settings size={16} strokeWidth={2} aria-hidden />
                  <span className={styles.cardActionLabel}>Settings</span>
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.cardSettings}
                  aria-label={`Edit show settings for ${podcast.title}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onEditClick(podcast.id);
                  }}
                >
                  <Settings size={16} strokeWidth={2} aria-hidden />
                  <span className={styles.cardActionLabel}>Settings</span>
                </button>
              )}
            </>
          )}
          <Link
            to={`/podcasts/${podcast.id}/episodes`}
            className={styles.cardAction}
            aria-label={`Episodes for ${podcast.title}`}
          >
            <List size={16} strokeWidth={2} aria-hidden />
            <span className={styles.cardActionLabel}>Episodes</span>
          </Link>
          {!isAdminView && (
            <>
              {readOnly ? (
                <span
                  className={`${styles.cardActionPrimary} ${styles.cardActionPrimaryDisabled}`}
                  title="Read-only account"
                >
                  <Mic2 size={16} strokeWidth={2} aria-hidden />
                  <span className={styles.cardActionLabel}>New Episode</span>
                </span>
              ) : !myRole || (myRole !== 'owner' && myRole !== 'manager') ? (
                <span
                  className={`${styles.cardActionPrimary} ${styles.cardActionPrimaryDisabled}`}
                  title="Only managers and the owner can create episodes"
                  aria-label="New episode (view or editor)"
                >
                  <Mic2 size={16} strokeWidth={2} aria-hidden />
                  <span className={styles.cardActionLabel}>New Episode</span>
                </span>
              ) : atEpisodeLimit ? (
                <span
                  className={`${styles.cardActionPrimary} ${styles.cardActionPrimaryDisabled}`}
                  title="You're at max episodes for this show"
                  aria-label="New episode (at limit)"
                >
                  <Mic2 size={16} strokeWidth={2} aria-hidden />
                  <span className={styles.cardActionLabel}>New Episode</span>
                </span>
              ) : (
                <Link
                  to={`/podcasts/${podcast.id}/episodes/new`}
                  className={styles.cardActionPrimary}
                  aria-label={`Create new episode for ${podcast.title}`}
                >
                  <Mic2 size={16} strokeWidth={2} aria-hidden />
                  <span className={styles.cardActionLabel}>New Episode</span>
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

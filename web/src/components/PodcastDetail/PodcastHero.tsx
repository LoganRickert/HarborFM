import { Link } from 'react-router-dom';
import {
  BarChart3,
  ChevronRight,
  ExternalLink,
  Globe,
  List,
  Lock,
  MessageSquare,
  Rss,
  Settings,
  Share2,
} from 'lucide-react';
import { getPublicRssUrl } from '../../api/rss';
import { PodcastGroupDetailRow, PodcastGroupRow } from './PodcastGroupList';
import localStyles from './PodcastDetail.module.css';
import sharedStyles from './shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    siteUrl?: string | null;
    authorName?: string | null;
    categoryPrimary?: string | null;
    categorySecondary?: string | null;
    categoryPrimaryTwo?: string | null;
    categorySecondaryTwo?: string | null;
    categoryPrimaryThree?: string | null;
    categorySecondaryThree?: string | null;
    language?: string | null;
    medium?: string | null;
    itunesType?: string;
    ownerName?: string | null;
    email?: string | null;
    explicit?: number;
  };
  readOnly: boolean;
  canManageShow: boolean;
  onEditClick: () => void;
  onLinksClick?: () => void;
  publicFeedsEnabled?: boolean;
  detailsExpanded: boolean;
  onDetailsToggle: () => void;
}

export function PodcastHero({
  podcast,
  readOnly,
  canManageShow,
  onEditClick,
  onLinksClick,
  publicFeedsEnabled,
  detailsExpanded,
  onDetailsToggle,
}: PodcastHeroProps) {
  const showPublicRss = !(podcast.subscriberOnlyFeedEnabled && podcast.publicFeedDisabled);
  const canEdit = !readOnly && canManageShow;
  const artworkSrc =
    podcast.artworkUrl ??
    (podcast.artworkFilename
      ? `/api/podcasts/${podcast.id}/artwork/${encodeURIComponent(podcast.artworkFilename)}`
      : null);

  const categories = [
    podcast.categoryPrimary,
    podcast.categorySecondary,
    podcast.categoryPrimaryTwo,
    podcast.categorySecondaryTwo,
    podcast.categoryPrimaryThree,
    podcast.categorySecondaryThree,
  ].filter(Boolean);

  return (
    <div className={styles.podcastShowBody}>
        <div className={styles.podcastIdentityBlock}>
          <div className={styles.podcastIdentity}>
            {artworkSrc ? (
              <img src={artworkSrc} alt="" className={styles.podcastIdentityArtwork} />
            ) : (
              <div className={styles.podcastIdentityArtworkPlaceholder} aria-hidden />
            )}
            <div className={styles.podcastIdentityMain}>
              <div className={styles.podcastIdentityTitleRow}>
                {!!podcast.subscriberOnlyFeedEnabled && (
                  <Lock
                    size={14}
                    strokeWidth={2.25}
                    className={
                      podcast.publicFeedDisabled
                        ? `${styles.podcastIdentityLock} ${styles.podcastIdentityLockGold}`
                        : styles.podcastIdentityLock
                    }
                    aria-hidden
                  />
                )}
                <h1 className={styles.podcastIdentityTitle}>{podcast.title}</h1>
              </div>
              {podcast.description ? (
                <p className={styles.podcastIdentityDescription}>{podcast.description}</p>
              ) : null}
            </div>
          </div>

          <div className={styles.podcastPrimaryActions}>
            <Link
              to={`/podcasts/${podcast.id}/episodes`}
              className={styles.podcastPrimaryBtn}
            >
              <List size={20} strokeWidth={2} aria-hidden />
              Episodes
            </Link>
            <Link
              to={`/podcasts/${podcast.id}/analytics`}
              className={`${styles.podcastPrimaryBtn} ${styles.podcastPrimaryBtnSecondary}`}
            >
              <BarChart3 size={20} strokeWidth={2} aria-hidden />
              Analytics
            </Link>
          </div>
        </div>

        <div className={`${styles.podcastShowList} ${detailsExpanded ? styles.podcastShowListExpanded : ''}`}>
        {publicFeedsEnabled && (
          <PodcastGroupRow
            label="Public Page"
            icon={Globe}
            iconTone="green"
            to={`/feed/${podcast.slug}`}
          />
        )}
        {showPublicRss && (
          <PodcastGroupRow
            label="Public RSS"
            icon={Rss}
            iconTone="amber"
            href={getPublicRssUrl(podcast.slug)}
            external
          />
        )}
        {canManageShow && (
          <PodcastGroupRow
            label="Reviews"
            icon={MessageSquare}
            iconTone="slate"
            to={`/podcasts/${podcast.id}/reviews`}
          />
        )}
        {canEdit && (
          <PodcastGroupRow
            label="Edit Show"
            icon={Settings}
            iconTone="purple"
            onClick={onEditClick}
          />
        )}
        {canEdit && onLinksClick && (
          <PodcastGroupRow
            label="Platform & Social Links"
            icon={Share2}
            iconTone="blue"
            onClick={onLinksClick}
          />
        )}

        <button
          type="button"
          className={`${styles.groupListRow} ${styles.podcastShowDetailsToggle}`}
          onClick={onDetailsToggle}
          aria-expanded={detailsExpanded}
          aria-controls="podcast-details-content"
        >
          <span className={styles.groupListRowLead}>
            <span className={styles.groupListRowLabel}>Show Details</span>
          </span>
          <ChevronRight
            size={15}
            strokeWidth={2.25}
            className={styles.groupListRowAccessory}
            aria-hidden
          />
        </button>

        <div
          id="podcast-details-content"
          className={`${styles.groupListExpand} ${detailsExpanded ? styles.groupListExpandOpen : ''}`}
          aria-hidden={!detailsExpanded}
        >
          <div className={styles.groupListExpandInner}>
            {podcast.authorName && (
              <PodcastGroupDetailRow label="Author" value={podcast.authorName} />
            )}
            {categories.length > 0 && (
              <PodcastGroupDetailRow label="Categories" value={categories.join(', ')} />
            )}
            {podcast.language && (
              <PodcastGroupDetailRow label="Language" value={toTitleCase(podcast.language)} />
            )}
            {podcast.medium && (
              <PodcastGroupDetailRow label="Medium" value={toTitleCase(podcast.medium)} />
            )}
            <PodcastGroupDetailRow
              label="Type"
              value={podcast.itunesType === 'serial' ? 'Serial' : 'Episodic'}
            />
            {podcast.ownerName && (
              <PodcastGroupDetailRow label="Owner" value={podcast.ownerName} />
            )}
            {podcast.email && (
              <PodcastGroupDetailRow
                label="Email"
                value={
                  <a href={`mailto:${podcast.email}`} className={styles.groupListDetailLink}>
                    {podcast.email}
                  </a>
                }
              />
            )}
            {podcast.siteUrl && (
              <PodcastGroupDetailRow
                label="Website"
                value={
                  <a
                    href={podcast.siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.groupListDetailLink}
                  >
                    <ExternalLink size={13} strokeWidth={2} aria-hidden />
                    Visit website
                  </a>
                }
              />
            )}
            {!!podcast.explicit && (
              <PodcastGroupDetailRow label="Explicit" value="Yes" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

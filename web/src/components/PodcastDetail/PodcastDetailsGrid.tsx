import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import localStyles from './PodcastDetail.module.css';
import sharedStyles from './shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

interface PodcastDetailsGridProps {
  podcast: {
    slug: string;
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
  detailsExpanded: boolean;
  onDetailsToggle: () => void;
}

export function PodcastDetailsGrid({ podcast, detailsExpanded, onDetailsToggle }: PodcastDetailsGridProps) {
  return (
    <div className={styles.podcastDetails}>
      <button
        type="button"
        className={styles.podcastDetailsToggle}
        onClick={onDetailsToggle}
        aria-expanded={detailsExpanded}
        aria-controls="podcast-details-content"
      >
        {detailsExpanded ? (
          <ChevronUp size={18} strokeWidth={2} aria-hidden />
        ) : (
          <ChevronDown size={18} strokeWidth={2} aria-hidden />
        )}
        Show details
      </button>
      <div id="podcast-details-content" className={detailsExpanded ? styles.podcastDetailsContent : styles.podcastDetailsContentCollapsed}>
        <dl className={styles.podcastDetailsGrid}>
        {podcast.siteUrl && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Website</dt>
            <dd className={styles.podcastDetailsValue}>
              <a href={podcast.siteUrl} target="_blank" rel="noopener noreferrer" className={styles.podcastDetailsActionLink}>
                <ExternalLink size={16} strokeWidth={2} aria-hidden />
                Visit website
              </a>
            </dd>
          </div>
        )}
        {podcast.authorName && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Author</dt>
            <dd className={styles.podcastDetailsValue}>{podcast.authorName}</dd>
          </div>
        )}
        {[
          podcast.categoryPrimary,
          podcast.categorySecondary,
          podcast.categoryPrimaryTwo,
          podcast.categorySecondaryTwo,
          podcast.categoryPrimaryThree,
          podcast.categorySecondaryThree,
        ].some(Boolean) && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Categories</dt>
            <dd className={styles.podcastDetailsValue}>
              {[
                podcast.categoryPrimary,
                podcast.categorySecondary,
                podcast.categoryPrimaryTwo,
                podcast.categorySecondaryTwo,
                podcast.categoryPrimaryThree,
                podcast.categorySecondaryThree,
              ].filter(Boolean).join(', ')}
            </dd>
          </div>
        )}
        {podcast.language && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Language</dt>
            <dd className={styles.podcastDetailsValue}>{toTitleCase(podcast.language)}</dd>
          </div>
        )}
        {podcast.medium && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Medium</dt>
            <dd className={styles.podcastDetailsValue}>{toTitleCase(podcast.medium)}</dd>
          </div>
        )}
        <div className={styles.podcastDetailsItem}>
          <dt className={styles.podcastDetailsTerm}>Type</dt>
          <dd className={styles.podcastDetailsValue}>{podcast.itunesType === 'serial' ? 'Serial' : 'Episodic'}</dd>
        </div>
        {podcast.ownerName && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Owner</dt>
            <dd className={styles.podcastDetailsValue}>{podcast.ownerName}</dd>
          </div>
        )}
        {podcast.email && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Email</dt>
            <dd className={styles.podcastDetailsValue}>
              <a href={`mailto:${podcast.email}`} className={styles.podcastDetailsLink}>{podcast.email}</a>
            </dd>
          </div>
        )}
        {!!podcast.explicit && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Explicit</dt>
            <dd className={styles.podcastDetailsValue}>Yes</dd>
          </div>
        )}
        </dl>
      </div>
    </div>
  );
}

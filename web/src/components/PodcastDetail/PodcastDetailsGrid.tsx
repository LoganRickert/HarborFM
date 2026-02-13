import { Link } from 'react-router-dom';
import { Rss, ExternalLink } from 'lucide-react';
import { getPublicRssUrl } from '../../api/rss';
import localStyles from './PodcastDetail.module.css';
import sharedStyles from './shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface PodcastDetailsGridProps {
  podcast: {
    slug: string;
    site_url?: string | null;
    author_name?: string | null;
    category_primary?: string | null;
    category_secondary?: string | null;
    category_primary_two?: string | null;
    category_secondary_two?: string | null;
    category_primary_three?: string | null;
    category_secondary_three?: string | null;
    language?: string | null;
    medium?: string | null;
    itunes_type?: string;
    owner_name?: string | null;
    email?: string | null;
    explicit?: number;
  };
  publicFeedsEnabled: boolean;
}

export function PodcastDetailsGrid({ podcast, publicFeedsEnabled }: PodcastDetailsGridProps) {
  return (
    <div className={styles.podcastDetails}>
      <h2 className={styles.podcastDetailsTitle}>Show details</h2>
      <dl className={styles.podcastDetailsGrid}>
        {publicFeedsEnabled && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Public Feed Page</dt>
            <dd className={styles.podcastDetailsValue}>
              <Link to={`/feed/${podcast.slug}`} className={styles.podcastDetailsActionLink}>
                <Rss size={16} strokeWidth={2} aria-hidden />
                Public Feed Page
              </Link>
            </dd>
          </div>
        )}
        <div className={styles.podcastDetailsItem}>
          <dt className={styles.podcastDetailsTerm}>Public Feed XML</dt>
          <dd className={styles.podcastDetailsValue}>
            <a
              href={getPublicRssUrl(podcast.slug)}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.podcastDetailsActionLink}
            >
              <Rss size={16} strokeWidth={2} aria-hidden />
              Public Feed XML
            </a>
          </dd>
        </div>
        {podcast.site_url && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Website</dt>
            <dd className={styles.podcastDetailsValue}>
              <a href={podcast.site_url} target="_blank" rel="noopener noreferrer" className={styles.podcastDetailsActionLink}>
                <ExternalLink size={16} strokeWidth={2} aria-hidden />
                Visit website
              </a>
            </dd>
          </div>
        )}
        {podcast.author_name && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Author</dt>
            <dd className={styles.podcastDetailsValue}>{podcast.author_name}</dd>
          </div>
        )}
        {[
          podcast.category_primary,
          podcast.category_secondary,
          podcast.category_primary_two,
          podcast.category_secondary_two,
          podcast.category_primary_three,
          podcast.category_secondary_three,
        ].some(Boolean) && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Categories</dt>
            <dd className={styles.podcastDetailsValue}>
              {[
                podcast.category_primary,
                podcast.category_secondary,
                podcast.category_primary_two,
                podcast.category_secondary_two,
                podcast.category_primary_three,
                podcast.category_secondary_three,
              ].filter(Boolean).join(', ')}
            </dd>
          </div>
        )}
        {podcast.language && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Language</dt>
            <dd className={styles.podcastDetailsValue}>{podcast.language}</dd>
          </div>
        )}
        {podcast.medium && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Medium</dt>
            <dd className={styles.podcastDetailsValue}>{podcast.medium}</dd>
          </div>
        )}
        <div className={styles.podcastDetailsItem}>
          <dt className={styles.podcastDetailsTerm}>Type</dt>
          <dd className={styles.podcastDetailsValue}>{podcast.itunes_type === 'serial' ? 'Serial' : 'Episodic'}</dd>
        </div>
        {podcast.owner_name && (
          <div className={styles.podcastDetailsItem}>
            <dt className={styles.podcastDetailsTerm}>Owner</dt>
            <dd className={styles.podcastDetailsValue}>{podcast.owner_name}</dd>
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
  );
}

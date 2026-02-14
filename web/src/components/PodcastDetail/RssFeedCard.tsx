import { Rss, ExternalLink } from 'lucide-react';
import { getAuthRssPreviewUrl, getPublicRssUrl } from '../../api/rss';
import localStyles from './PodcastDetail.module.css';
import sharedStyles from './shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface RssFeedCardProps {
  podcast: {
    id: string;
    slug: string;
  };
}

export function RssFeedCard({ podcast }: RssFeedCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.rssHeader}>
        <div className={styles.rssTitle}>
          <Rss size={18} strokeWidth={2} aria-hidden="true" />
          <h2 className={styles.sectionTitle}>RSS Feed</h2>
        </div>
        <div className={styles.rssActions}>
          <a
            href={`https://podba.se/validate/?url=${encodeURIComponent(`${window.location.origin}${getPublicRssUrl(podcast.slug)}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.rssBtn}
          >
            <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
            Validate Public Feed
          </a>
          <a
            href={getAuthRssPreviewUrl(podcast.id)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.rssBtn}
          >
            <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
            Preview Feed XML
          </a>
        </div>
      </div>
      <p className={`${styles.pdCardSectionSub} ${styles.rssSectionSub}`}>
        The feed updates automatically when you save show details or create/update episodes. With an export destination you can deploy your feed and media to storage (S3, FTP, SFTP, WebDAV, IPFS, or SMB).
      </p>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { FeedBreadcrumbsProps } from '../../../types/feed';
import styles from './FeedBreadcrumbs.module.css';

export function FeedBreadcrumbs({ podcast, episode, podcastSlug, feedRootTo }: FeedBreadcrumbsProps) {
  const feedLinkTo = feedRootTo ?? `/feed/${podcastSlug}`;
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
      <Link to={feedLinkTo} className={styles.link}>
        {podcast.title}
      </Link>
      <ChevronRight size={16} className={styles.sep} aria-hidden />
      <span className={styles.current} title={episode.title}>
        {episode.title}
      </span>
    </nav>
  );
}

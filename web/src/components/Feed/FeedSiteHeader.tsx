import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { getPublicConfig } from '../../api/public';
import styles from './FeedSiteHeader.module.css';

export function FeedSiteHeader() {
  const host = typeof window !== 'undefined' ? window.location.host : '';
  const { data: publicConfig } = useQuery({
    queryKey: ['publicConfig', host],
    queryFn: getPublicConfig,
    staleTime: 5 * 60 * 1000,
  });

  if (publicConfig?.customFeedSlug) {
    return null;
  }

  return (
    <header className={styles.siteHeader}>
      <div className={styles.siteHeaderContent}>
        <Link to="/feed" className={styles.logo}>
          <img src="/favicon.svg" alt="" className={styles.logoIcon} />
          HarborFM
        </Link>
        <Link to="/" className={styles.signInIcon} title="Dashboard">
          <Home size={16} strokeWidth={2} aria-label="Dashboard" />
        </Link>
      </div>
    </header>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { getPublicConfig } from '../../api/public';
import { getSiteDisplayName } from '../../utils/siteBranding';
import styles from './FeedSiteHeader.module.css';

export function FeedSiteHeader({ flush = false }: { flush?: boolean } = {}) {
  const host = typeof window !== 'undefined' ? window.location.host : '';
  const { data: publicConfig } = useQuery({
    queryKey: ['publicConfig', host],
    queryFn: getPublicConfig,
    staleTime: 5 * 60 * 1000,
  });

  if (publicConfig?.customFeedSlug) {
    return null;
  }

  const siteName = getSiteDisplayName(publicConfig?.whiteLabel);

  return (
    <header
      data-harborfm-feed-header=""
      className={`${styles.siteHeader}${flush ? ` ${styles.siteHeaderFlush}` : ''}`}
    >
      <div
        className={
          flush
            ? `${styles.siteHeaderContent} ${styles.siteHeaderContentFluid}`
            : styles.siteHeaderContent
        }
      >
        <Link
          to="/feed"
          className={flush ? `${styles.logo} ${styles.logoFluid}` : styles.logo}
        >
          <img src="/favicon.svg" alt="" className={styles.logoIcon} />
          {siteName}
        </Link>
        <Link
          to="/"
          className={flush ? `${styles.signInIcon} ${styles.signInIconFluid}` : styles.signInIcon}
          title="Dashboard"
        >
          <Home size={16} strokeWidth={2} aria-label="Dashboard" />
        </Link>
      </div>
    </header>
  );
}

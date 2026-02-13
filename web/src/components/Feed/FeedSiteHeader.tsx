import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import styles from './FeedSiteHeader.module.css';

export function FeedSiteHeader() {
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

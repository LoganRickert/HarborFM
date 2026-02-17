import { Link } from 'react-router-dom';
import styles from './CallJoinHeader.module.css';

export function CallJoinHeader() {
  return (
    <header className={styles.siteHeader}>
      <div className={styles.siteHeaderContent}>
        <Link to="/" className={styles.logo}>
          <img src="/favicon.svg" alt="" className={styles.logoIcon} />
          HarborFM
        </Link>
      </div>
    </header>
  );
}

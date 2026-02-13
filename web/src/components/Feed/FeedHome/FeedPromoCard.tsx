import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import styles from './FeedPromoCard.module.css';

export function FeedPromoCard() {
  return (
    <div className={styles.promo}>
      <div className={styles.promoContent}>
        <div className={styles.promoTextContent}>
          <h2 className={styles.promoTitle}>Create Your Own Podcast</h2>
          <p className={styles.promoText}>
            Start your podcasting journey with HarborFM. Upload, edit, and share your episodes with the world.
          </p>
        </div>
        <Link to="/login" className={styles.promoButton}>
          <Plus size={16} strokeWidth={2.5} aria-hidden />
          Get Started
        </Link>
      </div>
    </div>
  );
}

import { Download } from 'lucide-react';
import { ImportPodcastCardProps } from '../../types/dashboard';
import styles from './ImportPodcastCard.module.css';

export function ImportPodcastCard({ onImportClick }: ImportPodcastCardProps) {
  return (
    <section className={styles.importCard} aria-label="Import podcast">
      <div className={styles.importCardRow}>
        <div className={styles.importCardHeader}>
          <h2 className={styles.importCardTitle}>Import Podcast</h2>
          <p className={styles.importCardSub}>
            Add an existing show from its RSS or Atom feed. Episodes will be downloaded and added to a new show.
          </p>
        </div>
        <button
          type="button"
          className={styles.importCardBtn}
          onClick={onImportClick}
          aria-label="Open import podcast dialog"
        >
          <Download size={20} strokeWidth={2} aria-hidden />
          Import
        </button>
      </div>
    </section>
  );
}

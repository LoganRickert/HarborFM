import styles from './FailedToLoadCard.module.css';

interface FailedToLoadCardProps {
  /** Main error title (e.g. "Failed to load podcasts"). Shown in red. */
  title: string;
  /** Optional sub-message. Default: "Please try refreshing the page." */
  message?: string;
}

export function FailedToLoadCard({
  title,
  message = 'Please try refreshing the page.',
}: FailedToLoadCardProps) {
  return (
    <div className={styles.card}>
      <p className={styles.title}>{title}</p>
      <p className={styles.message}>{message}</p>
    </div>
  );
}

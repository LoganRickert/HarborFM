import { SectionCardProps } from '../../types/settings';
import styles from './SectionCard.module.css';

export function SectionCard({ title, subtitle, children }: SectionCardProps) {
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <p className={styles.cardSub}>{subtitle}</p>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

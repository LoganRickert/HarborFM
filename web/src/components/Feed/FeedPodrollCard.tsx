import type { PublicPodcast } from '../../api/public';
import styles from './FeedPodrollCard.module.css';

export type PodrollEntry = NonNullable<PublicPodcast['podroll']>[number];

export interface FeedPodrollCardProps {
  podroll: PublicPodcast['podroll'];
}

const FALLBACK_COVER = '/favicon.svg';

export function FeedPodrollCard({ podroll }: FeedPodrollCardProps) {
  const items = (podroll ?? []).filter(
    (p) => p.homeUrl?.trim() || p.feedUrl?.trim(),
  );
  if (items.length === 0) return null;

  return (
    <section className={styles.card} aria-labelledby="podroll-card-title">
      <h2 id="podroll-card-title" className={styles.title}>
        Recommended Podcasts
      </h2>
      <ul className={styles.list}>
        {items.map((item) => (
          <PodrollItem key={item.feedGuid} item={item} />
        ))}
      </ul>
    </section>
  );
}

function PodrollItem({ item }: { item: PodrollEntry }) {
  const home = item.homeUrl?.trim();
  const feed = item.feedUrl?.trim();
  const href = home || feed || '';
  const name = item.title?.trim() || 'Recommended show';
  const cover = item.coverArtUrl?.trim() || FALLBACK_COVER;
  const linkKind = home ? 'home page' : 'RSS feed';

  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.item}
        aria-label={`${name} (${linkKind})`}
      >
        <img
          src={cover}
          alt=""
          className={styles.cover}
          onError={(e) => {
            const img = e.currentTarget;
            if (img.src.endsWith(FALLBACK_COVER)) return;
            img.src = FALLBACK_COVER;
          }}
        />
        <span className={styles.name}>{name}</span>
      </a>
    </li>
  );
}

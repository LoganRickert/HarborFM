import { useInfiniteQuery } from '@tanstack/react-query';
import { User } from 'lucide-react';
import { getPublicCast, type PublicCastMember } from '../../api/public';
import sharedStyles from '../../styles/shared.module.css';
import styles from './FeedCastCard.module.css';

export type { PublicCastMember } from '../../api/public';

export interface FeedCastListProps {
  cast: PublicCastMember[];
  className?: string;
}

/** Reusable cast list (avatar, name, description, social). Used for podcast and episode cast. */
export function FeedCastList({ cast, className }: FeedCastListProps) {
  if (cast.length === 0) return null;
  return (
    <ul className={`${styles.castList} ${className ?? ''}`.trim()}>
      {cast.map((c) => (
        <FeedCastMember key={c.id} member={c} />
      ))}
    </ul>
  );
}

export function FeedCastMember({ member }: { member: PublicCastMember }) {
  return (
    <li className={styles.castRow}>
      {member.photo_url ? (
        <img src={member.photo_url} alt="" className={styles.castAvatar} />
      ) : (
        <div className={styles.castAvatarPlaceholder}>
          <User size={24} />
        </div>
      )}
      <div className={styles.castMeta}>
        <span className={styles.castName}>{member.name}</span>
        {member.description && (
          <p className={styles.castDesc}>{member.description}</p>
        )}
        {member.social_link_text && (() => {
          const href = member.social_link_text.trim();
          const isUrl = href.startsWith('http://') || href.startsWith('https://');
          return isUrl ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className={styles.castSocial}>
              {href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
            </a>
          ) : (
            <span className={styles.castSocial}>{member.social_link_text}</span>
          );
        })()}
      </div>
    </li>
  );
}

export interface FeedCastCardProps {
  podcastSlug: string;
}

export function FeedCastCard({ podcastSlug }: FeedCastCardProps) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['public-cast', podcastSlug],
      queryFn: ({ pageParam }) =>
        getPublicCast(podcastSlug, { limit: 10, offset: pageParam }),
      getNextPageParam: (lastPage, allPages) => {
        const totalGuests = allPages.reduce(
          (sum, p) => sum + p.guests.length,
          0
        );
        return lastPage.guests_has_more ? totalGuests : undefined;
      },
      initialPageParam: 0,
      enabled: !!podcastSlug,
    });

  const hosts = data?.pages[0]?.hosts ?? [];
  const allGuests = data?.pages.flatMap((p) => p.guests) ?? [];

  if (isLoading || (hosts.length === 0 && allGuests.length === 0)) return null;

  return (
    <div className={`${sharedStyles.card} ${styles.castCard}`}>
      <h2 className={styles.castTitle}>Cast</h2>

      {hosts.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h3 className={styles.castSectionTitle}>Hosts</h3>
          <FeedCastList cast={hosts} />
        </section>
      )}

      {allGuests.length > 0 && (
        <section>
          <h3 className={styles.castSectionTitle}>Guests</h3>
          <FeedCastList cast={allGuests} />
          {hasNextPage && (
            <div className={styles.loadMore}>
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className={styles.loadMoreBtn}
                aria-label="Load more guests"
              >
                {isFetchingNextPage ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

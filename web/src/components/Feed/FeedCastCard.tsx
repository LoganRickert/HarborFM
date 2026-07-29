import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, User, X } from 'lucide-react';
import {
  SiDiscord,
  SiFacebook,
  SiInstagram,
  SiPatreon,
  SiTiktok,
  SiX,
  SiYoutube,
} from 'react-icons/si';
import {
  castSocialLinkItems,
  type CastSocialLinkItem,
  type CastSocialPlatformKey,
} from '@harborfm/shared';
import { getPublicCast, type PublicCastMember } from '../../api/public';
import sharedStyles from '../../styles/shared.module.css';
import styles from './FeedCastCard.module.css';

export type { PublicCastMember } from '../../api/public';

export interface FeedCastListProps {
  cast: PublicCastMember[];
  className?: string;
}

const PLATFORM_ICONS: Partial<
  Record<CastSocialPlatformKey, React.ComponentType<{ size?: number }>>
> = {
  facebook: SiFacebook,
  x: SiX,
  instagram: SiInstagram,
  patreon: SiPatreon,
  tiktok: SiTiktok,
  youtube: SiYoutube,
  discord: SiDiscord,
};

const PREVIEW_COUNT = 2;

function socialHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function CastSocialLinkChip({ item }: { item: CastSocialLinkItem }) {
  const Icon = PLATFORM_ICONS[item.key] ?? ExternalLink;
  return (
    <a
      href={socialHref(item.url)}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.castSocialChip}
      title={`${item.label}: ${item.display}`}
      aria-label={`${item.label} ${item.display} (opens in new tab)`}
    >
      <Icon size={14} aria-hidden />
      <span className={styles.castSocialChipText}>{item.display}</span>
    </a>
  );
}

function CastSocialLinks({
  urls,
  memberName,
}: {
  urls: string[];
  memberName: string;
}) {
  const [seeAllOpen, setSeeAllOpen] = useState(false);
  const items = castSocialLinkItems(urls);
  if (items.length === 0) return null;

  const preview = items.slice(0, PREVIEW_COUNT);
  const hasMore = items.length > PREVIEW_COUNT;

  return (
    <>
      <div className={styles.castSocialRow} aria-label="Social links">
        {preview.map((item, index) => (
          <CastSocialLinkChip key={`${item.url}-${index}`} item={item} />
        ))}
        {hasMore ? (
          <button
            type="button"
            className={styles.castSocialSeeAll}
            onClick={() => setSeeAllOpen(true)}
          >
            See all
          </button>
        ) : null}
      </div>

      <Dialog.Root open={seeAllOpen} onOpenChange={setSeeAllOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.castSocialDialogOverlay} />
          <Dialog.Content className={styles.castSocialDialogContent}>
            <div className={styles.castSocialDialogHeader}>
              <Dialog.Title className={styles.castSocialDialogTitle}>
                {memberName.trim() ? `${memberName.trim()}'s links` : 'Social links'}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.castSocialDialogClose}
                  aria-label="Close"
                >
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className={styles.castSocialDialogSrOnly}>
              All social and profile links for this cast member.
            </Dialog.Description>
            <ul className={styles.castSocialDialogList}>
              {items.map((item, index) => {
                const Icon = PLATFORM_ICONS[item.key] ?? ExternalLink;
                return (
                  <li key={`${item.url}-${index}`}>
                    <a
                      href={socialHref(item.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.castSocialDialogItem}
                    >
                      <span className={styles.castSocialDialogItemIcon}>
                        <Icon size={18} aria-hidden />
                      </span>
                      <span className={styles.castSocialDialogItemMeta}>
                        <span className={styles.castSocialDialogItemLabel}>
                          {item.label}
                        </span>
                        <span className={styles.castSocialDialogItemHandle}>
                          {item.display}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
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
  const socialLinks = Array.isArray(member.social_links) ? member.social_links : [];
  return (
    <li className={styles.castRow}>
      {member.photo_url ? (
        <img src={member.photo_url} alt={`${member.name} photo`} className={styles.castAvatar} />
      ) : (
        <div className={styles.castAvatarPlaceholder}>
          <User size={24} aria-hidden />
        </div>
      )}
      <div className={styles.castMeta}>
        <span className={styles.castName}>{member.name}</span>
        {member.description && (
          <p className={styles.castDesc}>{member.description}</p>
        )}
        <CastSocialLinks urls={socialLinks} memberName={member.name} />
      </div>
    </li>
  );
}

export interface FeedCastCardProps {
  podcastSlug: string;
  plain?: boolean;
}

export function FeedCastCard({ podcastSlug, plain = false }: FeedCastCardProps) {
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
    <div
      className={
        plain
          ? `${styles.castCard} ${styles.castCardPlain}`
          : `${sharedStyles.card} ${styles.castCard}`
      }
    >
      <h2 className={plain ? `${styles.castTitle} ${styles.castTitleFluid}` : styles.castTitle}>
        Cast
      </h2>

      {hosts.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h3
            className={
              plain
                ? `${styles.castSectionTitle} ${styles.castSectionTitleFluid}`
                : styles.castSectionTitle
            }
          >
            Hosts
          </h3>
          <FeedCastList cast={hosts} />
        </section>
      )}

      {allGuests.length > 0 && (
        <section>
          <h3
            className={
              plain
                ? `${styles.castSectionTitle} ${styles.castSectionTitleFluid}`
                : styles.castSectionTitle
            }
          >
            Guests
          </h3>
          <FeedCastList cast={allGuests} />
          {hasNextPage && (
            <div className={plain ? `${styles.loadMore} ${styles.loadMoreFluid}` : styles.loadMore}>
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className={
                  plain ? `${styles.loadMoreBtn} ${styles.loadMoreBtnFluid}` : styles.loadMoreBtn
                }
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

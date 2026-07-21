import { FeedEpisodesListProps } from '../../../types/feed';
import { FeedEpisodeCard } from '../FeedEpisodeCard';
import styles from './FeedEpisodesList.module.css';

export function FeedEpisodesList({
  episodes,
  podcast,
  podcastSlug,
  playingEpisodeId,
  onPlay,
  onPause,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  useShortEpisodeUrls = false,
  plain = false,
}: FeedEpisodesListProps) {
  if (episodes.length === 0) {
    return <p className={styles.muted}>No episodes found.</p>;
  }

  return (
    <>
      <ul
        className={plain ? `${styles.list} ${styles.listPlain}` : styles.list}
        data-harborfm-episodes-list
      >
        {episodes.map((ep) => (
          <FeedEpisodeCard
            key={ep.id}
            episode={ep}
            podcastSlug={podcastSlug}
            isSubscriberOnly={Boolean(ep.subscriberOnly) || Boolean(podcast.publicFeedDisabled)}
            showPlayer={true}
            playingEpisodeId={playingEpisodeId}
            onPlay={onPlay}
            onPause={onPause}
            useShortEpisodeUrls={useShortEpisodeUrls}
            showDescription={podcast.feedShowEpisodeDescription !== false}
            plain={plain}
          />
        ))}
      </ul>
      {hasNextPage && onLoadMore && (
        <div className={plain ? `${styles.loadMore} ${styles.loadMoreFluid}` : styles.loadMore}>
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className={plain ? `${styles.loadMoreBtn} ${styles.loadMoreBtnFluid}` : styles.loadMoreBtn}
            aria-label="Load More Episodes"
            data-harborfm-episodes-load-more
          >
            {isFetchingNextPage ? 'Loading...' : 'Load More Episodes'}
          </button>
        </div>
      )}
    </>
  );
}

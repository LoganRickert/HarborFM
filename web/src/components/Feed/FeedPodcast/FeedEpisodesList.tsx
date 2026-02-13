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
}: FeedEpisodesListProps) {
  if (episodes.length === 0) {
    return <p className={styles.muted}>No episodes found.</p>;
  }

  return (
    <>
      <ul className={styles.list}>
        {episodes.map((ep) => (
          <FeedEpisodeCard
            key={ep.id}
            episode={ep}
            podcastSlug={podcastSlug}
            isSubscriberOnly={ep.subscriber_only === 1 || podcast.public_feed_disabled === 1}
            showPlayer={true}
            playingEpisodeId={playingEpisodeId}
            onPlay={onPlay}
            onPause={onPause}
            useShortEpisodeUrls={useShortEpisodeUrls}
          />
        ))}
      </ul>
      {hasNextPage && onLoadMore && (
        <div className={styles.loadMore}>
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className={styles.loadMoreBtn}
            aria-label="Load more episodes"
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more episodes'}
          </button>
        </div>
      )}
    </>
  );
}

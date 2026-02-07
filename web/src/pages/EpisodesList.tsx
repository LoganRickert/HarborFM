import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPodcast } from '../api/podcasts';
import { listEpisodes } from '../api/episodes';
import { FullPageLoading, InlineLoading } from '../components/Loading';
import styles from './EpisodesList.module.css';

export function EpisodesList() {
  const { id } = useParams<{ id: string }>();
  const { data: podcast, isLoading: podcastLoading } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });
  const { data: episodes = [], isLoading: episodesLoading } = useQuery({
    queryKey: ['episodes', id],
    queryFn: () => listEpisodes(id!),
    enabled: !!id,
  });

  const draftCount = episodes.filter((e) => e.status === 'draft').length;
  const publishedCount = episodes.filter((e) => e.status === 'published').length;

  if (!id) return null;
  if (podcastLoading) return <FullPageLoading />;

  return (
    <div className={styles.wrap}>
      <Link to={`/podcasts/${id}`} className={styles.back}>
        ← {podcast?.title ?? 'Show'}
      </Link>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.cardTitle}>Episodes</h1>
          <Link to={`/podcasts/${id}/episodes/new`} className={styles.newBtn}>
            New episode
          </Link>
        </div>
        <p className={styles.subtitle}>
          {draftCount} draft · {publishedCount} published
        </p>
        {episodesLoading && (
          <p className={styles.muted}>
            <InlineLoading label="Loading episodes" />
          </p>
        )}
        {!episodesLoading && episodes.length === 0 && (
          <div className={styles.empty}>
            <p>No episodes yet.</p>
            <Link to={`/podcasts/${id}/episodes/new`} className={styles.emptyLink}>
              Create first episode
            </Link>
          </div>
        )}
        {!episodesLoading && episodes.length > 0 && (
          <ul className={styles.list}>
            {episodes.map((ep) => (
              <li key={ep.id} className={styles.item}>
                <Link to={`/episodes/${ep.id}`} className={styles.itemLink}>
                  <div className={styles.itemContent}>
                    <span className={styles.itemTitle}>{ep.title}</span>
                    <div className={styles.itemMeta}>
                      <span className={styles.itemStatus}>{ep.status}</span>
                      {(ep.season_number != null || ep.episode_number != null) && (
                        <span className={styles.itemMetaItem}>
                          S{ep.season_number ?? '?'} E{ep.episode_number ?? '?'}
                        </span>
                      )}
                      {ep.audio_final_path && (
                        <span className={styles.itemMetaItem}>✓ Audio</span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

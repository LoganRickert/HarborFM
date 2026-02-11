import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import { getPodcast } from '../api/podcasts';
import { listEpisodes } from '../api/episodes';
import { me, isReadOnly } from '../api/auth';
import { FullPageLoading, InlineLoading } from '../components/Loading';
import { Breadcrumb } from '../components/Breadcrumb';
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
  const maxEpisodes = podcast?.max_episodes ?? null;
  const episodeCount = Number(podcast?.episode_count ?? episodes.length);
  const atEpisodeLimit = maxEpisodes != null && maxEpisodes > 0 && episodeCount >= Number(maxEpisodes);
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const readOnly = isReadOnly(meData?.user);

  const publishedCount = episodes.filter((e) => e.status === 'published').length;
  const scheduledCount = episodes.filter((e) => e.status === 'scheduled').length;
  const draftCount = episodes.filter((e) => e.status === 'draft').length;

  if (!id) return null;
  if (podcastLoading) return <FullPageLoading />;

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: podcast?.title ?? 'Show', href: `/podcasts/${id}`, mobileLabel: 'Podcast' },
    { label: 'Episodes' },
  ];

  return (
    <div className={styles.wrap}>
      <Breadcrumb items={breadcrumbItems} />
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.cardTitle}>Episodes</h1>
          {readOnly ? (
            <span className={`${styles.newBtn} ${styles.newBtnDisabled}`} title="Read-only account">
              <Plus size={18} strokeWidth={2.5} aria-hidden />
              New Episode
            </span>
          ) : atEpisodeLimit ? (
            <span
              className={`${styles.newBtn} ${styles.newBtnDisabled}`}
              title="You're at max episodes for this show"
            >
              <Plus size={18} strokeWidth={2.5} aria-hidden />
              New Episode
            </span>
          ) : (
            <Link to={`/podcasts/${id}/episodes/new`} className={styles.newBtn}>
              <Plus size={18} strokeWidth={2.5} aria-hidden />
              New Episode
            </Link>
          )}
        </div>
        <div className={styles.summary}>
          <span className={styles.summaryItem}>
            <span className={styles.summaryCount}>{publishedCount}</span>
            <span className={styles.summaryLabel}>Published</span>
          </span>
          <span className={styles.summaryItem}>
            <span className={styles.summaryCount}>{scheduledCount}</span>
            <span className={styles.summaryLabel}>Scheduled</span>
          </span>
          <span className={styles.summaryItem}>
            <span className={styles.summaryCount}>{draftCount}</span>
            <span className={styles.summaryLabel}>Draft</span>
          </span>
        </div>
        {episodesLoading && (
          <p className={styles.muted}>
            <InlineLoading label="Loading episodes" />
          </p>
        )}
        {!episodesLoading && episodes.length === 0 && (
          <div className={styles.empty}>
            <p>No episodes yet.</p>
            {readOnly ? (
              <span className={`${styles.emptyLink} ${styles.emptyLinkDisabled}`} title="Read-only account">
                Create first episode
              </span>
            ) : atEpisodeLimit ? (
              <span
                className={`${styles.emptyLink} ${styles.emptyLinkDisabled}`}
                title="You're at max episodes for this show"
              >
                Create first episode
              </span>
            ) : (
              <Link to={`/podcasts/${id}/episodes/new`} className={styles.emptyLink}>
                Create first episode
              </Link>
            )}
          </div>
        )}
        {!episodesLoading && episodes.length > 0 && (
          <ul className={styles.list}>
            {episodes.map((ep) => (
              <li key={ep.id} className={styles.item}>
                <Link to={`/episodes/${ep.id}`} className={styles.itemLink} aria-label={`Open ${ep.title}`}>
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
                  <ChevronRight className={styles.itemChevron} size={20} strokeWidth={2} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

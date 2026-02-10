import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Settings, List, Mic2, Radio, Rss, ArrowUpRight } from 'lucide-react';
import { listPodcasts, listPodcastsForUser } from '../api/podcasts';
import { getUser } from '../api/users';
import { me } from '../api/auth';
import { EditShowDetailsDialog } from './EditShowDetailsDialog';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const { userId } = useParams<{ userId?: string }>();
  const [editingPodcastId, setEditingPodcastId] = useState<string | null>(null);
  const isAdminView = Boolean(userId);
  const { data: selectedUser } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => getUser(userId!),
    enabled: !!userId,
  });
  const { data, isLoading, isError } = useQuery({
    queryKey: ['podcasts', userId],
    queryFn: () => (userId ? listPodcastsForUser(userId) : listPodcasts()).then((r) => r.podcasts),
  });
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: me,
    enabled: !isAdminView,
  });
  const maxPodcasts = meData?.user?.max_podcasts ?? null;
  const podcastCount = meData?.podcast_count ?? 0;
  const atPodcastLimit = !isAdminView && maxPodcasts != null && maxPodcasts > 0 && podcastCount >= maxPodcasts;

  const podcasts = data ?? [];

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>
            {isAdminView ? `Podcasts (${selectedUser?.email ?? userId})` : 'Your shows'}
          </h1>
          <p className={styles.subtitle}>
            {podcasts.length > 0
              ? `${podcasts.length} show${podcasts.length === 1 ? '' : 's'} · Manage and publish episodes`
              : 'Manage your shows and publish episodes'}
          </p>
        </div>
        {!isAdminView && (
          atPodcastLimit ? (
            <span
              className={`${styles.createBtn} ${styles.createBtnDisabled}`}
              title="You're at max shows"
            >
              <Plus size={18} strokeWidth={2.5} />
              New show
            </span>
          ) : (
            <Link to="/podcasts/new" className={styles.createBtn}>
              <Plus size={18} strokeWidth={2.5} />
              New show
            </Link>
          )
        )}
      </header>

      {isLoading && (
        <div className={styles.loading}>
          <div className={styles.loadingSpinner}></div>
          <p>Loading…</p>
        </div>
      )}

      {isError && (
        <div className={styles.errorState}>
          <p className={styles.errorTitle}>Failed to load podcasts</p>
          <p className={styles.errorMessage}>Please try refreshing the page.</p>
        </div>
      )}

      {!isLoading && !isError && podcasts.length === 0 && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Radio size={40} strokeWidth={1.5} />
          </div>
          <h2 className={styles.emptyTitle}>No podcasts yet</h2>
          <p className={styles.emptyMessage}>
            Create your first show to get started publishing episodes.
          </p>
          {!isAdminView && (
            atPodcastLimit ? (
              <span
                className={`${styles.emptyBtn} ${styles.emptyBtnDisabled}`}
                title="You're at max shows"
              >
                <Plus size={18} strokeWidth={2.5} />
                Create Your First Show
              </span>
            ) : (
              <Link to="/podcasts/new" className={styles.emptyBtn}>
                <Plus size={18} strokeWidth={2.5} />
                Create Your First Show
              </Link>
            )
          )}
        </div>
      )}

      {!isLoading && !isError && podcasts.length > 0 && (
        <div className={styles.grid}>
          {podcasts.map((p) => (
            <article key={p.id} className={styles.card}>
              <Link to={`/podcasts/${p.id}`} className={styles.cardLink}>
                <div className={styles.cardArtworkWrapper}>
                  {p.artwork_url || p.artwork_filename ? (
                    <img
                      src={p.artwork_url ?? (p.artwork_filename ? `/api/public/artwork/${p.id}/${encodeURIComponent(p.artwork_filename)}` : '')}
                      alt=""
                      className={styles.cardArtwork}
                    />
                  ) : (
                    <div className={styles.cardArtworkPlaceholder}>
                      <Radio size={32} strokeWidth={1.5} />
                    </div>
                  )}
                </div>
                <div className={styles.cardBody}>
                  <h2 className={styles.cardTitle}>{p.title}</h2>
                  <p className={styles.cardSlug}>{p.slug}</p>
                  {p.description && (
                    <p className={styles.cardDesc}>
                      {p.description.slice(0, 120)}{p.description.length > 120 ? '…' : ''}
                    </p>
                  )}
                </div>
                <span className={styles.cardArrow}>
                  <ArrowUpRight size={18} strokeWidth={2} aria-hidden="true" />
                </span>
              </Link>
              <div className={styles.cardFooter}>
                <div className={styles.cardActions}>
                  <Link
                    to={`/feed/${p.slug}`}
                    className={styles.cardAction}
                    aria-label={`RSS feed for ${p.title}`}
                  >
                    <Rss size={16} strokeWidth={2} aria-hidden />
                    <span className={styles.cardActionLabel}>Feed</span>
                  </Link>
                  {!isAdminView && (
                    <button
                      type="button"
                      className={styles.cardSettings}
                      aria-label={`Edit show settings for ${p.title}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setEditingPodcastId(p.id);
                      }}
                    >
                      <Settings size={16} strokeWidth={2} aria-hidden />
                      <span className={styles.cardActionLabel}>Settings</span>
                    </button>
                  )}
                  <Link
                    to={`/podcasts/${p.id}/episodes`}
                    className={styles.cardAction}
                    aria-label={`Episodes for ${p.title}`}
                  >
                    <List size={16} strokeWidth={2} aria-hidden />
                    <span className={styles.cardActionLabel}>Episodes</span>
                  </Link>
                  {!isAdminView && (
                    (() => {
                      const maxEp = p.max_episodes ?? null;
                      const epCount = Number(p.episode_count ?? 0);
                      const atLimit = maxEp != null && maxEp > 0 && epCount >= Number(maxEp);
                      return atLimit ? (
                        <span
                          className={`${styles.cardActionPrimary} ${styles.cardActionPrimaryDisabled}`}
                          title="You're at max episodes for this show"
                          aria-label="New episode (at limit)"
                        >
                          <Mic2 size={16} strokeWidth={2} aria-hidden />
                          <span className={styles.cardActionLabel}>New episode</span>
                        </span>
                      ) : (
                        <Link
                          to={`/podcasts/${p.id}/episodes/new`}
                          className={styles.cardActionPrimary}
                          aria-label={`Create new episode for ${p.title}`}
                        >
                          <Mic2 size={16} strokeWidth={2} aria-hidden />
                          <span className={styles.cardActionLabel}>New episode</span>
                        </Link>
                      );
                    })()
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editingPodcastId != null && (
        <EditShowDetailsDialog
          open
          podcastId={editingPodcastId}
          onClose={() => setEditingPodcastId(null)}
        />
      )}
    </div>
  );
}

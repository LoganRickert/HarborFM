import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Settings, List, Mic2, Radio, Rss, ArrowUpRight } from 'lucide-react';
import { listPodcasts, listPodcastsForUser } from '../api/podcasts';
import { getUser } from '../api/users';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const { userId } = useParams<{ userId?: string }>();
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

  const podcasts = data ?? [];

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {isAdminView ? `Podcasts (${selectedUser?.email ?? userId})` : 'Podcasts'}
          </h1>
          <p className={styles.subtitle}>
            Manage your shows and publish episodes
          </p>
        </div>
        {!isAdminView && (
          <Link to="/podcasts/new" className={styles.createBtn}>
            <Plus size={18} strokeWidth={2.5} />
            New Show
          </Link>
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
            <Link to="/podcasts/new" className={styles.emptyBtn}>
              <Plus size={18} strokeWidth={2.5} />
              Create Your First Show
            </Link>
          )}
        </div>
      )}

      {!isLoading && !isError && podcasts.length > 0 && (
        <div className={styles.list}>
          {podcasts.map((p) => (
            <article key={p.id} className={styles.card}>
              <div className={styles.cardMain}>
                <div className={styles.cardArtworkWrapper}>
                  {p.artwork_url ? (
                    <img src={p.artwork_url} alt={`${p.title} artwork`} className={styles.cardArtwork} />
                  ) : (
                    <div className={styles.cardArtworkPlaceholder}>
                      <Radio size={28} strokeWidth={1.5} />
                    </div>
                  )}
                </div>
                <div className={styles.cardContent}>
                  <div className={styles.cardHeader}>
                    <Link to={`/podcasts/${p.id}`} className={styles.cardTitleLink}>
                      <h2 className={styles.cardTitle}>{p.title}</h2>
                      <ArrowUpRight className={styles.cardTitleIcon} size={16} strokeWidth={2} aria-hidden="true" />
                    </Link>
                    {!isAdminView && (
                      <Link 
                        to={`/podcasts/${p.id}?edit=true`} 
                        className={styles.cardSettings}
                        aria-label={`Edit settings for ${p.title}`}
                      >
                        <Settings size={18} strokeWidth={2} />
                      </Link>
                    )}
                  </div>
                  <p className={styles.cardSlug}>{p.slug}</p>
                  {p.description && (
                    <p className={styles.cardDesc}>
                      {p.description.slice(0, 150)}{p.description.length > 150 ? '…' : ''}
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.cardFooter}>
                {(p.author_name || p.category_primary) && (
                  <span className={styles.cardMeta}>
                    {[p.author_name, p.category_primary].filter(Boolean).join(' · ')}
                  </span>
                )}
                <div className={styles.cardActions}>
                  <Link 
                    to={`/feed/${p.slug}`} 
                    className={styles.cardAction}
                  >
                    <Rss size={16} strokeWidth={2} />
                    Feed
                  </Link>
                  <Link 
                    to={`/podcasts/${p.id}/episodes`} 
                    className={styles.cardAction}
                  >
                    <List size={16} strokeWidth={2} />
                    Episodes
                  </Link>
                  {!isAdminView && (
                    <Link 
                      to={`/podcasts/${p.id}/episodes/new`} 
                      className={styles.cardActionPrimary}
                    >
                      <Mic2 size={16} strokeWidth={2} />
                      New Episode
                    </Link>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

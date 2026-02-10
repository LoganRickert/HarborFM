import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPodcast } from '../api/podcasts';
import { me } from '../api/auth';
import { Breadcrumb } from '../components/Breadcrumb';
import styles from './PodcastNew.module.css';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function PodcastNew() {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const maxPodcasts = meData?.user?.max_podcasts ?? null;
  const podcastCount = meData?.podcast_count ?? 0;
  const atPodcastLimit = maxPodcasts != null && maxPodcasts > 0 && podcastCount >= maxPodcasts;

  const mutation = useMutation({
    mutationFn: () =>
      createPodcast({
        title,
        slug: slug || slugify(title),
        description: description || undefined,
      }),
    onSuccess: (podcast) => {
      queryClient.invalidateQueries({ queryKey: ['podcasts'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(`/podcasts/${podcast.id}`);
    },
  });

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setTitle(v);
    if (!slug || slug === slugify(title)) setSlug(slugify(v));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <div className={styles.page}>
      <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'New show' }]} />
      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>
          New show
          <span className={styles.heroTitleAccent}>Create a podcast</span>
        </h1>
        <p className={styles.heroSub}>
          Give your show a name and a URL-friendly slug. You can add artwork and more details later.
        </p>
      </header>
      <div className={styles.card}>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Title
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              className={styles.input}
              placeholder="e.g. My Podcast"
              required
            />
          </label>
          <label className={styles.label}>
            Slug
            <span className={styles.labelHint}>Used in URLs and feed — lowercase, hyphens only</span>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className={`${styles.input} ${styles.slugInput}`}
              placeholder="my-podcast"
            />
          </label>
          <label className={styles.label}>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={styles.textarea}
              rows={3}
              placeholder="What's your show about? (optional)"
            />
          </label>
          {atPodcastLimit && (
            <p className={styles.error} role="alert">
              You have reached your limit of {maxPodcasts} show{maxPodcasts === 1 ? '' : 's'}. You cannot create more.
            </p>
          )}
          {mutation.isError && (
            <p className={styles.error} role="alert">{mutation.error?.message}</p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancel}
              onClick={() => navigate(-1)}
              aria-label="Cancel creating show"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={mutation.isPending || atPodcastLimit}
              aria-label="Create show"
            >
              {mutation.isPending ? 'Creating…' : 'Create show'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

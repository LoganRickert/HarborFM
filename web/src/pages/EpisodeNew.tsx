import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createEpisode } from '../api/episodes';
import { getPodcast } from '../api/podcasts';
import { me, isReadOnly } from '../api/auth';
import { Breadcrumb } from '../components/Breadcrumb';
import styles from './PodcastNew.module.css';

export function EpisodeNew() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: podcast } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });
  const maxEpisodes = podcast?.max_episodes ?? null;
  const episodeCount = Number(podcast?.episode_count ?? 0);
  const atEpisodeLimit = maxEpisodes != null && maxEpisodes > 0 && episodeCount >= Number(maxEpisodes);
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const readOnly = isReadOnly(meData?.user);
  useEffect(() => {
    if (readOnly && id) navigate(`/podcasts/${id}/episodes`, { replace: true });
  }, [readOnly, id, navigate]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      createEpisode(id!, {
        title,
        description: description || undefined,
        status: 'draft',
      }),
    onSuccess: (ep) => {
      queryClient.invalidateQueries({ queryKey: ['episodes', id] });
      queryClient.invalidateQueries({ queryKey: ['podcast', id] });
      navigate(`/episodes/${ep.id}`);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    mutation.mutate();
  }

  if (!id) return null;

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: podcast?.title ?? 'Show', href: `/podcasts/${id}`, mobileLabel: 'Podcast' },
    { label: 'Episodes', href: `/podcasts/${id}/episodes` },
    { label: 'New episode', hideOnMobile: true },
  ];

  return (
    <div className={styles.page}>
      <Breadcrumb items={breadcrumbItems} />
      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>
          New episode
          <span className={styles.heroTitleAccent}>Add an episode to your show</span>
        </h1>
        <p className={styles.heroSub}>
          Give your episode a title. You can add a description, audio, and schedule in the editor after creating it.
        </p>
      </header>
      <div className={styles.card}>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={styles.input}
              placeholder="e.g. Episode 1: Getting started"
              required
            />
          </label>
          <label className={styles.label}>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={styles.textarea}
              rows={3}
              placeholder="What's this episode about? (optional)"
            />
          </label>
          {atEpisodeLimit && (
            <p className={styles.error} role="alert">
              This show has reached its limit of {maxEpisodes} episode{maxEpisodes === 1 ? '' : 's'}. You cannot create more.
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
              aria-label="Cancel creating episode"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={mutation.isPending || atEpisodeLimit || readOnly}
              aria-label="Create episode"
            >
              {mutation.isPending ? 'Creating...' : 'Create episode'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

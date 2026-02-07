import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { createEpisode } from '../api/episodes';
import { getPodcast } from '../api/podcasts';
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
      navigate(`/episodes/${ep.id}`);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  if (!id) return null;

  return (
    <div className={styles.page}>
      <Link to={`/podcasts/${id}/episodes`} className={styles.back}>
        ← {podcast?.title ?? 'Episodes'}
      </Link>
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
            <button type="submit" className={styles.submit} disabled={mutation.isPending} aria-label="Create episode">
              {mutation.isPending ? 'Creating…' : 'Create episode'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

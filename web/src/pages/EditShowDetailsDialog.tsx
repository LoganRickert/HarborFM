import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAuthStore } from '../store/auth';
import { getPodcast, updatePodcast, type Podcast } from '../api/podcasts';
import styles from './PodcastSettings.module.css';

export interface EditShowDetailsDialogProps {
  open: boolean;
  podcastId: string | null;
  onClose: () => void;
}

export function EditShowDetailsDialog({ open, podcastId, onClose }: EditShowDetailsDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { data: podcast, isLoading } = useQuery({
    queryKey: ['podcast', podcastId],
    queryFn: () => getPodcast(podcastId!),
    enabled: open && !!podcastId,
  });

  const [form, setForm] = useState<Partial<Podcast>>({});
  const formRef = useRef(form);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    if (podcast) {
      setForm({
        ...podcast,
        artwork_url: podcast.artwork_url ?? null,
      });
    }
  }, [podcast]);

  useEffect(() => {
    if (open && podcast) {
      setForm({
        ...podcast,
        artwork_url: podcast.artwork_url ?? null,
      });
    }
  }, [open, podcast]);

  const mutation = useMutation({
    mutationFn: (payload: Partial<Podcast>) => updatePodcast(podcastId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast', podcastId] });
      queryClient.invalidateQueries({ queryKey: ['podcasts'] });
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const currentForm = formRef.current;
    const payload: Partial<Podcast> = {
      title: currentForm.title,
      slug: currentForm.slug,
      description: currentForm.description,
      language: currentForm.language,
      author_name: currentForm.author_name,
      owner_name: currentForm.owner_name,
      email: currentForm.email,
      category_primary: currentForm.category_primary,
      category_secondary: currentForm.category_secondary,
      category_tertiary: currentForm.category_tertiary,
      explicit: currentForm.explicit,
      site_url: currentForm.site_url,
      artwork_url: currentForm.artwork_url !== undefined ? currentForm.artwork_url : null,
      copyright: currentForm.copyright,
      podcast_guid: currentForm.podcast_guid,
      locked: currentForm.locked,
      license: currentForm.license,
      itunes_type: currentForm.itunes_type,
      medium: currentForm.medium,
    };
    mutation.mutate(payload);
  }

  if (!open || !podcastId) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={`${styles.dialogContent} ${styles.dialogContentWide}`}>
          <Dialog.Close asChild>
            <button
              type="button"
              className={styles.dialogClose}
              aria-label="Close"
              disabled={mutation.isPending}
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </Dialog.Close>
          <Dialog.Title className={styles.dialogTitle}>Edit show details</Dialog.Title>
          <Dialog.Description className={styles.dialogDescription}>
            Update the podcast title, slug, and other feed details.
          </Dialog.Description>
          <div className={styles.dialogBodyScroll}>
            {isLoading && !podcast ? (
              <p style={{ padding: '1.5rem', color: 'var(--text-muted)', margin: 0 }}>Loading…</p>
            ) : podcast ? (
              <form onSubmit={handleSubmit} className={styles.form}>
                <label className={styles.label}>
                  Title
                  <input
                    type="text"
                    value={form.title ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className={styles.input}
                    required
                  />
                </label>
                <label className={styles.label}>
                  Slug
                  <input
                    type="text"
                    value={form.slug ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                    className={styles.input}
                    disabled={user?.role !== 'admin'}
                  />
                </label>
                <label className={styles.label}>
                  Description
                  <textarea
                    value={form.description ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className={styles.textarea}
                    rows={3}
                  />
                </label>
                <label className={styles.label}>
                  Author name
                  <input
                    type="text"
                    value={form.author_name ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, author_name: e.target.value }))}
                    className={styles.input}
                  />
                </label>
                <label className={styles.label}>
                  Owner name
                  <input
                    type="text"
                    value={form.owner_name ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, owner_name: e.target.value }))}
                    className={styles.input}
                  />
                </label>
                <label className={styles.label}>
                  Email
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className={styles.input}
                  />
                </label>
                <label className={styles.label}>
                  Primary category
                  <input
                    type="text"
                    value={form.category_primary ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, category_primary: e.target.value }))}
                    className={styles.input}
                    placeholder="e.g. Technology"
                  />
                </label>
                <label className={styles.label}>
                  Secondary category
                  <input
                    type="text"
                    value={form.category_secondary ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, category_secondary: e.target.value || null }))}
                    className={styles.input}
                    placeholder="e.g. Technology News"
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                    Nested under primary category in iTunes
                  </p>
                </label>
                <label className={styles.label}>
                  Tertiary category
                  <input
                    type="text"
                    value={form.category_tertiary ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, category_tertiary: e.target.value || null }))}
                    className={styles.input}
                    placeholder="e.g. Arts"
                  />
                </label>
                <label className={styles.label}>
                  Copyright
                  <input
                    type="text"
                    value={form.copyright ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, copyright: e.target.value || null }))}
                    className={styles.input}
                    placeholder="e.g. Copyright 2026"
                  />
                </label>
                <label className={styles.label}>
                  Podcast GUID
                  <input
                    type="text"
                    value={form.podcast_guid ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, podcast_guid: e.target.value || null }))}
                    className={styles.input}
                    placeholder="UUID (optional)"
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                    Unique identifier for your podcast feed
                  </p>
                </label>
                <label className={styles.label}>
                  License
                  <input
                    type="text"
                    value={form.license ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, license: e.target.value || null }))}
                    className={styles.input}
                    placeholder="e.g. All rights reserved"
                  />
                </label>
                <label className={styles.label}>
                  iTunes Type
                  <div className={styles.statusToggle} role="group" aria-label="iTunes type">
                    {(['episodic', 'serial'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={(form.itunes_type ?? 'episodic') === t ? styles.statusToggleActive : styles.statusToggleBtn}
                        onClick={() => setForm((f) => ({ ...f, itunes_type: t }))}
                        aria-pressed={(form.itunes_type ?? 'episodic') === t}
                      >
                        {t === 'episodic' ? 'Episodic' : 'Serial'}
                      </button>
                    ))}
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                    Episodic: episodes can be listened to in any order. Serial: episodes should be listened to in order.
                  </p>
                </label>
                <label className={styles.label}>
                  Medium
                  <select
                    value={form.medium ?? 'podcast'}
                    onChange={(e) => setForm((f) => ({ ...f, medium: e.target.value as 'podcast' | 'music' | 'video' | 'film' | 'audiobook' | 'newsletter' | 'blog' }))}
                    className={styles.input}
                  >
                    <option value="podcast">Podcast</option>
                    <option value="music">Music</option>
                    <option value="video">Video</option>
                    <option value="film">Film</option>
                    <option value="audiobook">Audiobook</option>
                    <option value="newsletter">Newsletter</option>
                    <option value="blog">Blog</option>
                  </select>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={!!form.locked}
                    onChange={(e) => setForm((f) => ({ ...f, locked: e.target.checked ? 1 : 0 }))}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Locked (prevent other platforms from importing)</span>
                </label>
                <label className={styles.label}>
                  Cover Image URL
                  <input
                    type="text"
                    value={form.artwork_url ?? ''}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      setForm((f) => ({ ...f, artwork_url: value === '' ? null : value }));
                    }}
                    className={styles.input}
                    placeholder="https://example.com/image.jpg"
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                    URL for the podcast cover image (optional)
                  </p>
                </label>
                <label className={styles.label}>
                  Site URL
                  <input
                    type="url"
                    value={form.site_url ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, site_url: e.target.value || null }))}
                    className={styles.input}
                  />
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={!!form.explicit}
                    onChange={(e) => setForm((f) => ({ ...f, explicit: e.target.checked ? 1 : 0 }))}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Explicit</span>
                </label>
                {mutation.isError && (
                  <p className={styles.error}>
                    {mutation.error instanceof Error
                      ? mutation.error.message
                      : JSON.stringify(mutation.error)}
                  </p>
                )}
                {mutation.isSuccess && (
                  <p className={styles.success}>Saved.</p>
                )}
                <div className={styles.actions}>
                  <button type="button" className={styles.cancel} onClick={onClose} aria-label="Cancel editing show">
                    Cancel
                  </button>
                  <button type="submit" className={styles.submit} disabled={mutation.isPending} aria-label="Save show changes">
                    {mutation.isPending ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { getPodcast, updatePodcast, type Podcast } from '../api/podcasts';
import styles from '../components/PodcastDetail/shared.module.css';

export interface EditSocialLinksDialogProps {
  open: boolean;
  podcastId: string | null;
  onClose: () => void;
}

const LINK_FIELDS = [
  { key: 'apple_podcasts_url' as const, label: 'Apple Podcasts' },
  { key: 'spotify_url' as const, label: 'Spotify' },
  { key: 'amazon_music_url' as const, label: 'Amazon Music' },
  { key: 'podcast_index_url' as const, label: 'Podcast Index' },
  { key: 'listen_notes_url' as const, label: 'Listen Notes' },
  { key: 'castbox_url' as const, label: 'Castbox' },
  { key: 'x_url' as const, label: 'X' },
  { key: 'facebook_url' as const, label: 'Facebook' },
  { key: 'instagram_url' as const, label: 'Instagram' },
  { key: 'tiktok_url' as const, label: 'TikTok' },
  { key: 'youtube_url' as const, label: 'YouTube' },
] as const;

export function EditSocialLinksDialog({ open, podcastId, onClose }: EditSocialLinksDialogProps) {
  const queryClient = useQueryClient();
  const { data: podcast, isLoading } = useQuery({
    queryKey: ['podcast', podcastId],
    queryFn: () => getPodcast(podcastId!),
    enabled: open && !!podcastId,
  });

  const [form, setForm] = useState<Partial<Pick<Podcast, (typeof LINK_FIELDS)[number]['key']>>>({});

  useEffect(() => {
    if (open && podcast) {
      const initial: Record<string, string | null> = {};
      for (const { key } of LINK_FIELDS) {
        initial[key] = podcast[key] ?? null;
      }
      setForm(initial);
    }
  }, [open, podcast]);

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof updatePodcast>[1]) => updatePodcast(podcastId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast', podcastId] });
      queryClient.invalidateQueries({ queryKey: ['podcasts'] });
      queryClient.invalidateQueries({ queryKey: ['public-podcast'] });
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, string | null> = {};
    for (const { key } of LINK_FIELDS) {
      const val = form[key];
      payload[key] = (val?.trim() || null) ?? null;
    }
    mutation.mutate(payload);
  }

  if (!open || !podcastId) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentScrollable}`}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Edit Links</Dialog.Title>
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
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            Add links to your podcast on listening platforms and social media. Leave blank to hide.
          </Dialog.Description>
          <div className={styles.dialogBodyScroll}>
            {isLoading && !podcast ? (
              <p style={{ padding: '1.5rem', color: 'var(--text-muted)', margin: 0 }}>Loading...</p>
            ) : (
              <form id="edit-social-links-form" onSubmit={handleSubmit} className={styles.form}>
                <h3 className={styles.dialogSectionTitle}>Listen on</h3>
                {LINK_FIELDS.slice(0, 6).map(({ key, label }) => (
                  <label key={key} className={styles.label}>
                    {label}
                    <input
                      type="url"
                      value={form[key] ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      className={styles.input}
                      placeholder={`https://...`}
                    />
                  </label>
                ))}
                <h3 className={styles.dialogSectionTitle} style={{ marginTop: '1.5rem' }}>
                  Follow
                </h3>
                {LINK_FIELDS.slice(6).map(({ key, label }) => (
                  <label key={key} className={styles.label}>
                    {label}
                    <input
                      type="url"
                      value={form[key] ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      className={styles.input}
                      placeholder={`https://...`}
                    />
                  </label>
                ))}
              </form>
            )}
          </div>
          {podcast && (
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.cancel} onClick={onClose} disabled={mutation.isPending} aria-label="Cancel">
                Cancel
              </button>
              <button type="submit" form="edit-social-links-form" className={styles.submit} disabled={mutation.isPending} aria-label="Save links">
                {mutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { getPodcast, updatePodcast, type Podcast } from '../api/podcasts';
import type { PodcastUpdate } from '@harborfm/shared';
import styles from '../components/PodcastDetail/shared.module.css';

export interface EditSocialLinksDialogProps {
  open: boolean;
  podcastId: string | null;
  onClose: () => void;
}

const LINK_FIELDS = [
  { key: 'applePodcastsUrl' as const, label: 'Apple Podcasts' },
  { key: 'spotifyUrl' as const, label: 'Spotify' },
  { key: 'amazonMusicUrl' as const, label: 'Amazon Music' },
  { key: 'podcastIndexUrl' as const, label: 'Podcast Index' },
  { key: 'listenNotesUrl' as const, label: 'Listen Notes' },
  { key: 'castboxUrl' as const, label: 'Castbox' },
  { key: 'xUrl' as const, label: 'X' },
  { key: 'facebookUrl' as const, label: 'Facebook' },
  { key: 'instagramUrl' as const, label: 'Instagram' },
  { key: 'tiktokUrl' as const, label: 'TikTok' },
  { key: 'youtubeUrl' as const, label: 'YouTube' },
  { key: 'discordUrl' as const, label: 'Discord' },
] as const;

export function EditSocialLinksDialog({ open, podcastId, onClose }: EditSocialLinksDialogProps) {
  const queryClient = useQueryClient();
  const { data: podcast, isLoading } = useQuery({
    queryKey: ['podcast', podcastId],
    queryFn: () => getPodcast(podcastId!),
    enabled: open && !!podcastId,
  });

  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && podcast) {
      const initial: Record<string, string> = {};
      for (const { key } of LINK_FIELDS) {
        const val = podcast[key as keyof Podcast];
        initial[key] = val != null ? String(val) : '';
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
    const payload: PodcastUpdate = {};
    for (const { key } of LINK_FIELDS) {
      const val = form[key];
      payload[key] = val?.trim() || null;
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
            <Dialog.Title className={styles.dialogTitle}>Platform &amp; Social Links</Dialog.Title>
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
            <div className={`${styles.dialogFooter} ${styles.dialogFooterCancelLeft}`}>
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

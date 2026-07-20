import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { getPodcast, updatePodcast } from '../api/podcasts';
import { listBuiltinThemes, listThemes } from '../api/themes';
import type { FeedAccent, PodcastUpdate } from '@harborfm/shared';
import { UnsavedChangesConfirmDialog } from '../components/UnsavedChangesConfirmDialog';
import { useDialogCloseGuard } from '../hooks/useDialogCloseGuard';
import { useBaselineDirty, snapshotForDirty } from '../hooks/useBaselineDirty';
import { FEED_ACCENT_OPTIONS, isFeedAccent } from '../utils/feedAccent';
import styles from '../components/PodcastDetail/shared.module.css';
import localStyles from './EditPageCustomizationsDialog.module.css';

export interface EditPageCustomizationsDialogProps {
  open: boolean;
  podcastId: string | null;
  onClose: () => void;
}

type FormState = {
  feedTheme: string;
  feedAccent: FeedAccent;
  feedShowPodcastDescription: boolean;
  feedShowEpisodeDescription: boolean;
  feedShowFunding: boolean;
  feedShowReviewsPodcast: boolean;
  feedShowReviewsEpisode: boolean;
  feedShowAuthor: boolean;
  feedShowPodroll: boolean;
  feedShowCast: boolean;
};

const DEFAULT_FORM: FormState = {
  feedTheme: 'default',
  feedAccent: 'green',
  feedShowPodcastDescription: true,
  feedShowEpisodeDescription: true,
  feedShowFunding: true,
  feedShowReviewsPodcast: true,
  feedShowReviewsEpisode: true,
  feedShowAuthor: true,
  feedShowPodroll: true,
  feedShowCast: true,
};

function asBool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null) return fallback;
  return v === true || v === 1;
}

export function EditPageCustomizationsDialog({
  open,
  podcastId,
  onClose,
}: EditPageCustomizationsDialogProps) {
  const queryClient = useQueryClient();
  const { data: podcast, isLoading } = useQuery({
    queryKey: ['podcast', podcastId],
    queryFn: () => getPodcast(podcastId!),
    enabled: open && !!podcastId,
  });

  const { data: themesData } = useQuery({
    queryKey: ['themes'],
    queryFn: listThemes,
    enabled: open,
    staleTime: 60_000,
  });

  const { data: builtinsData } = useQuery({
    queryKey: ['themes', 'builtins'],
    queryFn: listBuiltinThemes,
    enabled: open,
    staleTime: 60_000,
  });

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [formBaseline, setFormBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (open && podcast) {
      const accentRaw = typeof podcast.feedAccent === 'string' ? podcast.feedAccent : 'green';
      const themeRaw =
        typeof podcast.feedTheme === 'string' && podcast.feedTheme.trim()
          ? podcast.feedTheme.trim()
          : 'default';
      const initial: FormState = {
        feedTheme: themeRaw,
        feedAccent: isFeedAccent(accentRaw) ? accentRaw : 'green',
        feedShowPodcastDescription: asBool(podcast.feedShowPodcastDescription, true),
        feedShowEpisodeDescription: asBool(podcast.feedShowEpisodeDescription, true),
        feedShowFunding: asBool(podcast.feedShowFunding, true),
        feedShowReviewsPodcast: asBool(podcast.feedShowReviewsPodcast, true),
        feedShowReviewsEpisode: asBool(podcast.feedShowReviewsEpisode, true),
        feedShowAuthor: asBool(podcast.feedShowAuthor, true),
        feedShowPodroll: asBool(podcast.feedShowPodroll, true),
        feedShowCast: asBool(podcast.feedShowCast, true),
      };
      setForm(initial);
      setFormBaseline(snapshotForDirty(initial));
    }
  }, [open, podcast]);

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof updatePodcast>[1]) =>
      updatePodcast(podcastId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast', podcastId] });
      queryClient.invalidateQueries({ queryKey: ['podcasts'] });
      queryClient.invalidateQueries({ queryKey: ['public-podcast'] });
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: PodcastUpdate = {
      feedTheme: form.feedTheme,
      feedAccent: form.feedAccent,
      feedShowPodcastDescription: form.feedShowPodcastDescription,
      feedShowEpisodeDescription: form.feedShowEpisodeDescription,
      feedShowFunding: form.feedShowFunding,
      feedShowReviewsPodcast: form.feedShowReviewsPodcast,
      feedShowReviewsEpisode: form.feedShowReviewsEpisode,
      feedShowAuthor: form.feedShowAuthor,
      feedShowPodroll: form.feedShowPodroll,
      feedShowCast: form.feedShowCast,
    };
    mutation.mutate(payload);
  }

  const isDirty = useBaselineDirty(formBaseline, form);
  const {
    confirmOpen,
    requestClose,
    onOpenChange,
    handleConfirmOpenChange,
    handleDiscard,
    dialogContentProps,
  } = useDialogCloseGuard({ isDirty, onClose });

  if (!open || !podcastId) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentScrollable}`}
          onPointerDownOutside={(e) => {
            e.preventDefault();
            dialogContentProps.onPointerDownOutside(e);
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
            dialogContentProps.onInteractOutside(e);
          }}
          onEscapeKeyDown={dialogContentProps.onEscapeKeyDown}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Page Customizations</Dialog.Title>
            <button
              type="button"
              className={styles.dialogClose}
              aria-label="Close"
              disabled={mutation.isPending}
              onClick={requestClose}
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            Customize how your public podcast and episode feed pages look and what they show.
          </Dialog.Description>
          <div className={styles.dialogBodyScroll}>
            {isLoading && !podcast ? (
              <p style={{ padding: '1.5rem', color: 'var(--text-muted)', margin: 0 }}>
                Loading...
              </p>
            ) : (
              <form
                id="edit-page-customizations-form"
                onSubmit={handleSubmit}
                className={localStyles.form}
              >
                <h3 className={localStyles.sectionTitle}>Appearance</h3>
                <div className={localStyles.selectField}>
                  <label className={localStyles.selectLabel} htmlFor="feed-theme-select">
                    Page Theme
                  </label>
                  <select
                    id="feed-theme-select"
                    className={localStyles.select}
                    value={form.feedTheme}
                    onChange={(e) => setForm((f) => ({ ...f, feedTheme: e.target.value }))}
                  >
                    <option value="default">Default HarborFM</option>
                    {(builtinsData?.builtins ?? []).map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.name}
                      </option>
                    ))}
                    {(themesData?.themes ?? []).map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.name} (v{theme.version})
                      </option>
                    ))}
                    </select>
                </div>
                <div className={localStyles.accentField}>
                  <span className={localStyles.accentLabel} id="primary-color-label">
                    Primary Color
                  </span>
                  <div
                    className={localStyles.accentGrid}
                    role="radiogroup"
                    aria-labelledby="primary-color-label"
                  >
                    {FEED_ACCENT_OPTIONS.map((opt) => {
                      const selected = form.feedAccent === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={opt.label}
                          className={`${localStyles.accentOption}${
                            selected ? ` ${localStyles.accentOptionSelected}` : ''
                          }`}
                          onClick={() => setForm((f) => ({ ...f, feedAccent: opt.id }))}
                        >
                          <span
                            className={localStyles.accentSwatch}
                            style={{ background: opt.colors.accent }}
                            aria-hidden
                          />
                          <span className={localStyles.accentName}>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <h3 className={localStyles.sectionTitleSpaced}>Public feed visibility</h3>
                <ToggleRow
                  label="Show Author"
                  checked={form.feedShowAuthor}
                  onChange={(feedShowAuthor) => setForm((f) => ({ ...f, feedShowAuthor }))}
                />
                <ToggleRow
                  label="Show Podcast Description"
                  checked={form.feedShowPodcastDescription}
                  onChange={(feedShowPodcastDescription) =>
                    setForm((f) => ({ ...f, feedShowPodcastDescription }))
                  }
                />
                <ToggleRow
                  label="Show Episode Description"
                  checked={form.feedShowEpisodeDescription}
                  onChange={(feedShowEpisodeDescription) =>
                    setForm((f) => ({ ...f, feedShowEpisodeDescription }))
                  }
                />
                <ToggleRow
                  label="Show Support The Show Panel"
                  checked={form.feedShowFunding}
                  onChange={(feedShowFunding) => setForm((f) => ({ ...f, feedShowFunding }))}
                />
                <ToggleRow
                  label="Show Recommended Podcasts"
                  checked={form.feedShowPodroll}
                  onChange={(feedShowPodroll) => setForm((f) => ({ ...f, feedShowPodroll }))}
                />
                <ToggleRow
                  label="Show Cast"
                  checked={form.feedShowCast}
                  onChange={(feedShowCast) => setForm((f) => ({ ...f, feedShowCast }))}
                />
                <ToggleRow
                  label="Show Reviews On Podcast Feed"
                  checked={form.feedShowReviewsPodcast}
                  onChange={(feedShowReviewsPodcast) =>
                    setForm((f) => ({ ...f, feedShowReviewsPodcast }))
                  }
                />
                <ToggleRow
                  label="Show Reviews On Episode Feed"
                  checked={form.feedShowReviewsEpisode}
                  onChange={(feedShowReviewsEpisode) =>
                    setForm((f) => ({ ...f, feedShowReviewsEpisode }))
                  }
                />
              </form>
            )}
          </div>
          {podcast && (
            <div className={`${styles.dialogFooter} ${styles.dialogFooterCancelLeft}`}>
              <button
                type="button"
                className={styles.cancel}
                onClick={requestClose}
                disabled={mutation.isPending}
                aria-label="Cancel"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="edit-page-customizations-form"
                className={styles.submit}
                disabled={mutation.isPending}
                aria-label="Save page customizations"
              >
                {mutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
      <UnsavedChangesConfirmDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        onDiscard={handleDiscard}
      />
    </Dialog.Root>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={`toggle ${localStyles.toggleRow}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

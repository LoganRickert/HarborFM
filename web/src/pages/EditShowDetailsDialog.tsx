import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAuthStore } from '../store/auth';
import type { PodcastUpdate } from '@harborfm/shared';
import { getPodcast, updatePodcast, uploadPodcastArtwork, type Podcast } from '../api/podcasts';
import styles from '../components/PodcastDetail/shared.module.css';

export interface EditShowDetailsDialogProps {
  open: boolean;
  podcastId: string | null;
  onClose: () => void;
}

function safeImageSrc(url: string | null | undefined): string {
  if (!url) return '';
  const s = url.trim();
  if (!s) return '';

  // Explicitly allow same-origin absolute-path URLs without parsing quirks.
  if (s.startsWith('/') && !s.startsWith('//')) return s;

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://x';
    const parsed = new URL(s, base);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol === 'https:' || protocol === 'http:' || protocol === 'blob:') {
      return parsed.href;
    }
  } catch {
    // ignore
  }
  return '';
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
  const [coverMode, setCoverMode] = useState<'url' | 'upload'>('url');
  const [pendingArtworkFile, setPendingArtworkFile] = useState<File | null>(null);
  const [pendingArtworkPreviewUrl, setPendingArtworkPreviewUrl] = useState<string | null>(null);
  const [coverUploadKey, setCoverUploadKey] = useState(0);
  const [debouncedArtworkUrl, setDebouncedArtworkUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [linkDomainError, setLinkDomainError] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

  function resizeTextarea(ta: HTMLTextAreaElement | null) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    resizeTextarea(descriptionRef.current);
    resizeTextarea(summaryRef.current);
  }, [form.description, form.summary, open]);

  useEffect(() => {
    const raw = (form.artwork_url ?? '').trim();
    if (!raw) {
      setDebouncedArtworkUrl('');
      return;
    }
    const t = setTimeout(() => setDebouncedArtworkUrl(raw), 400);
    return () => clearTimeout(t);
  }, [form.artwork_url]);

  useEffect(() => {
    if (podcast) {
      setForm({
        ...podcast,
        artwork_url: podcast.artwork_url ?? null,
      });
      setDebouncedArtworkUrl((podcast.artwork_url ?? '').trim());
      setCoverMode(podcast.artwork_filename ? 'upload' : 'url');
      setPendingArtworkFile(null);
    }
  }, [podcast]);

  useEffect(() => {
    if (open && podcast) {
      setForm({
        ...podcast,
        artwork_url: podcast.artwork_url ?? null,
      });
      setDebouncedArtworkUrl((podcast.artwork_url ?? '').trim());
      setPendingArtworkFile(null);
    }
  }, [open, podcast]);

  useEffect(() => {
    if (!pendingArtworkFile) {
      setPendingArtworkPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const url = URL.createObjectURL(pendingArtworkFile);
    setPendingArtworkPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingArtworkFile]);

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof updatePodcast>[1]) => updatePodcast(podcastId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast', podcastId] });
      queryClient.invalidateQueries({ queryKey: ['podcasts'] });
      onClose();
    },
  });

  const uploadArtworkMutation = useMutation({
    mutationFn: (file: File) => uploadPodcastArtwork(podcastId!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast', podcastId] });
      queryClient.invalidateQueries({ queryKey: ['podcasts'] });
      setCoverUploadKey((k) => k + 1);
    },
  });

  useEffect(() => {
    if (!open) {
      mutation.reset();
      uploadArtworkMutation.reset();
      setShowAdvanced(false);
      setLinkDomainError(null);
    }
  }, [open, mutation, uploadArtworkMutation]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const currentForm = formRef.current;
    const fileToUpload = pendingArtworkFile;
    if (fileToUpload) {
      try {
        await uploadArtworkMutation.mutateAsync(fileToUpload);
        setPendingArtworkFile(null);
      } catch {
        return;
      }
    }
    const payload: PodcastUpdate = {
      title: currentForm.title,
      slug: currentForm.slug,
      description: currentForm.description,
      subtitle: currentForm.subtitle ?? null,
      summary: currentForm.summary ?? null,
      language: currentForm.language,
      author_name: currentForm.author_name,
      owner_name: currentForm.owner_name,
      email: currentForm.email,
      category_primary: currentForm.category_primary,
      category_secondary: currentForm.category_secondary,
      category_primary_two: currentForm.category_primary_two,
      category_secondary_two: currentForm.category_secondary_two,
      category_primary_three: currentForm.category_primary_three,
      category_secondary_three: currentForm.category_secondary_three,
      explicit: currentForm.explicit !== undefined ? (currentForm.explicit === 1 ? 1 : 0) : undefined,
      site_url: currentForm.site_url,
      artwork_url: fileToUpload ? null : (currentForm.artwork_url !== undefined ? currentForm.artwork_url : null),
      copyright: currentForm.copyright,
      podcast_guid: currentForm.podcast_guid,
      locked: currentForm.locked !== undefined ? (currentForm.locked === 1 ? 1 : 0) : undefined,
      license: currentForm.license,
      itunes_type: currentForm.itunes_type,
      medium: currentForm.medium,
      funding_url: currentForm.funding_url ?? null,
      funding_label: currentForm.funding_label ?? null,
      persons: currentForm.persons ?? null,
      update_frequency_rrule: currentForm.update_frequency_rrule ?? null,
      update_frequency_label: currentForm.update_frequency_label ?? null,
      spotify_recent_count: currentForm.spotify_recent_count ?? null,
      spotify_country_of_origin: currentForm.spotify_country_of_origin ?? null,
      apple_podcasts_verify: currentForm.apple_podcasts_verify ?? null,
      unlisted: currentForm.unlisted !== undefined ? (currentForm.unlisted === 1 ? 1 : 0) : undefined,
      subscriber_only_feed_enabled: currentForm.subscriber_only_feed_enabled !== undefined ? (currentForm.subscriber_only_feed_enabled === 1 ? 1 : 0) : undefined,
      public_feed_disabled: currentForm.public_feed_disabled !== undefined ? (currentForm.public_feed_disabled === 1 ? 1 : 0) : undefined,
    };
    if (podcast?.my_role === 'owner' && podcast?.dns_config) {
      const dc = podcast.dns_config;
      if (dc.allow_linking_domain && currentForm.link_domain !== undefined) {
        const linkVal = currentForm.link_domain?.trim() || null;
        if (linkVal && (linkVal.toLowerCase().startsWith('http://') || linkVal.toLowerCase().startsWith('https://'))) {
          setLinkDomainError('Use hostname only (no http:// or https://).');
          return;
        }
        payload.link_domain = linkVal;
      }
      // When allow domain is enabled, send form value; when disabled, send null to clear so we don't submit stale managed_domain
      if (dc.allow_domain && currentForm.managed_domain !== undefined) {
        payload.managed_domain = currentForm.managed_domain?.trim() || null;
      } else {
        payload.managed_domain = null;
      }
      // When sub-domain is enabled (allow_sub_domain + default_domain), send form value; otherwise send null to clear
      if (dc.allow_sub_domain && dc.default_domain && currentForm.managed_sub_domain !== undefined) {
        payload.managed_sub_domain = currentForm.managed_sub_domain?.trim() || null;
      } else {
        payload.managed_sub_domain = null;
      }
      // When custom key is enabled, send form value; when disabled, never send a key and send null to clear any stored one
      if (dc.allow_custom_key && currentForm.cloudflare_api_key !== undefined) {
        payload.cloudflare_api_key = currentForm.cloudflare_api_key?.trim() || undefined;
      } else {
        payload.cloudflare_api_key = null;
      }
    }
    setLinkDomainError(null);
    mutation.mutate(payload);
  }

  function generateSecretSlug(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0-9';
    let out = 'private-';
    const arr = new Uint8Array(14);
    crypto.getRandomValues(arr);
    for (let i = 0; i < 14; i++) out += chars[arr[i]! % chars.length];
    return out;
  }

  if (!open || !podcastId) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentScrollable} ${styles.dialogShowDetailsGrid}`}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Edit Podcast Details</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={mutation.isPending || uploadArtworkMutation.isPending}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            Update the podcast title, slug, and other feed details.
          </Dialog.Description>
          <div className={styles.dialogBodyScroll}>
            {isLoading && !podcast ? (
              <p style={{ padding: '1.5rem', color: 'var(--text-muted)', margin: 0 }}>Loading...</p>
            ) : podcast ? (
              <form id="edit-show-details-form" onSubmit={handleSubmit} className={styles.form}>
                <h3 className={styles.dialogSectionTitle}>Basics</h3>
                <label className={styles.label}>
                  Title
                  <input
                    type="text"
                    value={form.title ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className={styles.input}
                    placeholder="e.g. My Awesome Podcast"
                    required
                  />
                </label>
                <label className={styles.label}>
                  Slug
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      value={form.slug ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                      className={styles.input}
                      placeholder="e.g. my-awesome-podcast"
                      style={{ flex: '1 1 200px' }}
                      disabled={form.unlisted !== 1 && user?.role !== 'admin'}
                    />
                    {form.unlisted === 1 && (
                      <button
                        type="button"
                        className={styles.gearBtn}
                        onClick={() => setForm((f) => ({ ...f, slug: generateSecretSlug() }))}
                        aria-label="Regenerate secret slug"
                      >
                        Regenerate secret slug
                      </button>
                    )}
                  </div>
                  {form.unlisted === 1 && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                      Unlisted shows can use a secret slug; only people with the link can find the feed.
                    </p>
                  )}
                </label>
                <label className="toggle" aria-describedby="unlisted-desc">
                  <input
                    type="checkbox"
                    checked={form.unlisted === 1}
                    onChange={(e) => setForm((f) => ({ ...f, unlisted: e.target.checked ? 1 : 0 }))}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Unlisted</span>
                </label>
                <p id="unlisted-desc" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '-0.25rem 0 0.5rem 0', gridColumn: '1 / -1' }}>
                  Unlisted shows do not appear on the public /feed page or in the sitemap. Use a secret slug to share the feed link only with subscribers.
                </p>
                <label className="toggle" aria-describedby="subscribers-enabled-desc">
                  <input
                    type="checkbox"
                    checked={form.subscriber_only_feed_enabled === 1}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setForm((f) => ({
                        ...f,
                        subscriber_only_feed_enabled: on ? 1 : 0,
                        ...(on ? {} : { public_feed_disabled: 0 }),
                      }));
                    }}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Subscribers Enabled</span>
                </label>
                <p id="subscribers-enabled-desc" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '-0.25rem 0 0.5rem 0', gridColumn: '1 / -1' }}>
                  Allow adding subscribers and sharing a private feed link. Subscribers can see episodes that include subscriber-only ones when using their link.
                </p>
                {form.subscriber_only_feed_enabled === 1 && (
                  <>
                    <label className="toggle" aria-describedby="subscriber-only-desc">
                      <input
                        type="checkbox"
                        checked={form.public_feed_disabled === 1}
                        onChange={(e) => setForm((f) => ({ ...f, public_feed_disabled: e.target.checked ? 1 : 0 }))}
                      />
                      <span className="toggle__track" aria-hidden="true" />
                      <span>Subscriber Only</span>
                    </label>
                    <p id="subscriber-only-desc" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '-0.25rem 0 0.5rem 0', gridColumn: '1 / -1' }}>
                      When on, the public feed does not load at all. The show is only available to people with a subscriber link.
                    </p>
                  </>
                )}
                <label className={styles.label}>
                  Description
                  <textarea
                    ref={descriptionRef}
                    value={form.description ?? ''}
                    onChange={(e) => {
                      const ta = e.target;
                      setForm((f) => ({ ...f, description: ta.value }));
                      ta.style.height = 'auto';
                      ta.style.height = `${ta.scrollHeight}px`;
                    }}
                    className={styles.textarea}
                    rows={3}
                    style={{ minHeight: '80px', overflow: 'hidden', resize: 'none' }}
                    placeholder="What your show is about. Shown in podcast apps and directories."
                  />
                </label>
                <label className={styles.label}>
                  Subtitle
                  <input
                    type="text"
                    value={form.subtitle ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value.trim() || null }))}
                    className={styles.input}
                    placeholder="e.g. A weekly show about technology"
                  />
                </label>
                <label className={styles.label}>
                  Summary
                  <textarea
                    ref={summaryRef}
                    value={form.summary ?? ''}
                    onChange={(e) => {
                      const ta = e.target;
                      const v = ta.value;
                      setForm((f) => ({ ...f, summary: v.trim() === '' ? null : v }));
                      ta.style.height = 'auto';
                      ta.style.height = `${ta.scrollHeight}px`;
                    }}
                    className={styles.textarea}
                    rows={2}
                    style={{ minHeight: '60px', overflow: 'hidden', resize: 'none' }}
                    placeholder="Extended description for podcast apps (optional)"
                  />
                </label>

                <h3 className={styles.dialogSectionTitle}>Cover image</h3>
                <label className={styles.label}>
                  Cover Image
                  <div className={styles.statusToggle} role="group" aria-label="Cover image source">
                    <button
                      type="button"
                      className={coverMode === 'url' ? styles.statusToggleActive : styles.statusToggleBtn}
                      onClick={() => setCoverMode('url')}
                      aria-pressed={coverMode === 'url'}
                      aria-label="Cover image from URL"
                    >
                      URL
                    </button>
                    <button
                      type="button"
                      className={coverMode === 'upload' ? styles.statusToggleActive : styles.statusToggleBtn}
                      onClick={() => setCoverMode('upload')}
                      aria-pressed={coverMode === 'upload'}
                      aria-label="Upload cover image"
                    >
                      Upload
                    </button>
                  </div>
                  {coverMode === 'url' && (
                    <>
                      <input
                        type="url"
                        value={form.artwork_url ?? ''}
                        onChange={(e) => {
                          const value = e.target.value.trim();
                          setForm((f) => ({ ...f, artwork_url: value === '' ? null : value }));
                        }}
                        className={styles.input}
                        placeholder="e.g. https://myshow.com/cover.jpg"
                        style={{ marginTop: '0.5rem' }}
                      />
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                        Public URL for the podcast cover (optional)
                      </p>
                    </>
                  )}
                  {coverMode === 'upload' && (
                    <>
                      <input
                        key={coverUploadKey}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className={styles.input}
                        style={{ marginTop: '0.5rem' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setPendingArtworkFile(file);
                        }}
                        disabled={mutation.isPending}
                        aria-label="Choose cover image"
                      />
                      {pendingArtworkFile && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', margin: '0.25rem 0 0 0' }}>
                          {pendingArtworkFile.name} will be uploaded when you save.
                        </p>
                      )}
                      {uploadArtworkMutation.isError && (
                        <p className={styles.error} style={{ marginTop: '0.25rem' }}>
                          {uploadArtworkMutation.error?.message}
                        </p>
                      )}
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                        JPG, PNG or WebP, max 5MB. Uploads when you click Save changes.
                      </p>
                    </>
                  )}
                  {(coverMode === 'url'
                    ? debouncedArtworkUrl && (debouncedArtworkUrl.startsWith('http://') || debouncedArtworkUrl.startsWith('https://'))
                    : (pendingArtworkFile || podcast?.artwork_filename)
                  ) && (
                    <p style={{ marginTop: '0.75rem', marginBottom: 0, display: 'flex', justifyContent: 'center' }}>
                      <img
                        key={coverMode === 'url' ? `url-${debouncedArtworkUrl}` : `upload-${podcast?.artwork_filename ?? ''}-${Boolean(pendingArtworkPreviewUrl)}`}
                        src={safeImageSrc(
                          coverMode === 'url'
                            ? debouncedArtworkUrl
                            : pendingArtworkPreviewUrl ??
                              (podcast?.artwork_filename && podcastId
                                ? `/api/podcasts/${podcastId}/artwork/${encodeURIComponent(podcast.artwork_filename)}`
                                : '')
                        )}
                        alt="Cover preview"
                        style={{ maxWidth: '160px', maxHeight: '160px', borderRadius: '8px', border: '1px solid var(--border)', objectFit: 'cover' }}
                      />
                    </p>
                  )}
                </label>

                <h3 className={styles.dialogSectionTitle}>Author & contact</h3>
                <label className={styles.label}>
                  Author Name
                  <input
                    type="text"
                    value={form.author_name ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, author_name: e.target.value }))}
                    className={styles.input}
                    placeholder="e.g. Jane Smith"
                  />
                </label>
                <label className={styles.label}>
                  Owner Name
                  <input
                    type="text"
                    value={form.owner_name ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, owner_name: e.target.value }))}
                    className={styles.input}
                    placeholder="e.g. Jane Smith or Company Name"
                  />
                </label>
                <label className={styles.label}>
                  Email
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className={styles.input}
                    placeholder="e.g. contact@example.com"
                  />
                </label>

                <h3 className={styles.dialogSectionTitle}>Categories</h3>
                <label className={styles.label}>
                  Primary Category
                  <input
                    type="text"
                    value={form.category_primary ?? ''}
                    onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, category_primary: v, ...(!v.trim() ? { category_secondary: null } : {}) }));
                  }}
                    className={styles.input}
                    placeholder="e.g. Technology"
                  />
                </label>
                <label className={styles.label}>
                  Secondary Category
                  <input
                    type="text"
                    value={form.category_secondary ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, category_secondary: (f.category_primary ?? '').trim() ? e.target.value || null : null }))}
                    className={styles.input}
                    placeholder="e.g. Technology News"
                    disabled={!(form.category_primary ?? '').trim()}
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
                    Optional subcategory (e.g. Technology News under Technology)
                  </p>
                </label>
                <label className={styles.label}>
                  Primary Category 2
                  <input
                    type="text"
                    value={form.category_primary_two ?? ''}
                    onChange={(e) => {
                    const v = e.target.value || null;
                    setForm((f) => ({ ...f, category_primary_two: v, ...(!(v ?? '').trim() ? { category_secondary_two: null } : {}) }));
                  }}
                    className={styles.input}
                    placeholder="e.g. Arts"
                  />
                </label>
                <label className={styles.label}>
                  Secondary Category 2
                  <input
                    type="text"
                    value={form.category_secondary_two ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, category_secondary_two: (f.category_primary_two ?? '').trim() ? e.target.value || null : null }))}
                    className={styles.input}
                    placeholder="e.g. Visual Arts"
                    disabled={!(form.category_primary_two ?? '').trim()}
                  />
                </label>
                <label className={styles.label}>
                  Primary Category 3
                  <input
                    type="text"
                    value={form.category_primary_three ?? ''}
                    onChange={(e) => {
                    const v = e.target.value || null;
                    setForm((f) => ({ ...f, category_primary_three: v, ...(!(v ?? '').trim() ? { category_secondary_three: null } : {}) }));
                  }}
                    className={styles.input}
                    placeholder="e.g. Leisure"
                  />
                </label>
                <label className={styles.label}>
                  Secondary Category 3
                  <input
                    type="text"
                    value={form.category_secondary_three ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, category_secondary_three: (f.category_primary_three ?? '').trim() ? e.target.value || null : null }))}
                    className={styles.input}
                    placeholder="e.g. Hobbies"
                    disabled={!(form.category_primary_three ?? '').trim()}
                  />
                </label>

                <h3 className={styles.dialogSectionTitle}>Distribution & visibility</h3>
                <label className={styles.label}>
                  Site URL
                  <input
                    type="url"
                    value={form.site_url ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, site_url: e.target.value || null }))}
                    className={styles.input}
                    placeholder="e.g. https://myshow.com"
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
                  License
                  <input
                    type="text"
                    value={form.license ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, license: e.target.value || null }))}
                    className={styles.input}
                    placeholder="e.g. All rights reserved"
                  />
                </label>

                {podcast.my_role === 'owner' &&
                  podcast.dns_config &&
                  (podcast.dns_config.allow_linking_domain ||
                    podcast.dns_config.allow_domain ||
                    (podcast.dns_config.allow_sub_domain && !!podcast.dns_config.default_domain)) && (
                  <>
                    <h3 className={styles.dialogSectionTitle}>DNS &amp; Custom Domain</h3>
                    {podcast.dns_config.allow_linking_domain && (
                      <label className={styles.label}>
                        Link Domain
                        <input
                          type="text"
                          value={form.link_domain ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.trim() || null;
                            setForm((f) => ({ ...f, link_domain: v }));
                            if (linkDomainError && v && !v.toLowerCase().startsWith('http://') && !v.toLowerCase().startsWith('https://')) {
                              setLinkDomainError(null);
                            }
                          }}
                          onBlur={() => {
                            const v = (form.link_domain ?? '').trim();
                            if (v && (v.toLowerCase().startsWith('http://') || v.toLowerCase().startsWith('https://'))) {
                              setLinkDomainError('Use hostname only (no http:// or https://).');
                            }
                          }}
                          className={styles.input}
                          placeholder="e.g. feed.myshow.com"
                          aria-invalid={!!linkDomainError}
                          aria-describedby={linkDomainError ? 'link-domain-error' : undefined}
                        />
                        {linkDomainError ? (
                          <p id="link-domain-error" style={{ fontSize: '0.75rem', color: 'var(--error)', marginTop: '0.25rem', marginLeft: '0' }} role="alert">
                            {linkDomainError}
                          </p>
                        ) : (
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                            Hostname only (no https://). Requests to this host redirect to your public feed.
                          </p>
                        )}
                      </label>
                    )}
                    {podcast.dns_config.allow_domain && (
                      <label className={styles.label}>
                        Managed Domain
                        {podcast.dns_config.allow_domains?.length ? (
                          <select
                            value={form.managed_domain ?? ''}
                            onChange={(e) => setForm((f) => ({ ...f, managed_domain: e.target.value || null }))}
                            className={styles.input}
                          >
                            <option value="">-</option>
                            {podcast.dns_config.allow_domains.map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={form.managed_domain ?? ''}
                            onChange={(e) => setForm((f) => ({ ...f, managed_domain: e.target.value.trim() || null }))}
                            className={styles.input}
                            placeholder="e.g. example.com"
                          />
                        )}
                      </label>
                    )}
                    {podcast.dns_config.allow_domain && podcast.dns_config.allow_custom_key && (
                      <label className={styles.label}>
                        CloudFlare API Key (Optional)
                        <input
                          type="password"
                          value={form.cloudflare_api_key ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, cloudflare_api_key: e.target.value || undefined }))}
                          className={styles.input}
                          placeholder={form.cloudflare_api_key_set ? '(leave blank to keep current)' : 'Enter API token'}
                          autoComplete="off"
                        />
                      </label>
                    )}
                    {podcast.dns_config.allow_sub_domain && podcast.dns_config.default_domain && (
                      <label className={styles.label}>
                        Managed Sub-Domain
                        <input
                          type="text"
                          value={form.managed_sub_domain ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^a-zA-Z0-9-]/g, '').trim() || null;
                            setForm((f) => ({ ...f, managed_sub_domain: v }));
                          }}
                          className={styles.input}
                          placeholder={`e.g. www, myshow (→ myshow.${podcast.dns_config.default_domain})`}
                        />
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                          Sub-domain under {podcast.dns_config.default_domain}. Letters, numbers, and hyphens only.
                        </p>
                      </label>
                    )}
                  </>
                )}

                <div className={styles.advancedSection}>
                  <button
                    type="button"
                    className={styles.advancedToggle}
                    onClick={() => setShowAdvanced((v) => !v)}
                    aria-expanded={showAdvanced}
                    aria-controls="edit-show-advanced-fields"
                  >
                    {showAdvanced ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
                    <span>More Feed Options</span>
                  </button>
                  {showAdvanced && (
                    <div id="edit-show-advanced-fields" className={styles.advancedFields}>
                      <label className={styles.label}>
                        Podcast GUID
                        <input
                          type="text"
                          value={form.podcast_guid ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, podcast_guid: e.target.value || null }))}
                          className={styles.input}
                          placeholder="Leave blank to auto-generate"
                        />
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
                          Unique identifier for your podcast feed. Only change if you need to keep an existing ID.
                        </p>
                      </label>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={!!form.locked}
                          onChange={(e) => setForm((f) => ({ ...f, locked: e.target.checked ? 1 : 0 }))}
                        />
                        <span className="toggle__track" aria-hidden="true" />
                        <span>Locked (Prevent Other Platforms From Importing)</span>
                      </label>
                      <label className={styles.label}>
                        Episode order
                        <div className={styles.statusToggle} role="group" aria-label="Episode order">
                          {(['episodic', 'serial'] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={(form.itunes_type ?? 'episodic') === t ? styles.statusToggleActive : styles.statusToggleBtn}
                              onClick={() => setForm((f) => ({ ...f, itunes_type: t }))}
                              aria-pressed={(form.itunes_type ?? 'episodic') === t}
                              aria-label={t === 'episodic' ? 'Episodic' : 'Serial'}
                            >
                              {t === 'episodic' ? 'Episodic' : 'Serial'}
                            </button>
                          ))}
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
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
                      <label className={styles.label}>
                        Funding URL
                        <input
                          type="url"
                          value={form.funding_url ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, funding_url: e.target.value.trim() || null }))}
                          className={styles.input}
                          placeholder="e.g. https://patreon.com/myshow"
                        />
                      </label>
                      <label className={styles.label}>
                        Funding Label
                        <input
                          type="text"
                          value={form.funding_label ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, funding_label: e.target.value.trim() || null }))}
                          className={styles.input}
                          placeholder="e.g. Support the show"
                        />
                      </label>
                      <label className={styles.label}>
                        Hosts and contributors
                        <input
                          type="text"
                          value={(() => {
                            try {
                              const p = form.persons;
                              if (!p) return '';
                              const arr = JSON.parse(p) as unknown[];
                              return Array.isArray(arr) ? arr.map((x) => String(x)).join(', ') : p;
                            } catch {
                              return form.persons ?? '';
                            }
                          })()}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (!raw) {
                              setForm((f) => ({ ...f, persons: null }));
                              return;
                            }
                            const arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
                            setForm((f) => ({ ...f, persons: arr.length ? JSON.stringify(arr) : null }));
                          }}
                          className={styles.input}
                          placeholder="e.g. Jane Smith, John Doe"
                        />
                      </label>
                      <label className={styles.label}>
                        Update schedule (Spotify)
                        <input
                          type="text"
                          value={form.update_frequency_rrule ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, update_frequency_rrule: e.target.value.trim() || null }))}
                          className={styles.input}
                          placeholder="e.g. FREQ=WEEKLY or FREQ=DAILY"
                        />
                      </label>
                      <label className={styles.label}>
                        Update schedule label (Spotify)
                        <input
                          type="text"
                          value={form.update_frequency_label ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, update_frequency_label: e.target.value.trim() || null }))}
                          className={styles.input}
                          placeholder="e.g. Weekly or Daily"
                        />
                      </label>
                      <label className={styles.label}>
                        Spotify Recent Count
                        <input
                          type="number"
                          min={0}
                          value={form.spotify_recent_count ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            const n = v === '' ? null : parseInt(v, 10);
                            setForm((f) => ({ ...f, spotify_recent_count: n != null && !Number.isNaN(n) && n >= 0 ? n : null }));
                          }}
                          className={styles.input}
                          placeholder="e.g. 150"
                        />
                      </label>
                      <label className={styles.label}>
                        Spotify country of origin
                        <input
                          type="text"
                          value={form.spotify_country_of_origin ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, spotify_country_of_origin: e.target.value.trim() || null }))}
                          className={styles.input}
                          placeholder="e.g. US"
                        />
                      </label>
                      <label className={styles.label}>
                        Apple Podcasts verification code
                        <input
                          type="text"
                          value={form.apple_podcasts_verify ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, apple_podcasts_verify: e.target.value.trim() || null }))}
                          className={styles.input}
                          placeholder="From Apple Podcasts Connect"
                        />
                      </label>
                    </div>
                  )}
                </div>
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
              </form>
            ) : null}
          </div>
          {podcast && (
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.cancel} onClick={onClose} aria-label="Cancel editing show">
                Cancel
              </button>
              <button type="submit" form="edit-show-details-form" className={styles.submit} disabled={mutation.isPending || uploadArtworkMutation.isPending} aria-label="Save show changes">
                {uploadArtworkMutation.isPending ? 'Uploading...' : mutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

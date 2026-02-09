import { useEffect } from 'react';
import { slugify, type EpisodeForm } from './utils';
import styles from '../EpisodeEditor.module.css';

function safeImageSrc(url: string | null | undefined): string {
  if (!url) return '';
  const s = url.trim();
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://x';
    const parsed = new URL(s, base);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'blob:') return parsed.href;
  } catch {
    // ignore
  }
  return '';
}

export interface EpisodeDetailsFormProps {
  form: EpisodeForm;
  setForm: React.Dispatch<React.SetStateAction<EpisodeForm>>;
  descriptionTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  slugDisabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  /** When set, show URL vs Upload cover image options and preview. */
  coverImageConfig?: {
    podcastId: string;
    episodeId: string;
    artworkFilename: string | null;
    coverMode: 'url' | 'upload';
    setCoverMode: (m: 'url' | 'upload') => void;
    pendingArtworkFile: File | null;
    setPendingArtworkFile: (f: File | null) => void;
    pendingArtworkPreviewUrl: string | null;
    coverUploadKey: number;
    debouncedArtworkUrl: string;
    uploadArtworkPending: boolean;
  };
}

export function EpisodeDetailsForm({
  form,
  setForm,
  descriptionTextareaRef,
  slugDisabled,
  onSave,
  onCancel,
  isSaving,
  saveError,
  saveSuccess,
  coverImageConfig,
}: EpisodeDetailsFormProps) {
  const cover = coverImageConfig;
  const savingOrUploading = isSaving || (cover?.uploadArtworkPending ?? false);

  useEffect(() => {
    if (descriptionTextareaRef.current) {
      descriptionTextareaRef.current.style.height = 'auto';
      descriptionTextareaRef.current.style.height = `${descriptionTextareaRef.current.scrollHeight}px`;
    }
  }, [form.description, descriptionTextareaRef]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave();
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {saveError && <p className={styles.error}>{saveError}</p>}
      {saveSuccess && <p className={styles.success}>Saved.</p>}
      <label className={styles.label}>
        Title
        <input
          type="text"
          value={form.title}
          onChange={(e) => {
            const v = e.target.value;
            setForm((prev) => ({
              ...prev,
              title: v,
              ...((!prev.slug || prev.slug === slugify(prev.title)) ? { slug: slugify(v) } : {}),
            }));
          }}
          className={styles.input}
          required
        />
      </label>
      <label className={styles.label}>
        Slug
        <span className={styles.labelHint}>Used in URLs — lowercase, numbers, hyphens only</span>
        <input
          type="text"
          value={form.slug}
          onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
          className={styles.input}
          placeholder="auto-generated-from-title"
          pattern="[a-z0-9\-]+"
          required
          disabled={slugDisabled}
        />
      </label>
      <label className={styles.label}>
        Description
        <textarea
          ref={descriptionTextareaRef}
          value={form.description}
          onChange={(e) => {
            const ta = e.target;
            setForm((prev) => ({ ...prev, description: ta.value }));
            ta.style.height = 'auto';
            ta.style.height = `${ta.scrollHeight}px`;
          }}
          className={styles.textarea}
          rows={4}
          style={{ minHeight: '80px', overflow: 'hidden' }}
        />
      </label>
      <label className={styles.label}>
        Cover image
        {cover ? (
          <>
            <div className={styles.statusToggle} role="group" aria-label="Cover image source">
              <button
                type="button"
                className={cover.coverMode === 'url' ? styles.statusToggleActive : styles.statusToggleBtn}
                onClick={() => cover.setCoverMode('url')}
                aria-pressed={cover.coverMode === 'url'}
                aria-label="Cover image from URL"
              >
                URL
              </button>
              <button
                type="button"
                className={cover.coverMode === 'upload' ? styles.statusToggleActive : styles.statusToggleBtn}
                onClick={() => cover.setCoverMode('upload')}
                aria-pressed={cover.coverMode === 'upload'}
                aria-label="Upload cover image"
              >
                Upload
              </button>
            </div>
            {cover.coverMode === 'url' && (
              <>
                <input
                  type="url"
                  value={form.artworkUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, artworkUrl: e.target.value }))}
                  className={styles.input}
                  placeholder="https://example.com/cover.jpg"
                  style={{ marginTop: '0.5rem' }}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                  Public URL for the episode cover (optional)
                </p>
              </>
            )}
            {cover.coverMode === 'upload' && (
              <>
                <input
                  key={cover.coverUploadKey}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className={styles.input}
                  style={{ marginTop: '0.5rem' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) cover.setPendingArtworkFile(file);
                  }}
                  disabled={savingOrUploading}
                  aria-label="Choose cover image"
                />
                {cover.pendingArtworkFile && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', margin: '0.25rem 0 0 0' }}>
                    {cover.pendingArtworkFile.name} will be uploaded when you save.
                  </p>
                )}
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                  JPG, PNG or WebP, max 5MB. Uploads when you click Save.
                </p>
              </>
            )}
            {(cover.coverMode === 'url'
              ? cover.debouncedArtworkUrl && (cover.debouncedArtworkUrl.startsWith('http://') || cover.debouncedArtworkUrl.startsWith('https://'))
              : cover.pendingArtworkFile || cover.artworkFilename) && (
              <p style={{ marginTop: '0.75rem', marginBottom: 0, display: 'flex', justifyContent: 'center' }}>
                <img
                  key={cover.coverMode === 'url' ? `url-${cover.debouncedArtworkUrl}` : `upload-${cover.artworkFilename ?? ''}-${Boolean(cover.pendingArtworkPreviewUrl)}`}
                  src={safeImageSrc(
                    cover.coverMode === 'url'
                      ? cover.debouncedArtworkUrl
                      : cover.pendingArtworkPreviewUrl ??
                        (cover.artworkFilename
                          ? `/api/public/artwork/${cover.podcastId}/episodes/${cover.episodeId}/${encodeURIComponent(cover.artworkFilename)}`
                          : '')
                  )}
                  alt="Cover preview"
                  style={{ maxWidth: '160px', maxHeight: '160px', borderRadius: '8px', border: '1px solid var(--border)', objectFit: 'cover' }}
                />
              </p>
            )}
          </>
        ) : (
          <>
            <input
              type="url"
              value={form.artworkUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, artworkUrl: e.target.value }))}
              className={styles.input}
              placeholder="https://example.com/image.jpg"
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
              URL for the episode cover image (optional)
            </p>
          </>
        )}
      </label>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <label className={styles.label} style={{ flex: '1 1 80px' }}>
          Season
          <input
            type="number"
            min={0}
            value={form.seasonNumber}
            onChange={(e) => setForm((prev) => ({ ...prev, seasonNumber: e.target.value }))}
            className={styles.input}
          />
        </label>
        <label className={styles.label} style={{ flex: '1 1 80px' }}>
          Episode
          <input
            type="number"
            min={0}
            value={form.episodeNumber}
            onChange={(e) => setForm((prev) => ({ ...prev, episodeNumber: e.target.value }))}
            className={styles.input}
          />
        </label>
      </div>
      <label className={styles.label}>
        Status
        <div className={styles.statusToggle} role="group" aria-label="Episode status">
          {(['draft', 'scheduled', 'published'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={form.status === s ? styles.statusToggleActive : styles.statusToggleBtn}
              onClick={() => setForm((prev) => ({ ...prev, status: s }))}
              aria-pressed={form.status === s}
              aria-label={`Status: ${s.charAt(0).toUpperCase() + s.slice(1)}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </label>
      <label className={styles.label}>
        Publish at (optional)
        <input
          type="datetime-local"
          value={form.publishAt}
          onChange={(e) => setForm((prev) => ({ ...prev, publishAt: e.target.value }))}
          className={styles.input}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.explicit}
          onChange={(e) => setForm((prev) => ({ ...prev, explicit: e.target.checked }))}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Explicit</span>
      </label>
      <label className={styles.label}>
        Episode Type
        <select
          value={form.episodeType || 'full'}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, episodeType: e.target.value as 'full' | 'trailer' | 'bonus' | '' }))
          }
          className={styles.input}
        >
          <option value="full">Full</option>
          <option value="trailer">Trailer</option>
          <option value="bonus">Bonus</option>
        </select>
      </label>
      <label className={styles.label}>
        Episode Link
        <input
          type="url"
          value={form.episodeLink}
          onChange={(e) => setForm((prev) => ({ ...prev, episodeLink: e.target.value }))}
          className={styles.input}
          placeholder="https://example.com/episode-page"
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
          URL to the episode's web page (optional)
        </p>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.guidIsPermalink}
          onChange={(e) => setForm((prev) => ({ ...prev, guidIsPermalink: e.target.checked }))}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>GUID is permalink</span>
      </label>
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancel} aria-label="Cancel editing episode">
          Cancel
        </button>
        <button type="submit" className={styles.submit} disabled={savingOrUploading} aria-label="Save episode details">
          {cover?.uploadArtworkPending ? 'Uploading…' : isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

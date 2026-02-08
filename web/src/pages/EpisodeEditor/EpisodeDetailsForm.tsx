import { useEffect } from 'react';
import { slugify } from './utils';
import styles from '../EpisodeEditor.module.css';

export interface EpisodeDetailsFormProps {
  title: string;
  setTitle: (v: string) => void;
  slug: string;
  setSlug: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  artworkUrl: string;
  setArtworkUrl: (v: string) => void;
  seasonNumber: string;
  setSeasonNumber: (v: string) => void;
  episodeNumber: string;
  setEpisodeNumber: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  publishAt: string;
  setPublishAt: (v: string) => void;
  explicit: boolean;
  setExplicit: (v: boolean) => void;
  episodeType: string;
  setEpisodeType: (v: 'full' | 'trailer' | 'bonus' | '') => void;
  episodeLink: string;
  setEpisodeLink: (v: string) => void;
  guidIsPermalink: boolean;
  setGuidIsPermalink: (v: boolean) => void;
  descriptionTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  slugDisabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
}

export function EpisodeDetailsForm({
  title,
  setTitle,
  slug,
  setSlug,
  description,
  setDescription,
  artworkUrl,
  setArtworkUrl,
  seasonNumber,
  setSeasonNumber,
  episodeNumber,
  setEpisodeNumber,
  status,
  setStatus,
  publishAt,
  setPublishAt,
  explicit,
  setExplicit,
  episodeType,
  setEpisodeType,
  episodeLink,
  setEpisodeLink,
  guidIsPermalink,
  setGuidIsPermalink,
  descriptionTextareaRef,
  slugDisabled,
  onSave,
  onCancel,
  isSaving,
  saveError,
  saveSuccess,
}: EpisodeDetailsFormProps) {
  useEffect(() => {
    if (descriptionTextareaRef.current) {
      descriptionTextareaRef.current.style.height = 'auto';
      descriptionTextareaRef.current.style.height = `${descriptionTextareaRef.current.scrollHeight}px`;
    }
  }, [description, descriptionTextareaRef]);

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
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!slug || slug === slugify(title)) setSlug(slugify(e.target.value));
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
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
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
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            const ta = e.target;
            ta.style.height = 'auto';
            ta.style.height = `${ta.scrollHeight}px`;
          }}
          className={styles.textarea}
          rows={4}
          style={{ minHeight: '80px', overflow: 'hidden' }}
        />
      </label>
      <label className={styles.label}>
        Cover Image URL
        <input type="url" value={artworkUrl} onChange={(e) => setArtworkUrl(e.target.value)} className={styles.input} placeholder="https://example.com/image.jpg" />
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>URL for the episode cover image (optional)</p>
      </label>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <label className={styles.label} style={{ flex: '1 1 80px' }}>
          Season
          <input type="number" min={0} value={seasonNumber} onChange={(e) => setSeasonNumber(e.target.value)} className={styles.input} />
        </label>
        <label className={styles.label} style={{ flex: '1 1 80px' }}>
          Episode
          <input type="number" min={0} value={episodeNumber} onChange={(e) => setEpisodeNumber(e.target.value)} className={styles.input} />
        </label>
      </div>
      <label className={styles.label}>
        Status
        <div className={styles.statusToggle} role="group" aria-label="Episode status">
          {(['draft', 'scheduled', 'published'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={status === s ? styles.statusToggleActive : styles.statusToggleBtn}
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </label>
      <label className={styles.label}>
        Publish at (optional)
        <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className={styles.input} />
      </label>
      <label className="toggle">
        <input type="checkbox" checked={explicit} onChange={(e) => setExplicit(e.target.checked)} />
        <span className="toggle__track" aria-hidden="true" />
        <span>Explicit</span>
      </label>
      <label className={styles.label}>
        Episode Type
        <select value={episodeType || 'full'} onChange={(e) => setEpisodeType(e.target.value as 'full' | 'trailer' | 'bonus' | '')} className={styles.input}>
          <option value="full">Full</option>
          <option value="trailer">Trailer</option>
          <option value="bonus">Bonus</option>
        </select>
      </label>
      <label className={styles.label}>
        Episode Link
        <input type="url" value={episodeLink} onChange={(e) => setEpisodeLink(e.target.value)} className={styles.input} placeholder="https://example.com/episode-page" />
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>URL to the episode's web page (optional)</p>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={guidIsPermalink} onChange={(e) => setGuidIsPermalink(e.target.checked)} />
        <span className="toggle__track" aria-hidden="true" />
        <span>GUID is permalink</span>
      </label>
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={styles.submit} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

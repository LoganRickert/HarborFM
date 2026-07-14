import { useRef } from 'react';
import { useAutoResizeTextarea } from '../../hooks/useAutoResizeTextarea';
import { Image } from 'lucide-react';
import { type EpisodeForm } from './utils';
import { EpisodePublishControls } from './EpisodePublishControls';
import { HrefTextListField } from '../../components/EpisodeEditor/HrefTextListField';
import { StructuredListField } from '../../components/EpisodeEditor/StructuredListField';
import { ObjectFieldsSection } from '../../components/EpisodeEditor/ObjectFieldsSection';
import { ValueBlocksField } from '../../components/EpisodeEditor/ValueBlocksField';
import localStyles from '../EpisodeEditor.module.css';
import sharedStyles from '../../components/PodcastDetail/shared.module.css';

const styles = { ...localStyles, ...sharedStyles };

export type EpisodeDetailsTab = 'overview' | 'publish' | 'more';

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
  activeTab: EpisodeDetailsTab;
  form: EpisodeForm;
  setForm: React.Dispatch<React.SetStateAction<EpisodeForm>>;
  descriptionTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  slugDisabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  /** When true, Delete Episode button is enabled. When false, button is disabled. */
  canDeleteEpisode?: boolean;
  /** True while delete is in progress (button disabled). */
  isDeleting?: boolean;
  /** Error message if delete failed. */
  deleteError?: string | null;
  /** Called when user clicks Delete Episode (opens confirm dialog). */
  onRequestDeleteEpisode?: () => void;
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
  /** When false, Published and Scheduled cannot be selected in the publish UI. */
  hasFinalAudio: boolean;
}

export function EpisodeDetailsForm({
  activeTab,
  form,
  setForm,
  descriptionTextareaRef,
  slugDisabled,
  onSave,
  isSaving,
  saveError,
  saveSuccess,
  canDeleteEpisode,
  isDeleting,
  deleteError,
  onRequestDeleteEpisode,
  coverImageConfig,
  hasFinalAudio,
}: EpisodeDetailsFormProps) {
  const cover = coverImageConfig;
  const savingOrUploading = isSaving || (cover?.uploadArtworkPending ?? false);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const contentEncodedRef = useRef<HTMLTextAreaElement>(null);

  useAutoResizeTextarea(descriptionTextareaRef, form.description, { minHeight: 80 });
  useAutoResizeTextarea(summaryRef, form.summary ?? '', { minHeight: 60 });
  useAutoResizeTextarea(contentEncodedRef, form.contentEncoded ?? '', { minHeight: 80 });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave();
  }

  return (
    <form id="episode-details-form" onSubmit={handleSubmit} className={styles.form}>
      {saveError && <p className={styles.error}>{saveError}</p>}
      {saveSuccess && <p className={styles.success}>Saved.</p>}

      <div
        role="tabpanel"
        id="episode-details-panel-overview"
        aria-labelledby="episode-details-tab-overview"
        className={`${styles.editDetailsTabPanel} ${activeTab === 'overview' ? styles.editDetailsTabPanelActive : ''}`}
      >
        <div className={styles.overviewFieldsStack}>
          <label className={styles.label}>
            Title
            <input
              type="text"
              value={form.title}
              onChange={(e) => {
                const v = e.target.value;
                setForm((prev) => ({ ...prev, title: v }));
              }}
              className={styles.input}
              placeholder="e.g. Episode 1: Getting Started"
              required
            />
          </label>
          <label className={styles.label}>
            Slug
            <input
              type="text"
              value={form.slug}
              onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value.replace(/[^a-zA-Z0-9-]/g, '') }))}
              className={styles.input}
              placeholder="e.g. episode-1-getting-started"
              pattern="[a-z0-9\-]+"
              required
              disabled={slugDisabled}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
              Used in URLs - lowercase, numbers, hyphens only.
            </p>
          </label>
          <label className={styles.label}>
            Description
            <textarea
              ref={descriptionTextareaRef}
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              className={styles.textarea}
              rows={2}
              style={{ overflow: 'hidden', resize: 'none' }}
              placeholder="What this episode is about. Shown in podcast apps."
            />
          </label>
          <label className={styles.label}>
            Subtitle
            <input
              type="text"
              value={form.subtitle}
              onChange={(e) => setForm((prev) => ({ ...prev, subtitle: e.target.value }))}
              className={styles.input}
              placeholder="e.g. One line summary for app listings"
            />
          </label>
          <label className={styles.label}>
            Summary
            <textarea
              ref={summaryRef}
              value={form.summary}
              onChange={(e) => setForm((prev) => ({ ...prev, summary: e.target.value }))}
              className={styles.textarea}
              rows={2}
              style={{ overflow: 'hidden', resize: 'none' }}
              placeholder="Extended description for podcast apps (optional)"
            />
          </label>

          <label className={styles.label}>
            Cover
            {cover ? (
              <div className={styles.coverImageWrap}>
                {(cover.coverMode === 'url'
                  ? cover.debouncedArtworkUrl &&
                    (cover.debouncedArtworkUrl.startsWith('http://') || cover.debouncedArtworkUrl.startsWith('https://'))
                  : cover.pendingArtworkFile || cover.artworkFilename
                ) ? (
                  <img
                    key={
                      cover.coverMode === 'url'
                        ? `url-${cover.debouncedArtworkUrl}`
                        : `upload-${cover.artworkFilename ?? ''}-${Boolean(cover.pendingArtworkPreviewUrl)}`
                    }
                    src={safeImageSrc(
                      cover.coverMode === 'url'
                        ? cover.debouncedArtworkUrl
                        : cover.pendingArtworkPreviewUrl ??
                          (cover.artworkFilename
                            ? `/api/podcasts/${cover.podcastId}/episodes/${cover.episodeId}/artwork/${encodeURIComponent(cover.artworkFilename)}`
                            : '')
                    )}
                    alt=""
                    className={styles.coverImagePreview}
                  />
                ) : (
                  <div className={styles.coverImagePreviewPlaceholder}>
                    <Image size={28} aria-hidden />
                  </div>
                )}
                <div className={styles.coverImageControls}>
                  <div className={styles.coverSourceToggle} role="group" aria-label="Cover image source">
                    <button
                      type="button"
                      className={cover.coverMode === 'url' ? styles.coverSourceToggleActive : styles.coverSourceToggleBtn}
                      onClick={() => cover.setCoverMode('url')}
                      aria-pressed={cover.coverMode === 'url'}
                      aria-label="Cover image from URL"
                    >
                      URL
                    </button>
                    <button
                      type="button"
                      className={cover.coverMode === 'upload' ? styles.coverSourceToggleActive : styles.coverSourceToggleBtn}
                      onClick={() => cover.setCoverMode('upload')}
                      aria-pressed={cover.coverMode === 'upload'}
                      aria-label="Upload cover image"
                    >
                      Upload
                    </button>
                  </div>
                  {cover.coverMode === 'url' ? (
                    <input
                      type="url"
                      value={form.artworkUrl}
                      onChange={(e) => setForm((prev) => ({ ...prev, artworkUrl: e.target.value }))}
                      className={styles.input}
                      placeholder="https://..."
                    />
                  ) : (
                    <input
                      key={cover.coverUploadKey}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className={styles.coverFileInput}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) cover.setPendingArtworkFile(file);
                      }}
                      disabled={savingOrUploading}
                      aria-label="Choose cover image"
                    />
                  )}
                  {cover.coverMode === 'upload' && cover.pendingArtworkFile && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                      {cover.pendingArtworkFile.name} will be uploaded when you save.
                    </p>
                  )}
                  {cover.coverMode === 'url' && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
                      Public URL (optional)
                    </p>
                  )}
                  {cover.coverMode === 'upload' && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
                      JPG, PNG or WebP, max 5MB
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <input
                  type="url"
                  value={form.artworkUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, artworkUrl: e.target.value }))}
                  className={styles.input}
                  placeholder="e.g. https://myshow.com/episode-cover.jpg"
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                  URL for the episode cover image (optional)
                </p>
              </>
            )}
          </label>
        </div>
      </div>

      <div
        role="tabpanel"
        id="episode-details-panel-publish"
        aria-labelledby="episode-details-tab-publish"
        className={`${styles.editDetailsTabPanel} ${activeTab === 'publish' ? styles.editDetailsTabPanelActive : ''}`}
      >
        <div className={styles.tabPanelFields}>
          <EpisodePublishControls
            values={{
              status: form.status,
              seasonNumber: form.seasonNumber,
              episodeNumber: form.episodeNumber,
              publishAt: form.publishAt,
            }}
            onChange={(fields) => setForm((prev) => ({ ...prev, ...fields }))}
            variant="form"
            hasFinalAudio={hasFinalAudio}
          />
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.explicit}
              onChange={(e) => setForm((prev) => ({ ...prev, explicit: e.target.checked }))}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Explicit</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.subscriberOnly}
              onChange={(e) => setForm((prev) => ({ ...prev, subscriberOnly: e.target.checked }))}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Subscriber Only</span>
          </label>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
            Subscriber-only episodes are omitted from the public RSS and episode list; they appear only in tokenized subscriber feeds.
          </p>
          <label className={styles.label}>
            Episode type
            <select
              value={form.episodeType || 'full'}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  episodeType: e.target.value as 'full' | 'trailer' | 'bonus' | '',
                }))
              }
              className={styles.input}
            >
              <option value="full">Full</option>
              <option value="trailer">Trailer</option>
              <option value="bonus">Bonus</option>
            </select>
          </label>
          <label className={styles.label}>
            Episode link
            <input
              type="url"
              value={form.episodeLink}
              onChange={(e) => setForm((prev) => ({ ...prev, episodeLink: e.target.value }))}
              className={styles.input}
              placeholder="e.g. https://myshow.com/episodes/1"
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
              URL to this episode's web page (optional)
            </p>
          </label>
        </div>
      </div>

      <div
        role="tabpanel"
        id="episode-details-panel-more"
        aria-labelledby="episode-details-tab-more"
        className={`${styles.editDetailsTabPanel} ${activeTab === 'more' ? styles.editDetailsTabPanelActive : ''}`}
      >
        <div className={styles.advancedFields}>
          <label className={styles.label}>
            Full show notes (HTML)
            <textarea
              ref={contentEncodedRef}
              value={form.contentEncoded}
              onChange={(e) => setForm((prev) => ({ ...prev, contentEncoded: e.target.value }))}
              className={styles.textarea}
              rows={2}
              style={{ overflow: 'hidden', resize: 'none' }}
              placeholder="e.g. <p>Full transcript or show notes</p>"
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
              Optional. Shown in apps that support full show notes.
            </p>
          </label>
          <HrefTextListField
            label="Content Link"
            docsUrl="https://podcasting2.org/docs/podcast-namespace/tags/content-link"
            hint="Optional Podcast 2.0 links to alternate platforms (e.g. YouTube). If link text is blank, the URL is used as the label in the feed."
            value={form.contentLinks}
            onChange={(contentLinks) => setForm((prev) => ({ ...prev, contentLinks }))}
            hrefPlaceholder="e.g. https://youtube.com/watch?v=…"
            textPlaceholder="e.g. Watch on YouTube"
            addLabel="Add content link"
          />
          <StructuredListField
            label="Txt"
            docsUrl="https://podcasting2.org/docs/podcast-namespace/tags/txt"
            hint="Free-form Podcast 2.0 txt records (verification, AI disclosure, etc.). Purpose max 128 chars; value max 4000."
            value={form.podcastTxts}
            onChange={(podcastTxts) => setForm((prev) => ({ ...prev, podcastTxts }))}
            emptyRow={() => ({ purpose: '', value: '' })}
            addLabel="Add txt"
            fields={[
              { key: 'purpose', label: 'Purpose', placeholder: 'e.g. verify', maxLength: 128 },
              { key: 'value', label: 'Value', placeholder: 'Text content', maxLength: 4000 },
            ]}
          />
          <StructuredListField
            label="Social Interact"
            docsUrl="https://podcasting2.org/docs/podcast-namespace/tags/social-interact"
            hint="Comment thread root posts. Use protocol “disabled” to signal no public comments (no URI needed)."
            value={form.socialInteracts}
            onChange={(socialInteracts) => setForm((prev) => ({ ...prev, socialInteracts }))}
            emptyRow={() => ({
              protocol: 'activitypub',
              uri: '',
              accountId: '',
              accountUrl: '',
              priority: '',
            })}
            addLabel="Add social interact"
            fields={[
              { key: 'protocol', label: 'Protocol', placeholder: 'activitypub', maxLength: 128 },
              { key: 'uri', label: 'URI', type: 'url', placeholder: 'https://…', maxLength: 2000 },
              { key: 'accountId', label: 'Account ID', placeholder: '@user', maxLength: 512 },
              {
                key: 'accountUrl',
                label: 'Account URL',
                type: 'url',
                placeholder: 'https://…',
                maxLength: 2000,
              },
              { key: 'priority', label: 'Priority', type: 'number', placeholder: '1' },
            ]}
          />
          <StructuredListField
            label="Location"
            docsUrl="https://podcasting2.org/docs/podcast-namespace/tags/location"
            hint="Where the episode is about or was made. Name max 128 chars; country is ISO alpha-2 (e.g. US)."
            value={form.locations}
            onChange={(locations) => setForm((prev) => ({ ...prev, locations }))}
            emptyRow={() => ({
              name: '',
              rel: 'subject',
              geo: '',
              osm: '',
              country: '',
            })}
            addLabel="Add location"
            fields={[
              { key: 'name', label: 'Name', placeholder: 'Austin, TX', maxLength: 128 },
              {
                key: 'rel',
                label: 'Relation',
                type: 'select',
                options: [
                  { value: 'subject', label: 'Subject (About)' },
                  { value: 'creator', label: 'Creator (Recorded)' },
                ],
              },
              { key: 'geo', label: 'Geo URI', placeholder: 'geo:30.2672,-97.7431', maxLength: 128 },
              { key: 'osm', label: 'OSM ID', placeholder: 'R113314', maxLength: 64 },
              { key: 'country', label: 'Country', placeholder: 'US', maxLength: 2 },
            ]}
          />
          <ObjectFieldsSection
            label="License"
            docsUrl="https://podcasting2.org/docs/podcast-namespace/tags/license"
            hint="Episode license identifier (e.g. CC-BY-4.0). Include a URL for custom licenses."
            value={form.license}
            onChange={(license) =>
              setForm((prev) => ({
                ...prev,
                license: { identifier: license.identifier ?? '', url: license.url ?? '' },
              }))
            }
            fields={[
              {
                key: 'identifier',
                label: 'Identifier',
                placeholder: 'CC-BY-4.0',
                maxLength: 128,
              },
              {
                key: 'url',
                label: 'URL',
                type: 'url',
                placeholder: 'https://…',
                maxLength: 2000,
                hint: 'Required for custom licenses',
              },
            ]}
          />
          <StructuredListField
            label="Image"
            docsUrl="https://podcasting2.org/docs/podcast-namespace/tags/image"
            hint="Podcast 2.0 images by URL only (no upload). Use purpose tokens like artwork, social, canvas."
            value={form.podcastImages}
            onChange={(podcastImages) => setForm((prev) => ({ ...prev, podcastImages }))}
            emptyRow={() => ({
              href: '',
              alt: '',
              aspectRatio: '',
              width: '',
              height: '',
              type: '',
              purpose: '',
            })}
            addLabel="Add image"
            fields={[
              { key: 'href', label: 'URL', type: 'url', placeholder: 'https://…', maxLength: 2000 },
              { key: 'alt', label: 'Alt text', maxLength: 512 },
              { key: 'aspectRatio', label: 'Aspect ratio', placeholder: '16/9', maxLength: 32 },
              { key: 'width', label: 'Width (px)', type: 'number' },
              { key: 'height', label: 'Height (px)', type: 'number' },
              { key: 'type', label: 'MIME type', placeholder: 'image/jpeg', maxLength: 128 },
              { key: 'purpose', label: 'Purpose', placeholder: 'artwork social', maxLength: 128 },
            ]}
          />
          <HrefTextListField
            label="Funding"
            docsUrl="https://podcasting2.org/docs/podcast-namespace/tags/funding"
            hint="Episode funding / donation links (separate from show-level funding)."
            value={form.fundingLinks}
            onChange={(fundingLinks) => setForm((prev) => ({ ...prev, fundingLinks }))}
            hrefPlaceholder="e.g. https://example.com/donate"
            textPlaceholder="e.g. Support this episode"
            addLabel="Add funding link"
            textMaxLength={128}
          />
          <ObjectFieldsSection
            label="Chat"
            docsUrl="https://podcasting2.org/docs/podcast-namespace/tags/chat"
            hint="Official chat for this episode (overrides show-level chat when set)."
            value={form.chat}
            onChange={(chat) =>
              setForm((prev) => ({
                ...prev,
                chat: {
                  server: chat.server ?? '',
                  protocol: chat.protocol ?? '',
                  accountId: chat.accountId ?? '',
                  space: chat.space ?? '',
                },
              }))
            }
            fields={[
              { key: 'server', label: 'Server', placeholder: 'irc.example.com', maxLength: 512 },
              { key: 'protocol', label: 'Protocol', placeholder: 'irc', maxLength: 128 },
              { key: 'accountId', label: 'Account ID', placeholder: '@host', maxLength: 512 },
              { key: 'space', label: 'Space / room', placeholder: '#episode', maxLength: 512 },
            ]}
          />
          <ValueBlocksField
            value={form.valueBlocks}
            onChange={(valueBlocks) => setForm((prev) => ({ ...prev, valueBlocks }))}
          />
          <label className={styles.label}>
            GUID
            <input
              type="text"
              value={form.guid}
              onChange={(e) => setForm((prev) => ({ ...prev, guid: e.target.value }))}
              className={styles.input}
              placeholder="Leave blank to auto-generate"
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
              Unique ID for this episode. Only change if you need to keep an existing ID.
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
        </div>
        {onRequestDeleteEpisode && (
          <div className={styles.deleteEpisodeSection}>
            <h3 className={styles.deleteSectionTitle}>Danger zone</h3>
            {deleteError && (
              <p className={styles.error} style={{ marginBottom: '0.75rem' }}>{deleteError}</p>
            )}
            <button
              type="button"
              className={styles.deleteEpisodeButton}
              disabled={!canDeleteEpisode || isDeleting}
              onClick={onRequestDeleteEpisode}
            >
              Delete Episode
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

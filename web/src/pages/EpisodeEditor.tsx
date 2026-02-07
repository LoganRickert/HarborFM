import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { getEpisode, updateEpisode } from '../api/episodes';
import { getPodcast } from '../api/podcasts';
import { downloadEpisodeUrl } from '../api/audio';
import {
  listSegments,
  addRecordedSegment,
  addReusableSegment,
  reorderSegments,
  deleteSegment,
  updateSegment,
  renderEpisode,
  segmentStreamUrl,
  getSegmentTranscript,
  generateSegmentTranscript,
  deleteSegmentTranscript,
  updateSegmentTranscript,
  trimSegmentAudio,
  removeSilenceFromSegment,
  applyNoiseSuppressionToSegment,
  type EpisodeSegment,
} from '../api/segments';
import { listLibrary, createLibraryAsset, type LibraryAsset } from '../api/library';
import { getLlmAvailable, askLlm } from '../api/llm';
import { getAsrAvailable } from '../api/asr';
import { RotateCcw, PlusCircle, Mic, Library, Play, Pause, FileAudio, Upload, ArrowDown, ArrowUp, Info, FileText, Trash2, Plus, Minus } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { FullPageLoading } from '../components/Loading';
import styles from './EpisodeEditor.module.css';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatLibraryDate(createdAt: string): string {
  try {
    const d = new Date(createdAt);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : createdAt;
  } catch {
    return createdAt;
  }
}

export function EpisodeEditor() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { data: episode, isLoading, isFetching, isError } = useQuery({
    queryKey: ['episode', id],
    queryFn: () => getEpisode(id!),
    enabled: !!id,
  });
  const { data: podcast } = useQuery({
    queryKey: ['podcast', episode?.podcast_id],
    queryFn: () => getPodcast(episode!.podcast_id),
    enabled: !!episode?.podcast_id,
  });
  const { data: segmentsData, isLoading: segmentsLoading } = useQuery({
    queryKey: ['segments', id],
    queryFn: () => listSegments(id!),
    enabled: !!id,
  });
  const segments = segmentsData?.segments ?? [];

  const { data: asrAvail } = useQuery({
    queryKey: ['asrAvailable'],
    queryFn: getAsrAvailable,
    enabled: !!id,
    staleTime: 30_000,
    retry: false,
  });

  const [editing, setEditing] = useState(true);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [seasonNumber, setSeasonNumber] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [episodeType, setEpisodeType] = useState<'full' | 'trailer' | 'bonus' | ''>('');
  const [status, setStatus] = useState('draft');
  const [explicit, setExplicit] = useState(false);
  const [publishAt, setPublishAt] = useState('');
  const [artworkUrl, setArtworkUrl] = useState('');
  const [episodeLink, setEpisodeLink] = useState('');
  const [guidIsPermalink, setGuidIsPermalink] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const editTab = searchParams.get('tab') === 'sections' ? 'sections' : 'details';
  const setEditTab = useCallback((tab: 'details' | 'sections') => {
    setSearchParams(tab === 'details' ? {} : { tab: 'sections' });
  }, [setSearchParams]);
  const [segmentToDelete, setSegmentToDelete] = useState<string | null>(null);
  const [segmentIdForInfo, setSegmentIdForInfo] = useState<string | null>(null);
  const [transcriptEntryToDelete, setTranscriptEntryToDelete] = useState<{ episodeId: string; segmentId: string; entryIndex: number } | null>(null);
  const [previewingFinal, setPreviewingFinal] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const segmentPauseRef = useRef<Map<string, () => void>>(new Map());
  const playingSegmentIdRef = useRef<string | null>(null);
  const finalPreviewRef = useRef<HTMLAudioElement | null>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const handleSegmentPlayRequest = useCallback((segmentId: string) => {
    const current = playingSegmentIdRef.current;
    if (current && current !== segmentId) segmentPauseRef.current.get(current)?.();
    playingSegmentIdRef.current = segmentId;
  }, []);
  const registerSegmentPause = useCallback((id: string, pause: () => void) => {
    segmentPauseRef.current.set(id, pause);
  }, []);
  const unregisterSegmentPause = useCallback((id: string) => {
    segmentPauseRef.current.delete(id);
    if (playingSegmentIdRef.current === id) playingSegmentIdRef.current = null;
  }, []);

  useEffect(() => {
    if (editTab !== 'sections' && previewingFinal) {
      setPreviewingFinal(false);
      setPreviewIndex(0);
      const el = finalPreviewRef.current;
      if (el) {
        el.pause();
        el.src = '';
      }
    }
  }, [editTab, previewingFinal]);

  useEffect(() => {
    const el = finalPreviewRef.current;
    if (!el) return;
    if (!previewingFinal) {
      el.pause();
      el.src = '';
      return;
    }
    const seg = segments[previewIndex];
    if (!seg || !id) {
      setPreviewingFinal(false);
      setPreviewIndex(0);
      el.pause();
      el.src = '';
      return;
    }
    const onEnded = () => {
      const next = previewIndex + 1;
      if (next >= segments.length) {
        setPreviewingFinal(false);
        setPreviewIndex(0);
        return;
      }
      setPreviewIndex(next);
    };
    const onError = () => {
      setPreviewingFinal(false);
      setPreviewIndex(0);
    };
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    el.pause();
    el.src = segmentStreamUrl(id, seg.id);
    el.load();
    el.play().catch(() => {
      setPreviewingFinal(false);
      setPreviewIndex(0);
    });
    return () => {
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
  }, [previewingFinal, previewIndex, segments, id]);

  useEffect(() => {
    if (episode) {
      setTitle(episode.title);
      setSlug(episode.slug || slugify(episode.title));
      setDescription(episode.description ?? '');
      setSeasonNumber(episode.season_number != null ? String(episode.season_number) : '');
      setEpisodeNumber(episode.episode_number != null ? String(episode.episode_number) : '');
      setEpisodeType((episode.episode_type as 'full' | 'trailer' | 'bonus') || 'full');
      setEpisodeLink(episode.episode_link ?? '');
      setGuidIsPermalink(episode.guid_is_permalink === 1);
      setStatus(episode.status);
      setArtworkUrl(episode.artwork_url ?? '');
      // Auto-resize textarea when episode loads
      setTimeout(() => {
        if (descriptionTextareaRef.current) {
          descriptionTextareaRef.current.style.height = 'auto';
          descriptionTextareaRef.current.style.height = `${descriptionTextareaRef.current.scrollHeight}px`;
        }
      }, 0);
      setExplicit(!!episode.explicit);
      setPublishAt(episode.publish_at ? episode.publish_at.slice(0, 16) : '');
      setEditing(true);
    }
  }, [episode]);

  // Recalculate textarea height when switching to details tab
  useEffect(() => {
    if (editTab === 'details') {
      setTimeout(() => {
        if (descriptionTextareaRef.current) {
          descriptionTextareaRef.current.style.height = 'auto';
          descriptionTextareaRef.current.style.height = `${descriptionTextareaRef.current.scrollHeight}px`;
        }
      }, 0);
    }
  }, [editTab]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateEpisode(id!, {
        title,
        slug: slug || slugify(title),
        description,
        season_number: seasonNumber === '' ? null : parseInt(seasonNumber, 10),
        episode_number: episodeNumber === '' ? null : parseInt(episodeNumber, 10),
        episode_type: episodeType || 'full',
        status,
        artwork_url: artworkUrl === '' ? null : artworkUrl,
        explicit: explicit ? 1 : 0,
        publish_at: publishAt ? new Date(publishAt).toISOString() : null,
        episode_link: episodeLink || null,
        guid_is_permalink: guidIsPermalink ? 1 : 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['episode', id] });
      queryClient.invalidateQueries({ queryKey: ['episodes', episode?.podcast_id] });
      setEditing(false);
    },
  });

  const addRecordedMutation = useMutation({
    mutationFn: ({ file, name }: { file: File; name?: string | null }) => addRecordedSegment(id!, file, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments', id] });
      setShowRecord(false);
    },
  });

  const updateSegmentMutation = useMutation({
    mutationFn: ({ segmentId, name }: { segmentId: string; name: string | null }) => updateSegment(id!, segmentId, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segments', id] }),
  });

  const addReusableMutation = useMutation({
    mutationFn: (assetId: string) => addReusableSegment(id!, assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments', id] });
      setShowLibrary(false);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (segmentIds: string[]) => reorderSegments(id!, segmentIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segments', id] }),
  });

  const deleteSegmentMutation = useMutation({
    mutationFn: (segmentId: string) => deleteSegment(id!, segmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segments', id] }),
  });

  const renderMutation = useMutation({
    mutationFn: () => renderEpisode(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['episode', id] });
      queryClient.invalidateQueries({ queryKey: ['segments', id] });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  function handleMoveUp(index: number) {
    if (index <= 0) return;
    const newOrder = [...segments];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    reorderMutation.mutate(newOrder.map((s) => s.id));
  }

  function handleMoveDown(index: number) {
    if (index >= segments.length - 1) return;
    const newOrder = [...segments];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    reorderMutation.mutate(newOrder.map((s) => s.id));
  }

  function startPreviewSequence() {
    if (segments.length === 0) return;
    setPreviewIndex(0);
    setPreviewingFinal(true);
  }

  function stopPreviewSequence() {
    setPreviewingFinal(false);
    setPreviewIndex(0);
    const el = finalPreviewRef.current;
    if (el) {
      el.pause();
      el.src = '';
    }
  }

  if (!id) return null;
  if (isLoading || (!episode && isFetching)) return <FullPageLoading />;
  if (isError || !episode) return <p className={styles.error}>Episode not found.</p>;

  const podcastId = episode.podcast_id;

  return (
    <div className={styles.page}>
      <Link to={`/podcasts/${podcastId}/episodes`} className={styles.back}>
        ← {podcast?.title ?? 'Episodes'}
      </Link>
      {!editing && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h1 className={styles.cardTitle}>{episode.title}</h1>
            <button type="button" className={styles.secondaryBtn} onClick={() => setEditing(true)} aria-label="Edit episode">
              Edit episode
            </button>
          </div>
          {episode.description && (
            <div className={styles.cardDescription}>
              <p>{episode.description.length > 200 ? episode.description.slice(0, 200) + '…' : episode.description}</p>
            </div>
          )}
          <div className={styles.showMeta}>
            <div className={styles.showMetaItem}>
              <span className={styles.showMetaLabel}>Status</span>
              <span className={styles.showMetaValue}>{episode.status}</span>
            </div>
            {(episode.season_number != null || episode.episode_number != null) && (
              <div className={styles.showMetaItem}>
                <span className={styles.showMetaLabel}>Season / Episode</span>
                <span className={styles.showMetaValue}>
                  S{episode.season_number ?? '?'} E{episode.episode_number ?? '?'}
                </span>
              </div>
            )}
            {episode.publish_at && (
              <div className={styles.showMetaItem}>
                <span className={styles.showMetaLabel}>Publish at</span>
                <span className={styles.showMetaValue}>{new Date(episode.publish_at).toLocaleString()}</span>
              </div>
            )}
            {episode.explicit ? (
              <div className={styles.showMetaItem}>
                <span className={styles.showMetaLabel}>Explicit</span>
                <span className={styles.showMetaValue}>Yes</span>
              </div>
            ) : null}
            {episode.artwork_url && (
              <div className={styles.showMetaItem}>
                <span className={styles.showMetaLabel}>Cover Image</span>
                <div style={{ marginTop: '0.5rem' }}>
                  <img 
                    src={episode.artwork_url} 
                    alt={`${episode.title} cover`} 
                    style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: '4px' }}
                  />
                </div>
              </div>
            )}
            {episode.audio_final_path && (
              <div className={styles.showMetaItem}>
                <span className={styles.showMetaLabel}>Audio</span>
                <span className={styles.showMetaValue}>
                  {episode.audio_duration_sec != null && formatDuration(episode.audio_duration_sec)}
                </span>
                <a href={downloadEpisodeUrl(id, 'final')} download className={styles.renderDownload}>Download MP3</a>
              </div>
            )}
          </div>
        </div>
      )}

      {editing && (
        <>
          <nav className={styles.editTabs} aria-label="Edit episode">
            <button
              type="button"
              className={editTab === 'details' ? styles.editTabActive : styles.editTab}
              onClick={() => setEditTab('details')}
              aria-label="Edit episode details"
              aria-pressed={editTab === 'details'}
            >
              Details
            </button>
            <button
              type="button"
              className={editTab === 'sections' ? styles.editTabActive : styles.editTab}
              onClick={() => setEditTab('sections')}
              aria-label="Edit episode sections"
              aria-pressed={editTab === 'sections'}
            >
              Sections
            </button>
          </nav>

          {editTab === 'details' && (
          <div className={styles.card}>
            <form onSubmit={handleSubmit} className={styles.form}>
              {updateMutation.isError && (
                <p className={styles.error}>{updateMutation.error?.message}</p>
              )}
              {updateMutation.isSuccess && (
                <p className={styles.success}>Saved.</p>
              )}
              <label className={styles.label}>
                Title
                <input
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    // Auto-generate slug from title if slug is empty or was auto-generated
                    if (!slug || slug === slugify(title)) {
                      setSlug(slugify(e.target.value));
                    }
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
                  disabled={user?.role !== 'admin'}
                />
              </label>
              <label className={styles.label}>
                Description
                <textarea
                  ref={descriptionTextareaRef}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    // Auto-resize textarea
                    const textarea = e.target;
                    textarea.style.height = 'auto';
                    textarea.style.height = `${textarea.scrollHeight}px`;
                  }}
                  className={styles.textarea}
                  rows={4}
                  style={{ minHeight: '80px', overflow: 'hidden' }}
                />
              </label>
              <label className={styles.label}>
                Cover Image URL
                <input
                  type="url"
                  value={artworkUrl}
                  onChange={(e) => setArtworkUrl(e.target.value)}
                  className={styles.input}
                  placeholder="https://example.com/image.jpg"
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
                  URL for the episode cover image (optional)
                </p>
              </label>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <label className={styles.label} style={{ flex: '1 1 80px' }}>
                  Season
                  <input
                    type="number"
                    min={0}
                    value={seasonNumber}
                    onChange={(e) => setSeasonNumber(e.target.value)}
                    className={styles.input}
                  />
                </label>
                <label className={styles.label} style={{ flex: '1 1 80px' }}>
                  Episode
                  <input
                    type="number"
                    min={0}
                    value={episodeNumber}
                    onChange={(e) => setEpisodeNumber(e.target.value)}
                    className={styles.input}
                  />
                </label>
              </div>
              <label className={styles.label}>
                Status
                <div className={styles.statusToggle} role="group" aria-label="Episode status">
                  <button
                    type="button"
                    className={status === 'draft' ? styles.statusToggleActive : styles.statusToggleBtn}
                    onClick={() => setStatus('draft')}
                    aria-label="Set status to Draft"
                    aria-pressed={status === 'draft'}
                  >
                    Draft
                  </button>
                  <button
                    type="button"
                    className={status === 'scheduled' ? styles.statusToggleActive : styles.statusToggleBtn}
                    onClick={() => setStatus('scheduled')}
                    aria-label="Set status to Scheduled"
                    aria-pressed={status === 'scheduled'}
                  >
                    Scheduled
                  </button>
                  <button
                    type="button"
                    className={status === 'published' ? styles.statusToggleActive : styles.statusToggleBtn}
                    onClick={() => setStatus('published')}
                    aria-label="Set status to Published"
                    aria-pressed={status === 'published'}
                  >
                    Published
                  </button>
                </div>
              </label>
              <label className={styles.label}>
                Publish at (optional)
                <input
                  type="datetime-local"
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                  className={styles.input}
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={explicit}
                  onChange={(e) => setExplicit(e.target.checked)}
                />
                <span className="toggle__track" aria-hidden="true" />
                <span>Explicit</span>
              </label>
              <label className={styles.label}>
                Episode Type
                <select
                  value={episodeType || 'full'}
                  onChange={(e) => setEpisodeType(e.target.value as 'full' | 'trailer' | 'bonus' | '')}
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
                  value={episodeLink}
                  onChange={(e) => setEpisodeLink(e.target.value)}
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
                  checked={guidIsPermalink}
                  onChange={(e) => setGuidIsPermalink(e.target.checked)}
                />
                <span className="toggle__track" aria-hidden="true" />
                <span>GUID is permalink</span>
              </label>
              <div className={styles.actions}>
                <button type="button" className={styles.cancel} onClick={() => setEditing(false)} aria-label="Cancel editing episode">
                  Cancel
                </button>
                <button type="submit" className={styles.submit} disabled={updateMutation.isPending} aria-label="Save episode changes">
                  {updateMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
          )}

          {editTab === 'sections' && (
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>Build your episode</h2>
            <p className={styles.sectionSub}>
              Add sections in order: record new audio or insert from your reuse library (ads, intros, etc.). Then build the final MP3 below.
            </p>
            <div className={styles.addSectionChoiceRow}>
              <button
                type="button"
                className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary}`}
                onClick={() => setShowRecord(true)}
              >
                <Mic size={24} strokeWidth={2} aria-hidden />
                <span>Record new section</span>
              </button>
              <button
                type="button"
                className={styles.addSectionChoiceBtn}
                onClick={() => setShowLibrary(true)}
              >
                <Library size={24} strokeWidth={2} aria-hidden />
                <span>Insert from library</span>
              </button>
            </div>

            {segmentsLoading ? (
              <p className={styles.success}>Loading sections…</p>
            ) : segments.length === 0 ? (
              <p className={styles.success}>No sections yet. Record or add from library above.</p>
            ) : (
              <ul className={styles.segmentList}>
                {segments.map((seg, index) => (
                <SegmentRow
                  key={seg.id}
                  episodeId={id!}
                  segment={seg}
                  index={index}
                  total={segments.length}
                  onMoveUp={() => handleMoveUp(index)}
                  onMoveDown={() => handleMoveDown(index)}
                  onDeleteRequest={() => setSegmentToDelete(seg.id)}
                  onUpdateName={(segmentId, name) => updateSegmentMutation.mutate({ segmentId, name })}
                  isDeleting={deleteSegmentMutation.isPending && deleteSegmentMutation.variables === seg.id}
                  onPlayRequest={handleSegmentPlayRequest}
                  onMoreInfo={() => setSegmentIdForInfo(seg.id)}
                  registerPause={registerSegmentPause}
                  unregisterPause={unregisterSegmentPause}
                />
                ))}
              </ul>
            )}

            <div className={styles.renderRow}>
              <div className={styles.renderCard}>
                <div className={styles.renderHeader}>
                  <div>
                    <h3 className={styles.renderTitle}>Generate final episode</h3>
                    <p className={styles.renderSub}>
                      When you are ready, generate the final audio file from your sections. This will rebuild the episode audio.
                    </p>
                  </div>
                </div>
                <div className={styles.renderActions}>
                  <button
                    type="button"
                    className={styles.renderBtnSecondary}
                    onClick={previewingFinal ? stopPreviewSequence : startPreviewSequence}
                    disabled={segments.length === 0}
                  >
                    {previewingFinal ? <Pause size={18} strokeWidth={2} aria-hidden /> : <Play size={18} strokeWidth={2} aria-hidden />}
                    <span>{previewingFinal ? 'Stop preview' : 'Preview sections'}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.renderBtnPrimary}
                    onClick={() => renderMutation.mutate()}
                    disabled={segments.length === 0 || renderMutation.isPending}
                  >
                    <FileAudio size={20} strokeWidth={2} aria-hidden />
                    <span>{renderMutation.isPending ? 'Building…' : 'Build Final Episode'}</span>
                  </button>
                  {episode.audio_final_path && (
                    <a href={downloadEpisodeUrl(id, 'final')} download className={styles.renderDownload}>
                      Download final audio
                    </a>
                  )}
                </div>
                {renderMutation.isError && (
                  <span className={styles.error}>{renderMutation.error?.message}</span>
                )}
              </div>
            </div>
            <audio ref={finalPreviewRef} style={{ display: 'none' }} />
          </div>
          )}
        </>
      )}

      {showRecord && (
        <RecordModal
          onClose={() => setShowRecord(false)}
          onAdd={(file, name) => addRecordedMutation.mutate({ file, name })}
          isAdding={addRecordedMutation.isPending}
          error={addRecordedMutation.isError ? addRecordedMutation.error?.message : undefined}
        />
      )}
      {showLibrary && (
        <LibraryModal
          onClose={() => setShowLibrary(false)}
          onSelect={(assetId) => addReusableMutation.mutate(assetId)}
          isAdding={addReusableMutation.isPending}
          error={addReusableMutation.isError ? addReusableMutation.error?.message : undefined}
        />
      )}

      {segmentIdForInfo && (
        <TranscriptModal
          episodeId={id!}
          segmentId={segmentIdForInfo}
          segmentName={segments.find((s) => s.id === segmentIdForInfo)?.name?.trim() || 'Section'}
          segmentDuration={segments.find((s) => s.id === segmentIdForInfo)?.duration_sec ?? 0}
          asrAvailable={Boolean(asrAvail?.available)}
          onClose={() => setSegmentIdForInfo(null)}
          onDeleteEntry={(entryIndex) => {
            setTranscriptEntryToDelete({ episodeId: id!, segmentId: segmentIdForInfo, entryIndex });
          }}
        />
      )}

      <DeleteTranscriptSegmentDialog
        open={transcriptEntryToDelete !== null}
        onOpenChange={(open) => !open && setTranscriptEntryToDelete(null)}
        onConfirm={async () => {
          if (transcriptEntryToDelete) {
            try {
              await deleteSegmentTranscript(transcriptEntryToDelete.episodeId, transcriptEntryToDelete.segmentId, transcriptEntryToDelete.entryIndex);
              queryClient.invalidateQueries({ queryKey: ['segments', transcriptEntryToDelete.episodeId] });
              setTranscriptEntryToDelete(null);
              // If transcript modal is open, we need to trigger a reload
              // The TranscriptModal will reload when segmentId changes, so we can close and reopen it
              if (segmentIdForInfo === transcriptEntryToDelete.segmentId) {
                const currentSegmentId = segmentIdForInfo;
                setSegmentIdForInfo(null);
                // Small delay to ensure state updates, then reopen
                setTimeout(() => {
                  setSegmentIdForInfo(currentSegmentId);
                }, 100);
              }
            } catch (err) {
              console.error('Failed to delete transcript entry:', err);
            }
          }
        }}
        isDeleting={false}
      />

      <Dialog.Root open={!!segmentToDelete} onOpenChange={(open) => !open && setSegmentToDelete(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <Dialog.Title className={styles.dialogTitle}>Remove section?</Dialog.Title>
            <p className={styles.dialogDescription}>
              {segmentToDelete && (() => {
                const seg = segments.find((s) => s.id === segmentToDelete);
                const name = seg?.name?.trim() || (seg?.type === 'recorded' ? 'Recorded section' : seg?.asset_name) || 'This section';
                return `"${name}" will be removed. This cannot be undone.`;
              })()}
            </p>
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel} aria-label="Cancel removing section">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className={styles.dialogConfirmRemove}
                onClick={() => {
                  if (segmentToDelete) {
                    deleteSegmentMutation.mutate(segmentToDelete);
                    setSegmentToDelete(null);
                  }
                }}
                disabled={deleteSegmentMutation.isPending}
                aria-label="Confirm remove section"
              >
                {deleteSegmentMutation.isPending && deleteSegmentMutation.variables === segmentToDelete ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function TranscriptModal({
  episodeId,
  segmentId,
  segmentName,
  segmentDuration,
  asrAvailable,
  onClose,
  onDeleteEntry,
}: {
  episodeId: string;
  segmentId: string;
  segmentName: string;
  segmentDuration: number;
  asrAvailable: boolean;
  onClose: () => void;
  onDeleteEntry?: (entryIndex: number) => void;
}) {
  function isRateLimitMessage(msg: string | null): boolean {
    return (msg || '').toLowerCase().includes('too many requests');
  }

  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState<'view' | 'ask' | 'edit'>('view');
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');
  const [trimming, setTrimming] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [previewingStart, setPreviewingStart] = useState(false);
  const [previewingEnd, setPreviewingEnd] = useState(false);
  const [trimConfirmOpen, setTrimConfirmOpen] = useState(false);
  const [pendingTrimAction, setPendingTrimAction] = useState<{ isStart: boolean; timeSec: number } | null>(null);
  const [removingSilence, setRemovingSilence] = useState(false);
  const [removeSilenceConfirmOpen, setRemoveSilenceConfirmOpen] = useState(false);
  const [applyingNoiseSuppression, setApplyingNoiseSuppression] = useState(false);
  const [noiseSuppressionConfirmOpen, setNoiseSuppressionConfirmOpen] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const previewTimeHandlerRef = useRef<(() => void) | null>(null);
  const [askQuestion, setAskQuestion] = useState('');
  const [askResponse, setAskResponse] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [playingEntryIndex, setPlayingEntryIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timeUpdateHandlerRef = useRef<(() => void) | null>(null);
  const queryClient = useQueryClient();

  const { data: llmData } = useQuery({
    queryKey: ['settings', 'llm-available'],
    queryFn: () => getLlmAvailable(),
  });
  const llmAvailable = llmData?.available ?? false;

  const askMutation = useMutation({
    mutationFn: ({ transcript, question }: { transcript: string; question: string }) => askLlm(transcript, question),
    onSuccess: (data) => {
      setAskResponse(data.response);
      setAskError(null);
    },
    onError: (err) => {
      setAskResponse(null);
      setAskError(err instanceof Error ? err.message : 'Failed to get response');
    },
  });

  const deleteTranscriptMutation = useMutation({
    mutationFn: (entryIndex?: number) => deleteSegmentTranscript(episodeId, segmentId, entryIndex),
    onSuccess: (data) => {
      if (data.text !== undefined) {
        // Entry was deleted, update transcript text
        setText(data.text);
      } else {
        // Entire transcript was deleted
        setText(null);
        setNotFound(true);
      }
      queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
    },
  });

  function handleDeleteTranscriptEntry(entryIndex: number) {
    if (onDeleteEntry) {
      onDeleteEntry(entryIndex);
    } else {
      deleteTranscriptMutation.mutate(entryIndex);
    }
  }

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setGenerateError(null);
    setText(null);
    setMode('view');
    setAskQuestion('');
    setAskResponse(null);
    setAskError(null);
    setPlayingEntryIndex(null);
    setTrimStart('');
    setTrimEnd('');
    setTrimError(null);
    setPreviewingStart(false);
    setPreviewingEnd(false);
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.src = '';
      if (timeUpdateHandlerRef.current) {
        el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
        timeUpdateHandlerRef.current = null;
      }
    }
    const previewEl = previewAudioRef.current;
    if (previewEl) {
      previewEl.pause();
      previewEl.src = '';
      if (previewTimeHandlerRef.current) {
        previewEl.removeEventListener('timeupdate', previewTimeHandlerRef.current);
        previewTimeHandlerRef.current = null;
      }
    }
    getSegmentTranscript(episodeId, segmentId)
      .then((r) => {
        setText(r.text);
        setNotFound(false);
      })
      .catch((err) => {
        if (err?.message === 'Transcript not found') setNotFound(true);
        else setGenerateError(err?.message ?? 'Failed to load transcript');
      })
      .finally(() => setLoading(false));
    return () => {
      // Cleanup on unmount or segment change
      const cleanupPreviewEl = previewAudioRef.current;
      if (cleanupPreviewEl) {
        cleanupPreviewEl.pause();
        cleanupPreviewEl.src = '';
        if (previewTimeHandlerRef.current) {
          cleanupPreviewEl.removeEventListener('timeupdate', previewTimeHandlerRef.current);
          previewTimeHandlerRef.current = null;
        }
      }
    };
  }, [episodeId, segmentId]);

  useEffect(() => {
    // When switching to edit mode from ask/view, reset form and stop playback
    if (mode === 'edit') {
      // Stop any playing audio
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.src = '';
        if (timeUpdateHandlerRef.current) {
          el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
          timeUpdateHandlerRef.current = null;
        }
      }
      // Stop preview audio
      const previewEl = previewAudioRef.current;
      if (previewEl) {
        previewEl.pause();
        previewEl.src = '';
        if (previewTimeHandlerRef.current) {
          previewEl.removeEventListener('timeupdate', previewTimeHandlerRef.current);
          previewTimeHandlerRef.current = null;
        }
      }
      // Reset form and playback state
      setTrimStart('');
      setTrimEnd('');
      setTrimError(null);
      setPreviewingStart(false);
      setPreviewingEnd(false);
      setPlayingEntryIndex(null);
    }
  }, [mode]);

  function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    generateSegmentTranscript(episodeId, segmentId, true) // true = regenerate even if transcript exists
      .then((r) => {
        setText(r.text);
        setNotFound(false);
      })
      .catch((err) => setGenerateError(err?.message ?? 'Failed to generate transcript'))
      .finally(() => setGenerating(false));
  }

  function extractTextFromSrt(srtText: string): string {
    if (!srtText || !srtText.includes('-->')) {
      // Not SRT format, return as-is
      return srtText;
    }
    const entries = parseSrt(srtText);
    return entries.map((entry) => entry.text).join(' ');
  }

  function handleAskSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = askQuestion.trim();
    if (!q) return;
    const transcriptText = text ? extractTextFromSrt(text) : '';
    askMutation.mutate({ transcript: transcriptText, question: q });
  }

  function parseSrt(srtText: string): Array<{ start: string; end: string; text: string }> {
    const entries: Array<{ start: string; end: string; text: string }> = [];
    const blocks = srtText.split(/\n\s*\n/).filter((b) => b.trim());
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 3) continue;
      const timeLine = lines[1]?.trim();
      if (!timeLine || !timeLine.includes('-->')) continue;
      const [start, end] = timeLine.split('-->').map((s) => s.trim());
      const text = lines.slice(2).join('\n').trim();
      if (start && end && text) {
        entries.push({ start, end, text });
      }
    }
    return entries;
  }

  function formatSrtTime(timeStr: string): string {
    // Keep full precision including milliseconds
    // Format: HH:MM:SS,mmm -> show as MM:SS.mmm or HH:MM:SS.mmm if hours > 0
    const normalized = timeStr.replace(',', '.');
    const parts = normalized.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0] || '0', 10);
      const minutes = parts[1] || '00';
      const seconds = parts[2] || '00.000';
      if (hours === 0) {
        return `${minutes}:${seconds}`;
      }
      return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
    }
    return timeStr;
  }

  function parseSrtTimeToSeconds(timeStr: string): number {
    const normalized = timeStr.replace(',', '.');
    const parts = normalized.split(':');
    if (parts.length !== 3) return 0;
    const hours = parseFloat(parts[0] || '0');
    const minutes = parseFloat(parts[1] || '0');
    const seconds = parseFloat(parts[2] || '0');
    return hours * 3600 + minutes * 60 + seconds;
  }

  function formatSrtTimeFromSeconds(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  }

  function adjustTranscriptTime(entryIndex: number, isStart: boolean, adjustMs: number) {
    if (!srtEntries) return;
    const entry = srtEntries[entryIndex];
    if (!entry) return;
    
    const currentTime = isStart ? entry.start : entry.end;
    const currentSeconds = parseSrtTimeToSeconds(currentTime);
    const newSeconds = Math.max(0, currentSeconds + adjustMs / 1000);
    const newTime = formatSrtTimeFromSeconds(newSeconds);
    
    // Update local state immediately for responsive UI
    const updatedEntries = [...srtEntries];
    if (isStart) {
      updatedEntries[entryIndex] = { ...entry, start: newTime };
    } else {
      updatedEntries[entryIndex] = { ...entry, end: newTime };
    }
    
    // Rebuild SRT text
    const updatedSrt = updatedEntries
      .map((e, i) => {
        return `${i + 1}\n${e.start} --> ${e.end}\n${e.text}\n`;
      })
      .join('\n');
    
    // Update transcript on server
    updateSegmentTranscript(episodeId, segmentId, updatedSrt)
      .then(() => {
        setText(updatedSrt);
      })
      .catch((err) => {
        console.error('Failed to update transcript:', err);
        // Revert on error
        setText(text);
      });
  }

  function handleTrimSubmit(e: React.FormEvent) {
    e.preventDefault();
  }

  function handlePreview(isStart: boolean) {
    const el = previewAudioRef.current;
    if (!el) return;
    
    const timeValue = isStart ? trimStart : trimEnd;
    const timeSec = parseFloat(timeValue);
    if (Number.isNaN(timeSec) || timeSec < 0) {
      setTrimError('Invalid time value');
      return;
    }
    
    const totalDurationSec = segmentDuration;
    
    if (isStart) {
      // Preview trim start: play from trimStart for 10 seconds
      if (previewingStart) {
        el.pause();
        setPreviewingStart(false);
        if (previewTimeHandlerRef.current) {
          el.removeEventListener('timeupdate', previewTimeHandlerRef.current);
          previewTimeHandlerRef.current = null;
        }
      } else {
        // Stop any other preview
        if (previewingEnd) {
          el.pause();
          setPreviewingEnd(false);
        }
        if (previewTimeHandlerRef.current) {
          el.removeEventListener('timeupdate', previewTimeHandlerRef.current);
        }
        
        setPreviewingStart(true);
        setPreviewingEnd(false);
        setTrimError(null);
        
        const onTimeUpdate = () => {
          const elapsed = el.currentTime - timeSec;
          if (elapsed >= 10 || el.currentTime >= totalDurationSec) {
            el.pause();
            setPreviewingStart(false);
            el.removeEventListener('timeupdate', onTimeUpdate);
            previewTimeHandlerRef.current = null;
          }
        };
        previewTimeHandlerRef.current = onTimeUpdate;
        
        // Reset and load new source
        el.pause();
        el.currentTime = 0;
        const audioUrl = segmentStreamUrl(episodeId, segmentId);
        el.src = audioUrl;
        el.load(); // Force reload
        
        const onSeeked = () => {
          // Verify we actually seeked to the right position (within 0.5 seconds)
          const actualTime = el.currentTime;
          if (Math.abs(actualTime - timeSec) > 0.5) {
            // Seek didn't work, try again
            console.warn(`Seek to ${timeSec} failed, actual time is ${actualTime}, retrying...`);
            setTimeout(() => {
              el.currentTime = timeSec;
            }, 100);
            return;
          }
          // Now that we've seeked, start playing
          el.addEventListener('timeupdate', onTimeUpdate);
          el.play().catch(() => {
            setPreviewingStart(false);
            el.removeEventListener('timeupdate', onTimeUpdate);
            previewTimeHandlerRef.current = null;
          });
        };
        
        const attemptSeek = () => {
          try {
            // Wait for seekable ranges to be available
            if (el.seekable.length > 0) {
              const maxSeekable = el.seekable.end(0);
              const targetTime = Math.min(timeSec, maxSeekable);
              if (targetTime < el.seekable.start(0)) {
                // Can't seek to this position yet, wait a bit
                setTimeout(attemptSeek, 100);
                return;
              }
              el.currentTime = targetTime;
              // Wait for seek to complete
              el.addEventListener('seeked', onSeeked, { once: true });
            } else {
              // If not seekable yet, try again shortly
              setTimeout(attemptSeek, 100);
            }
          } catch (err) {
            console.error('Failed to seek audio:', err);
            setPreviewingStart(false);
            previewTimeHandlerRef.current = null;
          }
        };
        
        const onCanPlay = () => {
          attemptSeek();
        };
        
        el.addEventListener('canplay', onCanPlay, { once: true });
      }
    } else {
      // Preview trim end: play last 10 seconds before trim end, then stop
      if (previewingEnd) {
        el.pause();
        setPreviewingEnd(false);
        if (previewTimeHandlerRef.current) {
          el.removeEventListener('timeupdate', previewTimeHandlerRef.current);
          previewTimeHandlerRef.current = null;
        }
      } else {
        // Stop any other preview
        if (previewingStart) {
          el.pause();
          setPreviewingStart(false);
        }
        if (previewTimeHandlerRef.current) {
          el.removeEventListener('timeupdate', previewTimeHandlerRef.current);
        }
        
        setPreviewingEnd(true);
        setPreviewingStart(false);
        setTrimError(null);
        
        const endTimeSec = totalDurationSec - timeSec; // trim end is duration to remove from end
        const startTimeSec = Math.max(0, endTimeSec - 10);
        
        const onTimeUpdate = () => {
          if (el.currentTime >= endTimeSec || el.currentTime >= totalDurationSec) {
            el.pause();
            setPreviewingEnd(false);
            el.removeEventListener('timeupdate', onTimeUpdate);
            previewTimeHandlerRef.current = null;
          }
        };
        previewTimeHandlerRef.current = onTimeUpdate;
        
        const onLoadedMetadata = () => {
          el.currentTime = startTimeSec;
          el.addEventListener('timeupdate', onTimeUpdate);
          el.play().catch(() => {
            setPreviewingEnd(false);
            el.removeEventListener('timeupdate', onTimeUpdate);
            previewTimeHandlerRef.current = null;
          });
        };
        
        el.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
        el.src = segmentStreamUrl(episodeId, segmentId);
        if (el.readyState >= 2) {
          onLoadedMetadata();
        }
      }
    }
  }

  function handleTrimClick(isStart: boolean) {
    const timeValue = isStart ? trimStart : trimEnd;
    const timeSec = parseFloat(timeValue);
    if (Number.isNaN(timeSec) || timeSec < 0) {
      setTrimError('Invalid time value');
      return;
    }
    
    // Show confirmation dialog
    setPendingTrimAction({ isStart, timeSec });
    setTrimConfirmOpen(true);
  }

  function handleTrimConfirm() {
    if (!pendingTrimAction) return;
    
    const { isStart, timeSec } = pendingTrimAction;
    setTrimConfirmOpen(false);
    setTrimming(true);
    setTrimError(null);
    
    const totalDurationSec = segmentDuration;
    
    // For trim end, calculate absolute end time (duration - trimEnd)
    const endSec = isStart ? undefined : (totalDurationSec - timeSec);
    
    trimSegmentAudio(episodeId, segmentId, isStart ? timeSec : undefined, endSec)
      .then(() => {
        // Reset form
        setTrimStart('');
        setTrimEnd('');
        // Reload segments
        queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
        // Generate new transcript after trimming
        return generateSegmentTranscript(episodeId, segmentId, true);
      })
      .then((r) => {
        setText(r.text);
        setNotFound(false);
      })
      .catch((err) => {
        setTrimError(err?.message ?? 'Failed to trim audio');
      })
      .finally(() => {
        setTrimming(false);
        setPendingTrimAction(null);
      });
  }

  function handleRemoveSilenceClick() {
    setRemoveSilenceConfirmOpen(true);
  }

  function handleNoiseSuppressionClick() {
    setNoiseSuppressionConfirmOpen(true);
  }

  function handleNoiseSuppressionConfirm() {
    setNoiseSuppressionConfirmOpen(false);
    setApplyingNoiseSuppression(true);
    setTrimError(null);
    applyNoiseSuppressionToSegment(episodeId, segmentId, -45)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
        // Reload transcript display if one exists (audio path changed); no transcript is fine
        return getSegmentTranscript(episodeId, segmentId)
          .then((r) => {
            setText(r.text ?? null);
            setNotFound(r.text == null);
          })
          .catch(() => {
            setText(null);
            setNotFound(true);
          });
      })
      .catch((err) => {
        setTrimError(err?.message ?? 'Failed to apply noise suppression');
      })
      .finally(() => {
        setApplyingNoiseSuppression(false);
      });
  }

  function handleRemoveSilenceConfirm() {
    setRemoveSilenceConfirmOpen(false);
    setRemovingSilence(true);
    setTrimError(null);
    
    removeSilenceFromSegment(episodeId, segmentId, 1.5, -55)
      .then(() => {
        // Reset form
        setTrimStart('');
        setTrimEnd('');
        // Reload segments
        queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
        // Generate new transcript after removing silence
        return generateSegmentTranscript(episodeId, segmentId, true);
      })
      .then((r) => {
        setText(r.text);
        setNotFound(false);
      })
      .catch((err) => {
        setTrimError(err?.message ?? 'Failed to remove silence');
      })
      .finally(() => {
        setRemovingSilence(false);
      });
  }

  function handlePlayEntry(index: number, startTime: string, endTime: string) {
    const el = audioRef.current;
    if (!el) return;
    const startSec = parseSrtTimeToSeconds(startTime);
    const endSec = parseSrtTimeToSeconds(endTime);
    if (playingEntryIndex === index) {
      el.pause();
      setPlayingEntryIndex(null);
      if (timeUpdateHandlerRef.current) {
        el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
        timeUpdateHandlerRef.current = null;
      }
    } else {
      if (playingEntryIndex !== null) {
        el.pause();
        if (timeUpdateHandlerRef.current) {
          el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
          timeUpdateHandlerRef.current = null;
        }
      }
      setPlayingEntryIndex(index);
      const onTimeUpdate = () => {
        if (el.currentTime >= endSec) {
          el.pause();
          setPlayingEntryIndex(null);
          if (timeUpdateHandlerRef.current) {
            el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
            timeUpdateHandlerRef.current = null;
          }
        }
      };
      timeUpdateHandlerRef.current = onTimeUpdate;
      el.addEventListener('timeupdate', onTimeUpdate);
      el.src = segmentStreamUrl(episodeId, segmentId);
      const onLoadedMetadata = () => {
        el.currentTime = startSec;
        el.play().catch(() => {
          setPlayingEntryIndex(null);
          if (timeUpdateHandlerRef.current) {
            el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
            timeUpdateHandlerRef.current = null;
          }
        });
        el.removeEventListener('loadedmetadata', onLoadedMetadata);
      };
      el.addEventListener('loadedmetadata', onLoadedMetadata);
      if (el.readyState >= 2) {
        onLoadedMetadata();
      }
    }
  }


  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPause = () => {
      if (el.paused && playingEntryIndex !== null) {
        setPlayingEntryIndex(null);
        if (timeUpdateHandlerRef.current) {
          el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
          timeUpdateHandlerRef.current = null;
        }
      }
    };
    el.addEventListener('pause', onPause);
    return () => {
      el.removeEventListener('pause', onPause);
    };
  }, [playingEntryIndex]);

  const hasTranscript = !loading && text != null && text.trim() !== '';
  const showTranscriptModeBar = asrAvailable || llmAvailable;
  const srtEntries = text && text.includes('-->') ? parseSrt(text) : null;

  // If ASR isn't configured, default to Edit (since View/regen are not available).
  useEffect(() => {
    if (!asrAvailable && mode === 'view') {
      setMode('edit');
    }
  }, [asrAvailable, mode]);

  // If neither ASR nor LLM is configured, keep mode on Edit (no tab bar).
  useEffect(() => {
    if (!asrAvailable && !llmAvailable && mode !== 'edit') {
      setMode('edit');
    }
  }, [asrAvailable, llmAvailable, mode]);

  // If ask becomes unavailable while on Ask tab (no LLM or no transcript), fall back.
  useEffect(() => {
    if (mode === 'ask' && (!llmAvailable || !hasTranscript)) {
      setMode(asrAvailable ? 'view' : 'edit');
    }
  }, [mode, llmAvailable, asrAvailable, hasTranscript]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={`${styles.dialogContent} ${styles.dialogContentWide}`}>
          <Dialog.Title className={styles.dialogTitle}>{segmentName}</Dialog.Title>
          <div className={styles.dialogDescription}>
            {showTranscriptModeBar && (
              <div className={styles.transcriptToggleWrap}>
                <div className={styles.transcriptToggle} role="tablist" aria-label="Transcript mode">
                  {asrAvailable && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'view'}
                      aria-label="View transcript"
                      className={mode === 'view' ? styles.transcriptToggleActive : styles.transcriptToggleBtn}
                      onClick={() => setMode('view')}
                    >
                      View
                    </button>
                  )}
                  {llmAvailable && hasTranscript && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'ask'}
                      aria-label="Ask questions about transcript"
                      className={mode === 'ask' ? styles.transcriptToggleActive : styles.transcriptToggleBtn}
                      onClick={() => setMode('ask')}
                    >
                      Ask
                    </button>
                  )}
                  {showTranscriptModeBar && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'edit'}
                      aria-label="Edit transcript"
                      className={mode === 'edit' ? styles.transcriptToggleActive : styles.transcriptToggleBtn}
                      onClick={() => setMode('edit')}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            )}
            {loading && <p>Loading…</p>}
            {!loading && text != null && mode === 'view' && (
              <>
                {srtEntries ? (
                  <>
                    <div className={styles.transcriptCards}>
                      {srtEntries.map((entry, i) => (
                        <div key={i} className={styles.transcriptCard}>
                          <div className={styles.transcriptCardText}>{entry.text}</div>
                          <div className={styles.transcriptCardFooter}>
                            <div className={styles.transcriptCardTimeControls}>
                              <div className={styles.transcriptCardTimeGroup}>
                                <div className={styles.transcriptCardTimeButtons}>
                                  <button
                                    type="button"
                                    className={styles.transcriptCardTimeBtn}
                                    onClick={() => adjustTranscriptTime(i, true, -200)}
                                    title="Subtract 200ms from start"
                                    aria-label={`Subtract 200ms from start time of segment ${i + 1}`}
                                  >
                                    <Minus size={12} aria-hidden />
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.transcriptCardTimeBtn}
                                    onClick={() => adjustTranscriptTime(i, true, 200)}
                                    title="Add 200ms to start"
                                    aria-label={`Add 200ms to start time of segment ${i + 1}`}
                                  >
                                    <Plus size={12} aria-hidden />
                                  </button>
                                </div>
                                <span className={styles.transcriptCardTimeLabel}>Start: {formatSrtTime(entry.start)}</span>
                              </div>
                              <div className={styles.transcriptCardTimeGroup}>
                                <div className={styles.transcriptCardTimeButtons}>
                                  <button
                                    type="button"
                                    className={styles.transcriptCardTimeBtn}
                                    onClick={() => adjustTranscriptTime(i, false, -200)}
                                    title="Subtract 200ms from end"
                                    aria-label={`Subtract 200ms from end time of segment ${i + 1}`}
                                  >
                                    <Minus size={12} aria-hidden />
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.transcriptCardTimeBtn}
                                    onClick={() => adjustTranscriptTime(i, false, 200)}
                                    title="Add 200ms to end"
                                    aria-label={`Add 200ms to end time of segment ${i + 1}`}
                                  >
                                    <Plus size={12} aria-hidden />
                                  </button>
                                </div>
                                <span className={styles.transcriptCardTimeLabel}>End: {formatSrtTime(entry.end)}</span>
                              </div>
                            </div>
                            <div className={styles.transcriptCardFooterActions}>
                              <button
                                type="button"
                                className={styles.transcriptCardBtn}
                                onClick={() => handlePlayEntry(i, entry.start, entry.end)}
                                title={playingEntryIndex === i ? 'Pause' : 'Play'}
                                aria-label={playingEntryIndex === i ? `Pause transcript segment ${i + 1}` : `Play transcript segment ${i + 1}`}
                              >
                                {playingEntryIndex === i ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                              </button>
                              <button
                                type="button"
                                className={styles.transcriptCardBtn}
                                onClick={() => handleDeleteTranscriptEntry(i)}
                                disabled={deleteTranscriptMutation.isPending}
                                title="Delete this segment"
                                aria-label={`Delete transcript segment ${i + 1}`}
                              >
                                <Trash2 size={14} aria-hidden />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <audio ref={audioRef} style={{ display: 'none' }} />
                  </>
                ) : (
                  <pre className={styles.transcriptText}>{text || '(empty)'}</pre>
                )}
                {generateError && (
                  <p className={`${styles.error} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}>
                    {generateError}
                  </p>
                )}
              </>
            )}
            {!loading && text != null && mode === 'ask' && (
              <div className={styles.transcriptAsk}>
                <form onSubmit={handleAskSubmit} className={styles.transcriptAskForm}>
                  <input
                    type="text"
                    className={styles.transcriptAskInput}
                    placeholder="Ask something about this transcript…"
                    value={askQuestion}
                    onChange={(e) => setAskQuestion(e.target.value)}
                    disabled={askMutation.isPending}
                    aria-label="Question"
                  />
                  <button type="submit" className={styles.transcriptAskSubmit} disabled={askMutation.isPending || !askQuestion.trim()} aria-label="Submit question">
                    {askMutation.isPending ? '…' : 'Submit'}
                  </button>
                </form>
                {askError && (
                  <p className={`${styles.error} ${isRateLimitMessage(askError) ? styles.rateLimitError : ''}`}>
                    {askError}
                  </p>
                )}
                {askResponse != null && (
                  <div className={styles.transcriptAskResponse}>
                    {askResponse}
                  </div>
                )}
              </div>
            )}
            {!loading && mode === 'edit' && (
              <div className={styles.transcriptEdit}>
                <form onSubmit={handleTrimSubmit} className={styles.transcriptEditForm}>
                  <div className={styles.transcriptEditGroup}>
                    <label className={styles.transcriptEditLabel}>
                      Trim start (seconds)
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        className={styles.transcriptEditInput}
                        placeholder="0.000"
                        value={trimStart}
                        onChange={(e) => setTrimStart(e.target.value)}
                        disabled={trimming || previewingStart || previewingEnd}
                        aria-label="Trim start time"
                      />
                    </label>
                    <div className={styles.transcriptEditActions}>
                      <button
                        type="button"
                        className={styles.transcriptEditPreviewBtn}
                        onClick={() => handlePreview(true)}
                        disabled={trimming || !trimStart.trim() || previewingEnd}
                        title="Preview 10 seconds from trim start"
                        aria-label={previewingStart ? 'Pause preview' : 'Preview 10 seconds from trim start'}
                      >
                        {previewingStart ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                      </button>
                      <button
                        type="button"
                        className={styles.transcriptEditBtn}
                        onClick={() => handleTrimClick(true)}
                        disabled={trimming || !trimStart.trim() || previewingStart || previewingEnd}
                        aria-label="Trim start of segment"
                      >
                        {trimming ? 'Trimming…' : 'Trim Start'}
                      </button>
                    </div>
                  </div>
                  <div className={styles.transcriptEditGroup}>
                    <label className={styles.transcriptEditLabel}>
                      Trim end (seconds to remove)
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        className={styles.transcriptEditInput}
                        placeholder="0.000"
                        value={trimEnd}
                        onChange={(e) => setTrimEnd(e.target.value)}
                        disabled={trimming || previewingStart || previewingEnd}
                        aria-label="Seconds to trim from end"
                      />
                    </label>
                    <div className={styles.transcriptEditActions}>
                      <button
                        type="button"
                        className={styles.transcriptEditPreviewBtn}
                        onClick={() => handlePreview(false)}
                        disabled={trimming || !trimEnd.trim() || previewingStart}
                        title="Preview last 10 seconds before trim end"
                        aria-label={previewingEnd ? 'Pause preview' : 'Preview last 10 seconds before trim end'}
                      >
                        {previewingEnd ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                      </button>
                      <button
                        type="button"
                        className={styles.transcriptEditBtn}
                        onClick={() => handleTrimClick(false)}
                        disabled={trimming || !trimEnd.trim() || previewingStart || previewingEnd}
                        aria-label="Trim end of segment"
                      >
                        {trimming ? 'Trimming…' : 'Trim End'}
                      </button>
                    </div>
                  </div>
                  {trimError && (
                    <p className={`${styles.error} ${isRateLimitMessage(trimError) ? styles.rateLimitError : ''}`}>
                      {trimError}
                    </p>
                  )}
                  <div className={styles.transcriptEditGroup}>
                    <button
                      type="button"
                      className={styles.transcriptEditBtn}
                      onClick={handleRemoveSilenceClick}
                      disabled={trimming || removingSilence || applyingNoiseSuppression || previewingStart || previewingEnd}
                      style={{ width: '100%', marginTop: '0.5rem' }}
                      aria-label="Remove silence from segment"
                    >
                      {removingSilence ? 'Removing Silence…' : 'Remove Silence'}
                    </button>
                    <button
                      type="button"
                      className={styles.transcriptEditBtn}
                      onClick={handleNoiseSuppressionClick}
                      disabled={trimming || removingSilence || applyingNoiseSuppression || previewingStart || previewingEnd}
                      style={{ width: '100%', marginTop: '0.5rem' }}
                      aria-label="Apply noise suppression to segment"
                    >
                      {applyingNoiseSuppression ? 'Applying…' : 'Noise Suppression'}
                    </button>
                  </div>
                </form>
                <audio ref={previewAudioRef} style={{ display: 'none' }} />
              </div>
            )}
            <Dialog.Root open={trimConfirmOpen} onOpenChange={(open) => {
              if (!open) {
                setTrimConfirmOpen(false);
                setPendingTrimAction(null);
              }
            }}>
              <Dialog.Portal>
                <Dialog.Overlay className={styles.dialogOverlay} />
                <Dialog.Content
                  className={styles.dialogContent}
                  onEscapeKeyDown={(e) => {
                    e.stopPropagation();
                  }}
                  onPointerDownOutside={(e) => {
                    e.preventDefault();
                  }}
                  onInteractOutside={(e) => {
                    e.preventDefault();
                  }}
                >
                  <Dialog.Title className={styles.dialogTitle}>
                    Confirm Trim
                  </Dialog.Title>
                  <Dialog.Description className={styles.dialogDescription}>
                    {pendingTrimAction?.isStart
                      ? `Are you sure you want to trim ${pendingTrimAction.timeSec.toFixed(3)} seconds from the start? This will update the audio file and generate a new transcript.`
                      : `Are you sure you want to trim ${pendingTrimAction?.timeSec.toFixed(3) ?? 0} seconds from the end? This will update the audio file and generate a new transcript.`}
                  </Dialog.Description>
                  <div className={styles.dialogActions}>
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTrimConfirmOpen(false);
                        setPendingTrimAction(null);
                      }}
                      aria-label="Cancel trim operation"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.dialogConfirmRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTrimConfirm();
                      }}
                      disabled={trimming}
                      aria-label="Confirm trim operation"
                    >
                      {trimming ? 'Trimming…' : 'Confirm'}
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <Dialog.Root open={removeSilenceConfirmOpen} onOpenChange={(open) => {
              if (!open) {
                setRemoveSilenceConfirmOpen(false);
              }
            }}>
              <Dialog.Portal>
                <Dialog.Overlay className={styles.dialogOverlay} />
                <Dialog.Content
                  className={styles.dialogContent}
                  onEscapeKeyDown={(e) => {
                    e.stopPropagation();
                  }}
                  onPointerDownOutside={(e) => {
                    e.preventDefault();
                  }}
                  onInteractOutside={(e) => {
                    e.preventDefault();
                  }}
                >
                  <Dialog.Title className={styles.dialogTitle}>
                    Remove Silence
                  </Dialog.Title>
                  <Dialog.Description className={styles.dialogDescription}>
                    Are you sure you want to remove all silence periods longer than 2 seconds? This will update the audio file and generate a new transcript.
                  </Dialog.Description>
                  <div className={styles.dialogActions}>
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRemoveSilenceConfirmOpen(false);
                      }}
                      aria-label="Cancel removing silence"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.dialogConfirmRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveSilenceConfirm();
                      }}
                      disabled={removingSilence}
                      aria-label="Confirm remove silence"
                    >
                      {removingSilence ? 'Removing…' : 'Confirm'}
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <Dialog.Root open={noiseSuppressionConfirmOpen} onOpenChange={(open) => {
              if (!open) {
                setNoiseSuppressionConfirmOpen(false);
              }
            }}>
              <Dialog.Portal>
                <Dialog.Overlay className={styles.dialogOverlay} />
                <Dialog.Content
                  className={styles.dialogContent}
                  onEscapeKeyDown={(e) => {
                    e.stopPropagation();
                  }}
                  onPointerDownOutside={(e) => {
                    e.preventDefault();
                  }}
                  onInteractOutside={(e) => {
                    e.preventDefault();
                  }}
                >
                  <Dialog.Title className={styles.dialogTitle}>
                    Noise Suppression
                  </Dialog.Title>
                  <Dialog.Description className={styles.dialogDescription}>
                    Apply FFT-based noise suppression to reduce background noise? This will update the audio file. Transcript timings are unchanged.
                  </Dialog.Description>
                  <div className={styles.dialogActions}>
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={(e) => {
                        e.stopPropagation();
                        setNoiseSuppressionConfirmOpen(false);
                      }}
                      aria-label="Cancel noise suppression"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.dialogConfirmRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNoiseSuppressionConfirm();
                      }}
                      disabled={applyingNoiseSuppression}
                      aria-label="Confirm noise suppression"
                    >
                      {applyingNoiseSuppression ? 'Applying…' : 'Confirm'}
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            {!loading && notFound && text == null && mode === 'view' && (
              <>
                {asrAvailable && (
                  <button
                    type="button"
                    className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary} ${styles.transcriptGenerateBtn}`}
                    onClick={handleGenerate}
                    disabled={generating}
                  >
                    <FileText size={24} strokeWidth={2} aria-hidden />
                    <span>{generating ? 'Generating…' : 'Generate transcript'}</span>
                  </button>
                )}
                {generateError && (
                  <p className={`${styles.error} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}>
                    {generateError}
                  </p>
                )}
              </>
            )}
            {!loading && !notFound && text == null && generateError && (
              <p className={`${styles.error} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}>
                {generateError}
              </p>
            )}
          </div>
          <div className={styles.dialogActions}>
            {!loading && text != null && mode === 'view' && (
              <button
                type="button"
                className={styles.cancel}
                onClick={handleGenerate}
                disabled={generating || !asrAvailable}
                style={{ marginRight: 'auto' }}
                aria-label="Generate new transcript"
              >
                {generating ? 'Generating…' : 'New Transcript'}
              </button>
            )}
            <Dialog.Close asChild>
              <button type="button" className={styles.cancel} aria-label="Close transcript">Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteTranscriptSegmentDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting: boolean;
}) {
  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenChange(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} modal={true}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content 
          className={styles.dialogContent}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onOpenChange(false);
          }}
          onPointerDownOutside={(e) => {
            e.preventDefault();
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
          }}
        >
          <Dialog.Title className={styles.dialogTitle}>Delete transcript segment?</Dialog.Title>
          <p className={styles.dialogDescription}>
            This will remove the segment from both the audio file and transcript. This cannot be undone.
          </p>
          <div className={styles.dialogActions}>
            <button
              type="button"
              className={styles.cancel}
              onClick={handleCancel}
              aria-label="Cancel deleting transcript segment"
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={onConfirm}
              disabled={isDeleting}
              aria-label="Confirm delete transcript segment"
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SegmentRow({
  episodeId,
  segment,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onDeleteRequest,
  onUpdateName,
  isDeleting,
  onPlayRequest,
  onMoreInfo,
  registerPause,
  unregisterPause,
}: {
  episodeId: string;
  segment: EpisodeSegment;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteRequest: () => void;
  onUpdateName: (segmentId: string, name: string | null) => void;
  isDeleting: boolean;
  onPlayRequest: (segmentId: string) => void;
  onMoreInfo: () => void;
  registerPause: (id: string, pause: () => void) => void;
  unregisterPause: (id: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressTrackRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const durationSec = segment.duration_sec ?? 0;
  const isRecorded = segment.type === 'recorded';
  const defaultName = isRecorded ? 'Recorded section' : (segment.asset_name ?? 'Library clip');
  const [localName, setLocalName] = useState(segment.name ?? '');
  useEffect(() => {
    setLocalName(segment.name ?? '');
  }, [segment.name]);

  function handleNameBlur() {
    const trimmed = localName.trim();
    const current = (segment.name ?? '').trim();
    if (trimmed !== current) onUpdateName(segment.id, trimmed || null);
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
    } else {
      onPlayRequest(segment.id);
      el.src = segmentStreamUrl(episodeId, segment.id);
      el.play().catch(() => {});
    }
  }

  useEffect(() => {
    registerPause(segment.id, () => audioRef.current?.pause());
    return () => unregisterPause(segment.id);
  }, [segment.id, registerPause, unregisterPause]);

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    const track = progressTrackRef.current;
    if (!el || !track || durationSec <= 0) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = frac * durationSec;
    el.currentTime = time;
    setCurrentTime(time);
  }

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(durationSec);
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onLoadedMetadata = () => setCurrentTime(el.currentTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [durationSec]);

  const progress = durationSec > 0 ? Math.min(1, currentTime / durationSec) : 0;

  return (
    <li className={styles.segmentBlock}>
      <span className={styles.segmentIcon} title={isRecorded ? 'Recorded' : 'From library'}>
        {isRecorded ? <Mic size={18} strokeWidth={2} aria-hidden /> : <Library size={18} strokeWidth={2} aria-hidden />}
      </span>
      <div className={styles.segmentBody}>
        <input
          type="text"
          className={styles.segmentNameInput}
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={handleNameBlur}
          placeholder={defaultName}
          aria-label="Section name"
        />
        <div className={styles.segmentMeta}>
          {formatDuration(Math.floor(currentTime))} / {formatDuration(segment.duration_sec)}
        </div>
        {durationSec > 0 && (
          <div
            ref={progressTrackRef}
            className={styles.segmentProgressTrack}
            onClick={handleProgressClick}
            role="progressbar"
            aria-valuenow={Math.round(currentTime)}
            aria-valuemin={0}
            aria-valuemax={durationSec}
            aria-label="Playback position"
          >
            <div className={styles.segmentProgressFill} style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
      <audio ref={audioRef} style={{ display: 'none' }} />
      <div className={styles.segmentActions}>
        <button type="button" className={styles.segmentBtn} onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause segment' : 'Play segment'}>
          {isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
        </button>
        <button type="button" className={styles.segmentBtn} onClick={onMoreInfo} title="More info" aria-label="Show more information">
          <Info size={18} aria-hidden />
        </button>
        <button type="button" className={styles.segmentBtn} onClick={onMoveUp} disabled={index === 0} title="Move up" aria-label="Move segment up">
          ↑
        </button>
        <button type="button" className={styles.segmentBtn} onClick={onMoveDown} disabled={index === total - 1} title="Move down" aria-label="Move segment down">
          ↓
        </button>
        <button type="button" className={styles.segmentBtn} onClick={onDeleteRequest} disabled={isDeleting} title="Remove" aria-label="Remove segment">
          ✕
        </button>
      </div>
    </li>
  );
}

function RecordModal({
  onClose,
  onAdd,
  isAdding,
  error,
}: {
  onClose: () => void;
  onAdd: (file: File, name?: string | null) => void;
  isAdding: boolean;
  error?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isPlaybackPlaying, setIsPlaybackPlaying] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement>(null);
  const recordProgressTrackRef = useRef<HTMLDivElement>(null);
  const recordCardRef = useRef<HTMLDivElement>(null);
  const recordButtonRef = useRef<HTMLButtonElement>(null);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Focus management: focus first focusable element when modal opens
  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timeout = setTimeout(() => {
      if (!recording && !blob && recordButtonRef.current) {
        recordButtonRef.current.focus();
      } else if (recording && stopButtonRef.current) {
        stopButtonRef.current.focus();
      } else if (blob && cancelButtonRef.current) {
        cancelButtonRef.current.focus();
      }
    }, 0);
    return () => clearTimeout(timeout);
  }, [recording, blob]);

  // Focus trapping: prevent tabbing outside modal
  useEffect(() => {
    const card = recordCardRef.current;
    if (!card) return;

    function handleKeyDown(e: KeyboardEvent) {
      const currentCard = recordCardRef.current;
      if (!currentCard) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusableElements = Array.from(currentCard.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(el => {
        // Filter out elements that are not visible
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });

      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        // Shift + Tab
        if (activeElement === firstElement || !currentCard.contains(activeElement)) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab
        if (activeElement === lastElement || !currentCard.contains(activeElement)) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [recording, blob]);

  useEffect(() => {
    if (!blob) {
      setPlaybackUrl(null);
      setPlaybackCurrentTime(0);
      setPlaybackDuration(0);
      setIsPlaybackPlaying(false);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPlaybackUrl(url);
    setPlaybackDuration(seconds);
    setPlaybackCurrentTime(0);
    return () => URL.revokeObjectURL(url);
  }, [blob, seconds]);

  useEffect(() => {
    const el = playbackAudioRef.current;
    if (!el || !playbackUrl) return;
    const onTimeUpdate = () => setPlaybackCurrentTime(Number.isFinite(el.currentTime) ? el.currentTime : 0);
    const onLoadedMetadata = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setPlaybackDuration(d);
    };
    const onPlay = () => setIsPlaybackPlaying(true);
    const onPause = () => setIsPlaybackPlaying(false);
    const onEnded = () => {
      setIsPlaybackPlaying(false);
      setPlaybackCurrentTime(Number.isFinite(el.currentTime) ? el.currentTime : 0);
    };
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [playbackUrl]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const b = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setBlob(b);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      recorder.start(1000);
      setRecording(true);
      setSeconds(0);
      setBlob(null);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      console.error(err);
      alert('Could not access microphone.');
    }
  }

  function stopRecording() {
    if (recorderRef.current && recording) {
      recorderRef.current.stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRecording(false);
    }
  }

  function handleAdd() {
    if (!blob) return;
    const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `recording.${ext}`, { type: blob.type });
    onAdd(file, sectionName.trim() || null);
  }

  function togglePlayback() {
    const el = playbackAudioRef.current;
    if (!el) return;
    if (isPlaybackPlaying) el.pause();
    else el.play().catch(() => {});
  }

  function handleRecordProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = playbackAudioRef.current;
    const track = recordProgressTrackRef.current;
    if (!el || !track || playbackDuration <= 0) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = frac * playbackDuration;
    el.currentTime = time;
    setPlaybackCurrentTime(time);
  }

  const recordProgress = playbackDuration > 0 ? Math.min(1, playbackCurrentTime / playbackDuration) : 0;
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  function requestClose() {
    setShowCloseConfirm(true);
  }

  function confirmClose() {
    setShowCloseConfirm(false);
    onClose();
  }

  return (
    <div className={styles.recordOverlay} onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div ref={recordCardRef} className={styles.recordCard} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="record-title">
        <h3 id="record-title" className={styles.recordTitle}>Record a section</h3>
        <p className={styles.recordSub}>Use your microphone. When done, stop and add to the episode.</p>
        {!recording && !blob && (
          <button ref={recordButtonRef} type="button" className={`${styles.recordBtn} ${styles.record}`} onClick={startRecording} aria-label="Start recording">
            ●
          </button>
        )}
        {recording && (
          <>
            <div className={styles.recordTime}>{formatDuration(seconds)}</div>
            <button ref={stopButtonRef} type="button" className={`${styles.recordBtn} ${styles.stop}`} onClick={stopRecording} aria-label="Stop recording">
              ■
            </button>
          </>
        )}
        {blob && !recording && (
          <>
            <label className={styles.recordLabel}>
              Section name (optional)
              <input
                type="text"
                className={styles.recordNameInput}
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                placeholder="e.g. Intro, Ad read"
              />
            </label>
            {playbackUrl && (
              <div className={styles.recordPlaybackWrap}>
                <audio ref={playbackAudioRef} key={playbackUrl} src={playbackUrl} preload="metadata" style={{ display: 'none' }} />
                <div className={styles.recordPlaybackRow}>
                  <button type="button" className={styles.segmentBtn} onClick={togglePlayback} title={isPlaybackPlaying ? 'Pause' : 'Play'} aria-label={isPlaybackPlaying ? 'Pause playback' : 'Play playback'}>
                    {isPlaybackPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
                  </button>
                  <div className={styles.recordPlaybackInfo}>
                    <div className={styles.segmentMeta}>
                      {formatDuration(Math.floor(playbackCurrentTime))} / {formatDuration(Math.floor(playbackDuration))}
                    </div>
                    <div
                      ref={recordProgressTrackRef}
                      className={styles.segmentProgressTrack}
                      onClick={handleRecordProgressClick}
                      role="progressbar"
                      aria-valuenow={Math.round(playbackCurrentTime)}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(playbackDuration)}
                      aria-label="Playback position"
                    >
                      <div className={styles.segmentProgressFill} style={{ width: `${recordProgress * 100}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className={styles.recordChoiceRow}>
              <button type="button" className={styles.recordChoiceBtn} onClick={() => { setBlob(null); setSeconds(0); }} aria-label="Record again">
                <RotateCcw size={24} strokeWidth={2} aria-hidden />
                <span>Record again</span>
              </button>
              <button type="button" className={`${styles.recordChoiceBtn} ${styles.recordChoiceBtnPrimary}`} onClick={handleAdd} disabled={isAdding} aria-label={isAdding ? 'Adding to episode' : 'Add to episode'}>
                <PlusCircle size={24} strokeWidth={2} aria-hidden />
                <span>{isAdding ? 'Adding…' : 'Add to episode'}</span>
              </button>
            </div>
          </>
        )}
        {error && <p className={styles.error} style={{ marginTop: '0.5rem' }}>{error}</p>}
        <div className={styles.recordActions} style={{ marginTop: '1rem' }}>
          <button ref={cancelButtonRef} type="button" className={styles.libraryClose} onClick={requestClose} aria-label="Cancel recording">Cancel</button>
        </div>
      </div>

      <Dialog.Root open={showCloseConfirm} onOpenChange={(open) => !open && setShowCloseConfirm(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <Dialog.Title className={styles.dialogTitle}>Discard recording?</Dialog.Title>
            <p className={styles.dialogDescription}>Your recording will not be saved.</p>
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel} aria-label="Stay and continue recording">Stay</button>
              </Dialog.Close>
              <button type="button" className={styles.dialogConfirmRemove} onClick={confirmClose} aria-label="Discard recording">
                Discard
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

const LIBRARY_TAGS = ['Ad', 'Intro', 'Outro', 'Bumper', 'Other'] as const;
const LIBRARY_PAGE_SIZE = 10;

function LibraryModal({
  onClose,
  onSelect,
  isAdding,
  error,
}: {
  onClose: () => void;
  onSelect: (assetId: string) => void;
  isAdding: boolean;
  error?: string;
}) {
  const queryClient = useQueryClient();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadTag, setUploadTag] = useState<string>('');
  const [customTag, setCustomTag] = useState('');
  const [filterTag, setFilterTag] = useState<string>('');
  const [filterQuery, setFilterQuery] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['library'],
    queryFn: () => listLibrary(),
  });
  const uploadMutation = useMutation({
    mutationFn: ({ file, name, tag }: { file: File; name: string; tag?: string | null }) =>
      createLibraryAsset(file, name, tag || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      setPendingFile(null);
      setUploadName('');
      setUploadTag('');
      setCustomTag('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });
  const assets = data?.assets ?? [];

  const tagOptions = useMemo(() => {
    const preset = new Set<string>(LIBRARY_TAGS);
    const fromData = new Set<string>();
    assets.forEach((a) => { if (a.tag) fromData.add(a.tag); });
    const ordered = [...LIBRARY_TAGS.filter((t) => t !== 'Other'), ...Array.from(fromData).filter((t) => !preset.has(t)).sort()];
    return ordered;
  }, [assets]);

  const filteredAndSorted = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    let list = assets.filter((a) => {
      if (filterTag && a.tag !== filterTag) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortNewestFirst ? tb - ta : ta - tb;
    });
    return list;
  }, [assets, filterTag, filterQuery, sortNewestFirst]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / LIBRARY_PAGE_SIZE));
  const pageClamped = Math.max(1, Math.min(page, totalPages));
  const paginatedAssets = useMemo(
    () => filteredAndSorted.slice((pageClamped - 1) * LIBRARY_PAGE_SIZE, pageClamped * LIBRARY_PAGE_SIZE),
    [filteredAndSorted, pageClamped]
  );

  useEffect(() => {
    setPage((p) => (p > totalPages ? Math.max(1, totalPages) : p));
  }, [totalPages]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setUploadName(file.name.replace(/\.[^.]+$/, ''));
    setUploadTag('');
  }

  function handleAddToLibrary() {
    if (!pendingFile) return;
    const name = uploadName.trim() || pendingFile.name.replace(/\.[^.]+$/, '');
    const tag = uploadTag === 'Other' ? (customTag.trim() || null) : (uploadTag || null);
    uploadMutation.mutate({ file: pendingFile, name, tag });
  }

  function clearPending() {
    setPendingFile(null);
    setUploadName('');
    setUploadTag('');
    setCustomTag('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className={styles.libraryOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.libraryCard} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.libraryTitle}>Insert from library</h3>
        <p className={styles.librarySub}>Reusable clips (ads, intros, outros) you can use in any episode.</p>

        {!pendingFile ? (
          <button
            type="button"
            className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary} ${styles.libraryChooseFileBtn}`}
            style={{ width: '100%', marginBottom: '1rem' }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={24} strokeWidth={2} aria-hidden />
            <span>Choose file to add to library</span>
          </button>
        ) : (
          <div className={styles.libraryUploadForm}>
            <p className={styles.libraryPendingFile}>{pendingFile.name}</p>
            <label className={styles.recordLabel}>
              Name
              <input
                type="text"
                className={styles.recordNameInput}
                placeholder="e.g. Mid-roll ad, Show intro"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
              />
            </label>
            <label className={styles.recordLabel}>
              Tag
              <select
                className={styles.select}
                value={uploadTag}
                onChange={(e) => setUploadTag(e.target.value)}
              >
                <option value="">None</option>
                {LIBRARY_TAGS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            {uploadTag === 'Other' && (
              <label className={styles.recordLabel}>
                Custom tag
                <input
                  type="text"
                  className={styles.recordNameInput}
                  placeholder="e.g. Promo, Transition"
                  value={customTag}
                  onChange={(e) => setCustomTag(e.target.value)}
                />
              </label>
            )}
            <div className={styles.libraryUploadActions}>
              <button type="button" className={styles.cancel} onClick={clearPending} aria-label="Cancel adding to library">
                Cancel
              </button>
              <button
                type="button"
                className={styles.submit}
                onClick={handleAddToLibrary}
                disabled={uploadMutation.isPending}
                aria-label="Add file to library"
              >
                {uploadMutation.isPending ? 'Adding…' : 'Add to library'}
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {uploadMutation.isError && (
          <p className={styles.error} style={{ marginBottom: '0.5rem' }}>{uploadMutation.error?.message}</p>
        )}

        {!pendingFile && !isLoading && assets.length > 0 && (
          <div className={styles.libraryFilters}>
            <input
              type="search"
              className={styles.input}
              placeholder="Search by name…"
              value={filterQuery}
              onChange={(e) => { setFilterQuery(e.target.value); setPage(1); }}
              aria-label="Filter by name"
            />
            <select
              className={styles.select}
              value={filterTag}
              onChange={(e) => { setFilterTag(e.target.value); setPage(1); }}
              aria-label="Filter by tag"
            >
              <option value="">All tags</option>
              {tagOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div className={styles.librarySortToggle} role="group" aria-label="Sort order">
              <button
                type="button"
                className={sortNewestFirst ? styles.librarySortBtnActive : styles.librarySortBtn}
                onClick={() => { setSortNewestFirst(true); setPage(1); }}
                title="Newest first"
                aria-label="Newest first"
              >
                <ArrowDown size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={!sortNewestFirst ? styles.librarySortBtnActive : styles.librarySortBtn}
                onClick={() => { setSortNewestFirst(false); setPage(1); }}
                title="Oldest first"
                aria-label="Oldest first"
              >
                <ArrowUp size={16} aria-hidden />
              </button>
            </div>
          </div>
        )}

        {!pendingFile && (isLoading ? (
          <p className={styles.libraryEmpty}>Loading…</p>
        ) : assets.length === 0 ? (
          <p className={styles.libraryEmpty}>No library clips yet. Choose a file above to add one.</p>
        ) : filteredAndSorted.length === 0 ? (
          <p className={styles.libraryEmpty}>No clips match your filters.</p>
        ) : (
          <>
            <ul className={styles.libraryList}>
              {paginatedAssets.map((asset: LibraryAsset) => (
                <li
                  key={asset.id}
                  className={styles.libraryItem}
                  onClick={() => !isAdding && onSelect(asset.id)}
                >
                  <div className={styles.libraryItemContent}>
                    <div className={styles.libraryItemName}>
                      {asset.name}
                      {asset.tag && <span className={styles.libraryItemTag}>{asset.tag}</span>}
                    </div>
                    <div className={styles.libraryItemMeta}>
                      {formatDuration(asset.duration_sec)}
                      <span className={styles.libraryItemDate}> · {formatLibraryDate(asset.created_at)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <div className={styles.libraryPagination}>
                <span className={styles.libraryPaginationLabel}>
                  Page {pageClamped} of {totalPages}
                </span>
                <div className={styles.libraryPaginationBtns}>
                  <button
                    type="button"
                    className={styles.libraryPageBtn}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={pageClamped <= 1}
                    aria-label="Previous page"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className={styles.libraryPageBtn}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={pageClamped >= totalPages}
                    aria-label="Next page"
                  >
                    →
                  </button>
                </div>
              </div>
            )}
          </>
        ))}
        {error && <p className={styles.error} style={{ marginTop: '0.5rem' }}>{error}</p>}
        <button type="button" className={styles.libraryClose} onClick={onClose} aria-label="Close library">Close</button>
      </div>
    </div>
  );
}

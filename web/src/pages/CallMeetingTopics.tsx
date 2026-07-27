import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Ban, GripVertical, MessageCircle, Plus, Trash2 } from 'lucide-react';
import type { ShowNotesGuestTag } from '@harborfm/shared';
import { SHOW_NOTES_TAG_LABELS } from '@harborfm/shared';
import { CallJoinHeader } from '../components/CallJoinHeader';
import { useDebouncedCallback } from '../hooks/useDebouncedCallback';
import { useAutoResizeTextarea } from '../hooks/useAutoResizeTextarea';
import {
  createMeetingTopic,
  deleteMeetingTopic,
  listMeetingTopics,
  meetingTopicsSubmitterKey,
  reorderMeetingTopics,
  updateMeetingTopic,
  type MeetingTopicsGuestItem,
  type MeetingTopicsIdentity,
} from '../api/meetingTopics';
import { getJoinInfo } from '../api/call';
import styles from './CallMeetingTopics.module.css';

const CLOSED = new Set(['cancelled', 'ended', 'expired']);

function SortableTopicRow({
  item,
  onTextChange,
  onTagChange,
  onDelete,
}: {
  item: MeetingTopicsGuestItem;
  onTextChange: (id: string, text: string) => void;
  onTagChange: (id: string, tag: ShowNotesGuestTag) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localText, setLocalText] = useState(item.text);
  useEffect(() => {
    setLocalText(item.text);
  }, [item.text]);
  useAutoResizeTextarea(textareaRef, localText, { minHeight: 36 });

  const debouncedText = useDebouncedCallback((id: string, text: string) => {
    onTextChange(id, text);
  }, 400);

  const addedToNotes = item.addedToNotes === true;

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.85 : undefined,
      }}
      className={`${styles.item} ${addedToNotes ? styles.itemAddedToNotes : ''}`}
    >
      <div className={styles.itemToolbar}>
        <button
          type="button"
          className={styles.dragHandle}
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={18} aria-hidden />
        </button>
        {addedToNotes ? (
          <span className={styles.addedToNotesBadge}>Added to Show Notes</span>
        ) : (
          <span
            className={`${styles.tagBadge} ${item.tag === 'avoid' ? styles.tagBadgeAvoid : ''}`}
          >
            {SHOW_NOTES_TAG_LABELS[item.tag]}
          </span>
        )}
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={() => onDelete(item.id)}
          aria-label="Remove topic"
        >
          <Trash2 size={18} aria-hidden />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={localText}
        maxLength={500}
        rows={1}
        placeholder="Topic..."
        readOnly={addedToNotes}
        disabled={addedToNotes}
        onChange={(e) => {
          if (addedToNotes) return;
          const v = e.target.value;
          setLocalText(v);
          debouncedText(item.id, v);
        }}
        onBlur={() => {
          if (addedToNotes) return;
          if (localText !== item.text) onTextChange(item.id, localText);
        }}
      />
      {!addedToNotes && (
        <div className={styles.tagRow} role="group" aria-label="Topic tag">
          <button
            type="button"
            className={`${styles.tagBtn} ${item.tag === 'discuss' ? styles.tagBtnActive : ''}`}
            aria-pressed={item.tag === 'discuss'}
            onClick={() => onTagChange(item.id, 'discuss')}
          >
            <MessageCircle size={15} strokeWidth={2} aria-hidden />
            To Discuss
          </button>
          <button
            type="button"
            className={`${styles.tagBtn} ${
              item.tag === 'avoid' ? `${styles.tagBtnActive} ${styles.tagBtnActiveAvoid}` : ''
            }`}
            aria-pressed={item.tag === 'avoid'}
            onClick={() => onTagChange(item.id, 'avoid')}
          >
            <Ban size={15} strokeWidth={2} aria-hidden />
            To Avoid
          </button>
        </div>
      )}
    </li>
  );
}

export function CallMeetingTopics() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const invite = searchParams.get('invite');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [podcastTitle, setPodcastTitle] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [items, setItems] = useState<MeetingTopicsGuestItem[]>([]);
  const [fromInvite, setFromInvite] = useState(false);
  const [submittedBy, setSubmittedBy] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [newText, setNewText] = useState('');
  const [newTag, setNewTag] = useState<ShowNotesGuestTag>('discuss');
  const [saving, setSaving] = useState(false);

  const identity: MeetingTopicsIdentity = useMemo(
    () => ({
      invite: invite || undefined,
      submittedBy: invite ? undefined : submittedBy || undefined,
    }),
    [invite, submittedBy],
  );

  const joinHref = token
    ? `/call/join/${encodeURIComponent(token)}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`
    : '/call/join';

  const load = useCallback(async (id: MeetingTopicsIdentity) => {
    if (!token) return;
    const hasIdentity = Boolean(id.invite?.trim() || id.submittedBy?.trim());
    if (!hasIdentity) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await listMeetingTopics(token, id);
      setPodcastTitle(res.podcast.title);
      setEpisodeTitle(res.episode.title);
      setItems(res.items);
      setFromInvite(res.fromInvite);
      setSubmittedBy(res.submittedBy);
      setClosedMessage(null);
      if (!id.invite && res.submittedBy) {
        localStorage.setItem(meetingTopicsSubmitterKey(token), res.submittedBy);
      }
    } catch (err) {
      const e = err as Error & { status?: number; meetingStatus?: string };
      if (e.status === 403 || (e.meetingStatus && CLOSED.has(e.meetingStatus))) {
        setClosedMessage(e.message || 'This meeting is no longer open for topic suggestions.');
        setItems([]);
      } else if (e.status === 400 && id.invite) {
        // Invite has no email/name - fall through to name gate
        setFromInvite(false);
        setError(null);
      } else {
        setError(e.message || 'Failed to load topics');
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = await getJoinInfo(token, invite);
        if (cancelled) return;
        setPodcastTitle(info.podcast.title);
        setEpisodeTitle(info.episode.title);
        setArtworkUrl(info.artworkUrl?.trim() || null);
        if (info.meetingStatus && CLOSED.has(info.meetingStatus)) {
          setClosedMessage(
            info.meetingStatus === 'cancelled'
              ? 'This meeting was cancelled.'
              : info.meetingStatus === 'ended'
                ? 'This meeting has ended.'
                : 'This meeting link has expired.',
          );
          setLoading(false);
          return;
        }
      } catch {
        /* join-info optional for title; topics API is authoritative */
      }
      if (cancelled) return;
      if (invite?.trim()) {
        void load({ invite });
        return;
      }
      const stored = localStorage.getItem(meetingTopicsSubmitterKey(token))?.trim();
      if (stored) {
        setSubmittedBy(stored);
        setNameDraft(stored);
        void load({ submittedBy: stored });
      } else {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, invite, load]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleNameContinue = () => {
    const name = nameDraft.trim();
    if (!name || !token) return;
    localStorage.setItem(meetingTopicsSubmitterKey(token), name);
    setSubmittedBy(name);
    void load({ submittedBy: name });
  };

  const handleAdd = async () => {
    if (!token || (!identity.invite && !identity.submittedBy)) return;
    const text = newText.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      const item = await createMeetingTopic(token, identity, {
        text,
        tag: newTag,
      });
      setItems((prev) => [...prev, item]);
      setNewText('');
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 403) setClosedMessage(e.message);
      else setError(e.message || 'Failed to add topic');
    } finally {
      setSaving(false);
    }
  };

  const handleTextChange = async (id: string, text: string) => {
    if (!token) return;
    try {
      const updated = await updateMeetingTopic(token, id, identity, { text });
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update topic');
    }
  };

  const handleTagChange = async (id: string, tag: ShowNotesGuestTag) => {
    if (!token) return;
    try {
      const updated = await updateMeetingTopic(token, id, identity, { tag });
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update topic');
    }
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    try {
      await deleteMeetingTopic(token, id, identity);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete topic');
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !token) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    void reorderMeetingTopics(
      token,
      identity,
      next.map((i) => i.id),
    ).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to reorder');
      void load(identity);
    });
  };

  const needsName = !invite?.trim() && !submittedBy?.trim();

  return (
    <div className={styles.page}>
      <CallJoinHeader />
      <div className={styles.container}>
        <div className={styles.card}>
          {artworkUrl && (
            <img
              src={artworkUrl}
              alt={
                podcastTitle
                  ? `${podcastTitle} artwork`
                  : 'Show artwork'
              }
              className={styles.artwork}
            />
          )}
          {(podcastTitle || episodeTitle) && (
            <p className={styles.sub}>
              {podcastTitle}
              {podcastTitle && episodeTitle ? ' - ' : ''}
              {episodeTitle}
            </p>
          )}
          <h1 className={styles.cardTitle}>Suggest topics</h1>

          {closedMessage && (
            <p className={styles.error} role="status">
              {closedMessage}
            </p>
          )}

          {!closedMessage && needsName && (
            <>
              <p className={styles.hint}>Enter your name so we can track your suggestions.</p>
              <div className={styles.form}>
                <label className={styles.label} htmlFor="topics-name">
                  Your name
                </label>
                <input
                  id="topics-name"
                  className={styles.input}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={320}
                  autoComplete="name"
                />
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={!nameDraft.trim()}
                  onClick={handleNameContinue}
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {!closedMessage && !needsName && (
            <>
              {fromInvite && submittedBy && (
                <p className={styles.hint}>Submitting as {submittedBy}</p>
              )}
              {!fromInvite && submittedBy && (
                <p className={styles.hint}>Submitting as {submittedBy}</p>
              )}

              {loading ? (
                <p className={styles.loading}>Loading...</p>
              ) : (
                <>
                  {error && (
                    <p className={styles.error} role="alert">
                      {error}
                    </p>
                  )}

                  <form
                    className={styles.form}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleAdd();
                    }}
                  >
                    <label className={styles.label} htmlFor="topics-new">
                      New topic
                    </label>
                    <input
                      id="topics-new"
                      type="text"
                      className={styles.input}
                      value={newText}
                      onChange={(e) => setNewText(e.target.value)}
                      maxLength={500}
                      placeholder="What should we discuss or avoid?"
                      autoComplete="off"
                    />
                    <div className={styles.tagRow} role="group" aria-label="New topic tag">
                      <button
                        type="button"
                        className={`${styles.tagBtn} ${newTag === 'discuss' ? styles.tagBtnActive : ''}`}
                        aria-pressed={newTag === 'discuss'}
                        onClick={() => setNewTag('discuss')}
                      >
                        <MessageCircle size={15} strokeWidth={2} aria-hidden />
                        To Discuss
                      </button>
                      <button
                        type="button"
                        className={`${styles.tagBtn} ${
                          newTag === 'avoid'
                            ? `${styles.tagBtnActive} ${styles.tagBtnActiveAvoid}`
                            : ''
                        }`}
                        aria-pressed={newTag === 'avoid'}
                        onClick={() => setNewTag('avoid')}
                      >
                        <Ban size={15} strokeWidth={2} aria-hidden />
                        To Avoid
                      </button>
                    </div>
                    <button
                      type="submit"
                      className={styles.primaryBtn}
                      disabled={saving || !newText.trim()}
                    >
                      <Plus size={16} strokeWidth={2} aria-hidden />
                      Add topic
                    </button>
                  </form>

                  {items.length === 0 ? (
                    <p className={styles.empty}>You have not suggested any topics yet.</p>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={items.map((i) => i.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <ul className={styles.list}>
                          {items.map((item) => (
                            <SortableTopicRow
                              key={item.id}
                              item={item}
                              onTextChange={(id, text) => void handleTextChange(id, text)}
                              onTagChange={(id, tag) => void handleTagChange(id, tag)}
                              onDelete={(id) => void handleDelete(id)}
                            />
                          ))}
                        </ul>
                      </SortableContext>
                    </DndContext>
                  )}
                </>
              )}
            </>
          )}

          <Link className={styles.secondaryLink} to={joinHref}>
            Back to join call
          </Link>
        </div>
      </div>
    </div>
  );
}

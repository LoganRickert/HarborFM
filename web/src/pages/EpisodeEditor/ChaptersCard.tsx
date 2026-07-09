import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Play, Pencil, Trash2, Plus } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { formatDuration } from './utils';
import styles from '../EpisodeEditor.module.css';

export type ChapterMarker = { time: number; title?: string; color?: string };

const CHAPTER_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899'] as const;

export interface ChaptersCardProps {
  /** Chapter markers (from episode.finalMarkers). */
  markers: ChapterMarker[];
  /** Called when markers change (add/edit/delete). */
  onMarkersChange: (markers: ChapterMarker[]) => void;
  /** Seek the final episode to this time (seconds). Only used when hasFinalAudio. */
  onSeekTo?: (time: number) => void;
  /** Whether the user can edit chapters. */
  canEdit: boolean;
  /** Whether final audio exists (play button only works when true). */
  hasFinalAudio: boolean;
  /** Duration of final audio in seconds. Used to validate chapter times. */
  finalDurationSec: number;
  /** Controlled expanded state (optional). */
  expanded?: boolean;
  /** Called when expanded state changes. */
  onExpandedChange?: (expanded: boolean) => void;
  /** Hide the built-in toggle header (parent controls expansion). */
  hideHeader?: boolean;
}

/** Parse "m:ss" or "mm:ss" or plain seconds number. Returns seconds or NaN. */
function parseTimeInput(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return NaN;
  const num = Number(trimmed);
  if (!Number.isNaN(num)) return num >= 0 ? num : NaN;
  const parts = trimmed.split(':');
  if (parts.length === 2) {
    const m = parseInt(parts[0]!, 10);
    const sec = parseFloat(parts[1]!);
    if (!Number.isNaN(m) && !Number.isNaN(sec) && m >= 0 && sec >= 0) {
      return m * 60 + sec;
    }
  }
  if (parts.length === 3) {
    const h = parseInt(parts[0]!, 10);
    const m = parseInt(parts[1]!, 10);
    const sec = parseFloat(parts[2]!);
    if (!Number.isNaN(h) && !Number.isNaN(m) && !Number.isNaN(sec) && h >= 0 && m >= 0 && sec >= 0) {
      return h * 3600 + m * 60 + sec;
    }
  }
  return NaN;
}

function ChapterEditDialog({
  open,
  onOpenChange,
  marker,
  mode,
  defaultTimeSec,
  maxTimeSec,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marker: ChapterMarker | null;
  mode: 'add' | 'edit';
  /** When mode is 'add', the default start time in seconds (e.g. 0 or last chapter time + 1). */
  defaultTimeSec?: number;
  maxTimeSec: number;
  onSave: (m: ChapterMarker) => void;
}) {
  const getDefaultTimeStr = () =>
    mode === 'add' && defaultTimeSec !== undefined
      ? formatDuration(Math.floor(defaultTimeSec))
      : marker != null
        ? formatDuration(Math.floor(marker.time))
        : '0:00';

  const getDefaultColor = () => marker?.color ?? CHAPTER_COLORS[0];

  const [title, setTitle] = useState(marker?.title ?? '');
  const [timeStr, setTimeStr] = useState(getDefaultTimeStr());
  const [color, setColor] = useState(getDefaultColor());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const timeStrVal =
        mode === 'add' && defaultTimeSec !== undefined
          ? formatDuration(Math.floor(defaultTimeSec))
          : marker != null
            ? formatDuration(Math.floor(marker.time))
            : '0:00';
      setTitle(marker?.title ?? '');
      setTimeStr(timeStrVal);
      setColor(marker?.color ?? CHAPTER_COLORS[0]);
      setError(null);
    }
  }, [open, marker, mode, defaultTimeSec]);

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setTitle(marker?.title ?? '');
      setTimeStr(getDefaultTimeStr());
      setColor(getDefaultColor());
      setError(null);
    }
    onOpenChange(o);
  };

  const handleSave = () => {
    const timeSec = parseTimeInput(timeStr);
    if (Number.isNaN(timeSec) || timeSec < 0) {
      setError('Enter a valid time (e.g. 1:30 or 90)');
      return;
    }
    if (maxTimeSec > 0 && timeSec > maxTimeSec) {
      setError(`Time cannot exceed ${formatDuration(Math.floor(maxTimeSec))}`);
      return;
    }
    const t = (title ?? '').trim();
    if (!t) {
      setError('Chapter name is required');
      return;
    }
    setError(null);
    onSave({ time: timeSec, title: t, color: color || undefined });
    handleOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentOnModal}`}
          onEscapeKeyDown={(e) => e.stopPropagation()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              {mode === 'add' ? 'Add Chapter' : 'Edit Chapter'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {mode === 'add'
              ? 'Add a chapter marker. Use mm:ss format (e.g. 1:30) or seconds.'
              : 'Edit the chapter name and start time.'}
          </Dialog.Description>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            <label className={styles.chapterEditLabel}>
              <span>Chapter name</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Introduction"
                className={styles.chapterEditInput}
                autoFocus
              />
            </label>
            <label className={styles.chapterEditLabel}>
              <span>Start time</span>
              <input
                type="text"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                placeholder="0:00 or 90"
                className={styles.chapterEditInput}
              />
            </label>
            <div className={styles.chapterEditLabel}>
              <span>Color</span>
              <div className={styles.chapterColorRow} role="group" aria-label="Marker color">
                {CHAPTER_COLORS.map((c) => {
                  const isSelected = (color ?? CHAPTER_COLORS[0]) === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`${styles.chapterColorBtn} ${isSelected ? styles.chapterColorBtnSelected : ''}`}
                      style={{
                        borderColor: c,
                        backgroundColor: isSelected ? c : 'transparent',
                      }}
                      onClick={() => setColor(c)}
                      title={`Set color to ${c}`}
                      aria-label={`Set color`}
                      aria-pressed={isSelected}
                    />
                  );
                })}
              </div>
            </div>
            {error && (
              <p className={styles.error} role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            )}
          </div>
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`} style={{ marginTop: '1.25rem' }}>
            <button type="button" className={styles.cancel} onClick={() => handleOpenChange(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.renderBtnPrimary}
              onClick={handleSave}
              aria-label={mode === 'add' ? 'Add chapter' : 'Save changes'}
            >
              {mode === 'add' ? 'Add Chapter' : 'Save'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ChaptersCard({
  markers,
  onMarkersChange,
  onSeekTo,
  canEdit,
  hasFinalAudio,
  finalDurationSec,
  expanded: expandedProp,
  onExpandedChange,
  hideHeader = false,
}: ChaptersCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = expandedProp ?? internalExpanded;
  const setExpanded = onExpandedChange ?? setInternalExpanded;
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  const sortedMarkers = [...markers].sort((a, b) => a.time - b.time);

  const handleSaveEdit = (m: ChapterMarker) => {
    if (editIndex === null) return;
    const next = [...markers];
    next[editIndex] = m;
    next.sort((a, b) => a.time - b.time);
    onMarkersChange(next);
    setEditIndex(null);
  };

  const handleSaveAdd = (m: ChapterMarker) => {
    const next = [...markers, m];
    next.sort((a, b) => a.time - b.time);
    onMarkersChange(next);
    setAddOpen(false);
  };

  const handleDelete = () => {
    if (deleteIndex === null) return;
    const next = markers.filter((_, i) => i !== deleteIndex);
    onMarkersChange(next);
    setDeleteIndex(null);
  };

  return (
    <div className={`${styles.chaptersCard} ${hideHeader ? styles.chaptersCardEmbedded : ''}`}>
      {!hideHeader && (
        <button
          type="button"
          className={styles.chaptersCardHeader}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="chapters-card-content"
          id="chapters-card-toggle"
        >
          <span className={styles.chaptersCardHeaderText}>View Chapters</span>
          <span className={styles.chaptersCardHeaderIcon} aria-hidden>
            {expanded ? (
              <ChevronUp size={18} strokeWidth={2} />
            ) : (
              <ChevronDown size={18} strokeWidth={2} />
            )}
          </span>
        </button>
      )}
      <div
        id="chapters-card-content"
        role="region"
        aria-labelledby={hideHeader ? undefined : 'chapters-card-toggle'}
        className={styles.chaptersCardBody}
        style={{ display: expanded ? 'block' : 'none' }}
      >
        {sortedMarkers.length === 0 ? (
          <div className={styles.chaptersEmpty}>
            {canEdit ? (
              <>
                <button
                  type="button"
                  className={styles.chaptersAddFirstBtn}
                  onClick={() => setAddOpen(true)}
                  aria-label="Add first chapter"
                >
                  <Plus size={18} strokeWidth={2} aria-hidden />
                  Add First Chapter
                </button>
                <p className={styles.chaptersEmptyHint}>
                  or add chapters using markers in the segment editor
                </p>
              </>
            ) : (
              <p className={styles.chaptersEmptyHint}>
                No chapters yet. Add chapter markers in the segment editor and rebuild the episode.
              </p>
            )}
          </div>
        ) : (
          <>
            <table className={styles.chaptersTable}>
              <thead>
                <tr>
                  <th scope="col" className={styles.chaptersTablePlayCol} aria-label="Play" />
                  <th scope="col" className={styles.chaptersTableColorCol} aria-label="Color" />
                  <th scope="col">Chapter</th>
                  <th scope="col" className={styles.chaptersTableTimeCol}>Start</th>
                  {canEdit && (
                    <th scope="col" className={styles.chaptersTableActionsCol} aria-label="Actions" />
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedMarkers.map((m, i) => (
                  <tr key={i}>
                    <td className={styles.chaptersTablePlayCol}>
                      {hasFinalAudio && onSeekTo ? (
                        <button
                          type="button"
                          className={styles.chapterPlayBtn}
                          onClick={() => onSeekTo(m.time)}
                          aria-label={`Play from ${m.title ?? 'chapter'} at ${formatDuration(Math.floor(m.time))}`}
                          title={`Play from ${formatDuration(Math.floor(m.time))}`}
                        >
                          <Play size={16} strokeWidth={2} aria-hidden />
                        </button>
                      ) : (
                        <span className={styles.chapterPlayPlaceholder} aria-hidden />
                      )}
                    </td>
                    <td className={styles.chaptersTableColorCol}>
                      <span
                        className={styles.chapterColorSwatch}
                        style={{ backgroundColor: m.color ?? CHAPTER_COLORS[0] }}
                        title={m.color ?? 'Default color'}
                        aria-hidden
                      />
                    </td>
                    <td className={styles.chaptersTableNameCol}>{m.title ?? 'Untitled'}</td>
                    <td className={styles.chaptersTableTimeCol}>{formatDuration(Math.floor(m.time))}</td>
                    {canEdit && (
                      <td className={styles.chaptersTableActionsCol}>
                        <div className={styles.chaptersTableActionsWrap}>
                        <button
                          type="button"
                          className={styles.chaptersTableActionBtn}
                          onClick={() => setEditIndex(i)}
                          aria-label={`Edit ${m.title ?? 'chapter'}`}
                          title="Edit chapter"
                        >
                          <Pencil size={16} strokeWidth={2} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={`${styles.chaptersTableActionBtn} ${styles.chaptersTableActionBtnDelete}`}
                          onClick={() => setDeleteIndex(i)}
                          aria-label={`Delete ${m.title ?? 'chapter'}`}
                          title="Delete chapter"
                        >
                          <Trash2 size={16} strokeWidth={2} aria-hidden />
                        </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {canEdit && (
              <div className={styles.chaptersAddBtnWrap}>
                <button
                  type="button"
                  className={styles.chaptersAddBtn}
                  onClick={() => setAddOpen(true)}
                  aria-label="Add chapter"
                >
                  <Plus size={18} strokeWidth={2} aria-hidden />
                  Add Chapter
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Edit dialog */}
      <ChapterEditDialog
        open={editIndex !== null}
        onOpenChange={(o) => !o && setEditIndex(null)}
        marker={editIndex !== null ? markers[editIndex]! : null}
        mode="edit"
        maxTimeSec={finalDurationSec}
        onSave={handleSaveEdit}
      />

      {/* Add dialog */}
      <ChapterEditDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        marker={null}
        mode="add"
        defaultTimeSec={
          sortedMarkers.length === 0
            ? 0
            : Math.floor(Math.max(...sortedMarkers.map((m) => m.time))) + 1
        }
        maxTimeSec={finalDurationSec}
        onSave={handleSaveAdd}
      />

      {/* Delete confirm */}
      <Dialog.Root open={deleteIndex !== null} onOpenChange={(o) => !o && setDeleteIndex(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`} />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentOnModal}`}
            onEscapeKeyDown={(e) => e.stopPropagation()}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Delete chapter?</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className={styles.dialogClose} aria-label="Close">
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              {deleteIndex !== null && markers[deleteIndex]
                ? `Remove "${markers[deleteIndex]!.title ?? 'Untitled'}"?`
                : 'Remove this chapter?'}
            </Dialog.Description>
            <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`} style={{ marginTop: '1.25rem' }}>
              <button type="button" className={styles.cancel} onClick={() => setDeleteIndex(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.dialogConfirmRemove}
                onClick={() => {
                  handleDelete();
                }}
                aria-label="Delete chapter"
              >
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

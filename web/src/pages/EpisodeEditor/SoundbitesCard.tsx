import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Play, Pencil, Trash2, Plus, Download, TriangleAlert } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { formatDuration } from './utils';
import { useDialogCloseGuard } from '../../hooks/useDialogCloseGuard';
import { UnsavedChangesConfirmDialog } from '../../components/UnsavedChangesConfirmDialog';
import { downloadSoundbiteUrl } from '../../api/audio';
import styles from '../EpisodeEditor.module.css';

export type SoundbiteMarker = {
  time: number;
  duration: number;
  title?: string;
  color?: string;
};

const SOUNDBITE_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899'] as const;
const SOUNDBITE_DEFAULT_DURATION = 30;
const SOUNDBITE_TITLE_MAX = 127;

export interface SoundbitesCardProps {
  episodeId: string;
  soundbites: SoundbiteMarker[];
  onSoundbitesChange: (soundbites: SoundbiteMarker[]) => void;
  /** Play from start for duration seconds (auto-pauses unless cancelled). */
  onSeekTo?: (time: number, duration: number) => void;
  canEdit: boolean;
  hasFinalAudio: boolean;
  finalDurationSec: number;
  /** Current final-episode playhead time (seconds). Used as default when adding. */
  playheadTimeSec?: number;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
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

function clampDuration(n: number): number {
  if (!Number.isFinite(n)) return SOUNDBITE_DEFAULT_DURATION;
  if (n < 15) return 15;
  if (n > 120) return 120;
  return n;
}

function clampPlayheadTime(playheadTimeSec: number | undefined, maxTimeSec: number): number {
  const t = Math.floor(playheadTimeSec ?? 0);
  if (!Number.isFinite(t) || t < 0) return 0;
  if (maxTimeSec > 0 && t > maxTimeSec) return Math.floor(maxTimeSec);
  return t;
}

function SoundbiteEditDialog({
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
  marker: SoundbiteMarker | null;
  mode: 'add' | 'edit';
  defaultTimeSec?: number;
  maxTimeSec: number;
  onSave: (m: SoundbiteMarker) => void;
}) {
  const initialTitle = marker?.title ?? '';
  const initialTimeStr =
    mode === 'add' && defaultTimeSec !== undefined
      ? formatDuration(Math.floor(defaultTimeSec))
      : marker != null
        ? formatDuration(Math.floor(marker.time))
        : '0:00';
  const initialDurationStr = String(
    marker != null ? clampDuration(marker.duration) : SOUNDBITE_DEFAULT_DURATION,
  );
  const initialColor = marker?.color ?? SOUNDBITE_COLORS[0];

  const [title, setTitle] = useState(initialTitle);
  const [timeStr, setTimeStr] = useState(initialTimeStr);
  const [durationStr, setDurationStr] = useState(initialDurationStr);
  const [color, setColor] = useState(initialColor);
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState({
    title: initialTitle,
    timeStr: initialTimeStr,
    durationStr: initialDurationStr,
    color: initialColor,
  });

  useEffect(() => {
    if (open) {
      const timeStrVal =
        mode === 'add' && defaultTimeSec !== undefined
          ? formatDuration(Math.floor(defaultTimeSec))
          : marker != null
            ? formatDuration(Math.floor(marker.time))
            : '0:00';
      const nextTitle = marker?.title ?? '';
      const nextDurationStr = String(
        marker != null ? clampDuration(marker.duration) : SOUNDBITE_DEFAULT_DURATION,
      );
      const nextColor = marker?.color ?? SOUNDBITE_COLORS[0];
      setTitle(nextTitle);
      setTimeStr(timeStrVal);
      setDurationStr(nextDurationStr);
      setColor(nextColor);
      setError(null);
      setBaseline({
        title: nextTitle,
        timeStr: timeStrVal,
        durationStr: nextDurationStr,
        color: nextColor,
      });
    }
  }, [open, marker, mode, defaultTimeSec]);

  const isDirty = useMemo(
    () =>
      title !== baseline.title ||
      timeStr !== baseline.timeStr ||
      durationStr !== baseline.durationStr ||
      color !== baseline.color,
    [title, timeStr, durationStr, color, baseline],
  );

  const close = () => onOpenChange(false);
  const {
    confirmOpen,
    requestClose,
    onOpenChange: guardOnOpenChange,
    handleConfirmOpenChange,
    handleDiscard,
    dialogContentProps,
  } = useDialogCloseGuard({ isDirty, onClose: close });

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
    const durationNum = Number(durationStr);
    if (!Number.isFinite(durationNum) || durationNum < 15 || durationNum > 120) {
      setError('Duration must be between 15 and 120 seconds');
      return;
    }
    const t = (title ?? '').trim();
    if (!t) {
      setError('Soundbite name is required');
      return;
    }
    if (t.length > SOUNDBITE_TITLE_MAX) {
      setError(`Name cannot exceed ${SOUNDBITE_TITLE_MAX} characters`);
      return;
    }
    setError(null);
    onSave({
      time: timeSec,
      duration: clampDuration(durationNum),
      title: t,
      color: color || undefined,
    });
    close();
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={guardOnOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentWide}`}
            onEscapeKeyDown={(e) => {
              e.stopPropagation();
              dialogContentProps.onEscapeKeyDown(e);
            }}
            onPointerDownOutside={(e) => {
              e.preventDefault();
              dialogContentProps.onPointerDownOutside(e);
            }}
            onInteractOutside={(e) => {
              e.preventDefault();
              dialogContentProps.onInteractOutside(e);
            }}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>
                {mode === 'add' ? 'Add Soundbite' : 'Edit Soundbite'}
              </Dialog.Title>
              <button type="button" className={styles.dialogClose} aria-label="Close" onClick={requestClose}>
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              {mode === 'add'
                ? 'Add a soundbite. Duration must be between 15 and 120 seconds.'
                : 'Edit the soundbite name, start time, and duration.'}
            </Dialog.Description>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              <label className={styles.chapterEditLabel}>
                <span>Soundbite name</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, SOUNDBITE_TITLE_MAX))}
                  placeholder="e.g. Best moment"
                  className={styles.chapterEditInput}
                  maxLength={SOUNDBITE_TITLE_MAX}
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
              <label className={styles.chapterEditLabel}>
                <span>Duration (seconds)</span>
                <input
                  type="number"
                  min={15}
                  max={120}
                  step={1}
                  value={durationStr}
                  onChange={(e) => setDurationStr(e.target.value)}
                  className={styles.chapterEditInput}
                  aria-label="Soundbite duration in seconds"
                />
              </label>
              <div className={styles.chapterEditLabel}>
                <span>Color</span>
                <div className={styles.chapterColorRow} role="group" aria-label="Marker color">
                  {SOUNDBITE_COLORS.map((c) => {
                    const isSelected = (color ?? SOUNDBITE_COLORS[0]) === c;
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
                        aria-label="Set color"
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
              <button type="button" className={styles.cancel} onClick={requestClose}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.renderBtnPrimary}
                onClick={handleSave}
                aria-label={mode === 'add' ? 'Add soundbite' : 'Save changes'}
              >
                {mode === 'add' ? 'Add Soundbite' : 'Save'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <UnsavedChangesConfirmDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        onDiscard={handleDiscard}
      />
    </>
  );
}

export function SoundbitesCard({
  episodeId,
  soundbites,
  onSoundbitesChange,
  onSeekTo,
  canEdit,
  hasFinalAudio,
  finalDurationSec,
  playheadTimeSec,
  expanded: expandedProp,
  onExpandedChange,
  hideHeader = false,
}: SoundbitesCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = expandedProp ?? internalExpanded;
  const setExpanded = onExpandedChange ?? setInternalExpanded;
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const sorted = [...soundbites].sort((a, b) => a.time - b.time);

  const handleSaveEdit = (m: SoundbiteMarker) => {
    if (editIndex === null) return;
    const next = sorted.map((item, i) => (i === editIndex ? m : item));
    next.sort((a, b) => a.time - b.time);
    onSoundbitesChange(next);
    setEditIndex(null);
  };

  const handleSaveAdd = (m: SoundbiteMarker) => {
    const next = [...sorted, m];
    next.sort((a, b) => a.time - b.time);
    onSoundbitesChange(next);
    setAddOpen(false);
  };

  const handleDelete = () => {
    if (deleteIndex === null) return;
    onSoundbitesChange(sorted.filter((_, i) => i !== deleteIndex));
    setDeleteIndex(null);
  };

  async function handleDownload(m: SoundbiteMarker, index: number) {
    const key = `${m.time}-${m.duration}-${index}`;
    if (downloadingKey) return;
    setDownloadingKey(key);
    setDownloadError(null);
    try {
      const url = downloadSoundbiteUrl(episodeId, {
        start: m.time,
        duration: clampDuration(m.duration),
        title: m.title,
      });
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `soundbite.${blob.type.includes('mp4') ? 'm4a' : 'mp3'}`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to download soundbite');
    } finally {
      setDownloadingKey(null);
    }
  }

  return (
    <div className={`${styles.chaptersCard} ${hideHeader ? styles.chaptersCardEmbedded : ''}`}>
      {!hideHeader && (
        <button
          type="button"
          className={styles.chaptersCardHeader}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="soundbites-card-content"
          id="soundbites-card-toggle"
        >
          <span className={styles.chaptersCardHeaderText}>View Soundbites</span>
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
        id="soundbites-card-content"
        role="region"
        aria-labelledby={hideHeader ? undefined : 'soundbites-card-toggle'}
        className={styles.chaptersCardBody}
        style={{ display: expanded ? 'block' : 'none' }}
      >
        {canEdit && (
          <div className={styles.chaptersRebuildWarning} role="status">
            <TriangleAlert size={16} strokeWidth={2} aria-hidden className={styles.chaptersRebuildWarningIcon} />
            <span>
              Any new markers or changes made here will be overwritten when you rebuild the episode.
              Make permanent changes in the segment editor.
            </span>
          </div>
        )}
        {sorted.length === 0 ? (
          <div className={styles.chaptersEmpty}>
            {canEdit ? (
              <>
                <button
                  type="button"
                  className={styles.chaptersAddFirstBtn}
                  onClick={() => setAddOpen(true)}
                  aria-label="Add first soundbite"
                >
                  <Plus size={18} strokeWidth={2} aria-hidden />
                  Add First Soundbite
                </button>
                <p className={styles.chaptersEmptyHint}>
                  or add soundbites using markers in the segment editor
                </p>
              </>
            ) : (
              <p className={styles.chaptersEmptyHint}>
                No soundbites yet. Add soundbite markers in the segment editor and rebuild the episode.
              </p>
            )}
          </div>
        ) : (
          <>
            {downloadError && (
              <p className={styles.error} role="alert" style={{ margin: '0 0 0.75rem' }}>
                {downloadError}
              </p>
            )}
            <table className={styles.chaptersTable}>
              <thead>
                <tr>
                  <th scope="col" className={styles.chaptersTablePlayCol} aria-label="Play" />
                  <th scope="col" className={styles.chaptersTableColorCol} aria-label="Color" />
                  <th scope="col">Soundbite</th>
                  <th scope="col" className={styles.chaptersTableTimeCol}>Start</th>
                  <th scope="col" className={styles.chaptersTableTimeCol}>Duration</th>
                  <th scope="col" className={styles.chaptersTableActionsCol} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((m, i) => (
                  <tr key={`${m.time}-${m.duration}-${i}`}>
                    <td className={styles.chaptersTablePlayCol}>
                      {hasFinalAudio && onSeekTo ? (
                        <button
                          type="button"
                          className={styles.chapterPlayBtn}
                          onClick={() => onSeekTo(m.time, clampDuration(m.duration))}
                          aria-label={`Play ${m.title ?? 'soundbite'} for ${clampDuration(m.duration)} seconds`}
                          title={`Play ${clampDuration(m.duration)}s from ${formatDuration(Math.floor(m.time))}`}
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
                        style={{ backgroundColor: m.color ?? SOUNDBITE_COLORS[0] }}
                        title={m.color ?? 'Default color'}
                        aria-hidden
                      />
                    </td>
                    <td className={styles.chaptersTableNameCol}>{m.title ?? 'Untitled'}</td>
                    <td className={styles.chaptersTableTimeCol}>{formatDuration(Math.floor(m.time))}</td>
                    <td className={styles.chaptersTableTimeCol}>{clampDuration(m.duration)}s</td>
                    <td className={styles.chaptersTableActionsCol}>
                      <div className={styles.chaptersTableActionsWrap}>
                        {hasFinalAudio && (
                          <button
                            type="button"
                            className={styles.chaptersTableActionBtn}
                            onClick={() => void handleDownload(m, i)}
                            disabled={downloadingKey != null}
                            aria-label={`Download ${m.title ?? 'soundbite'}`}
                            title={
                              downloadingKey === `${m.time}-${m.duration}-${i}`
                                ? 'Preparing download…'
                                : 'Download soundbite clip'
                            }
                          >
                            <Download size={16} strokeWidth={2} aria-hidden />
                          </button>
                        )}
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              className={styles.chaptersTableActionBtn}
                              onClick={() => setEditIndex(i)}
                              aria-label={`Edit ${m.title ?? 'soundbite'}`}
                              title="Edit soundbite"
                            >
                              <Pencil size={16} strokeWidth={2} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className={`${styles.chaptersTableActionBtn} ${styles.chaptersTableActionBtnDelete}`}
                              onClick={() => setDeleteIndex(i)}
                              aria-label={`Delete ${m.title ?? 'soundbite'}`}
                              title="Delete soundbite"
                            >
                              <Trash2 size={16} strokeWidth={2} aria-hidden />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
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
                  aria-label="Add soundbite"
                >
                  <Plus size={18} strokeWidth={2} aria-hidden />
                  Add Soundbite
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <SoundbiteEditDialog
        open={editIndex !== null}
        onOpenChange={(o) => !o && setEditIndex(null)}
        marker={editIndex !== null ? sorted[editIndex]! : null}
        mode="edit"
        maxTimeSec={finalDurationSec}
        onSave={handleSaveEdit}
      />

      <SoundbiteEditDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        marker={null}
        mode="add"
        defaultTimeSec={clampPlayheadTime(playheadTimeSec, finalDurationSec)}
        maxTimeSec={finalDurationSec}
        onSave={handleSaveAdd}
      />

      <Dialog.Root open={deleteIndex !== null} onOpenChange={(o) => !o && setDeleteIndex(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`} />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentOnModal}`}
            onEscapeKeyDown={(e) => e.stopPropagation()}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Delete soundbite?</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className={styles.dialogClose} aria-label="Close">
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              {deleteIndex !== null && sorted[deleteIndex]
                ? `Remove "${sorted[deleteIndex]!.title ?? 'Untitled'}"?`
                : 'Remove this soundbite?'}
            </Dialog.Description>
            <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`} style={{ marginTop: '1.25rem' }}>
              <button type="button" className={styles.cancel} onClick={() => setDeleteIndex(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.dialogConfirmRemove}
                onClick={handleDelete}
                aria-label="Delete soundbite"
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

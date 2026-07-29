import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Trash2, X } from 'lucide-react';
import type { Marker } from '@harborfm/shared';
import { formatTimeInput, parseTimeInput } from '../../pages/EpisodeEditor/utils';
import { useDialogCloseGuard } from '../../hooks/useDialogCloseGuard';
import { UnsavedChangesConfirmDialog } from '../UnsavedChangesConfirmDialog';
import { RemoveMarkerConfirmDialog } from '../SegmentModal/dialogs/RemoveMarkerConfirmDialog';
import styles from '../../pages/EpisodeEditor.module.css';

export const MARKER_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#ef4444',
  '#eab308',
  '#a855f7',
  '#f97316',
  '#06b6d4',
  '#ec4899',
] as const;

type MarkerType = '' | 'chapter' | 'soundbite';

export type MarkerEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marker: Marker | null;
  maxTimeSec: number;
  onSave: (marker: Marker) => void;
  onRemove: () => void;
};

function clampSoundbiteDuration(raw: string): number {
  let d = Number(raw);
  if (!Number.isFinite(d)) d = 30;
  if (d < 15) d = 15;
  if (d > 120) d = 120;
  return Math.round(d);
}

export function MarkerEditDialog({
  open,
  onOpenChange,
  marker,
  maxTimeSec,
  onSave,
  onRemove,
}: MarkerEditDialogProps) {
  const initialTitle = marker?.title ?? '';
  const initialTimeStr =
    marker != null ? formatTimeInput(marker.time) : '0:00';
  const initialColor = marker?.color ?? MARKER_COLORS[0];
  const initialType = (marker?.markerType ?? '') as MarkerType;
  const initialDuration = String(
    typeof marker?.duration === 'number' && Number.isFinite(marker.duration)
      ? Math.min(120, Math.max(15, marker.duration))
      : 30,
  );

  const [title, setTitle] = useState(initialTitle);
  const [timeStr, setTimeStr] = useState(initialTimeStr);
  const [color, setColor] = useState(initialColor);
  const [markerType, setMarkerType] = useState<MarkerType>(initialType);
  const [duration, setDuration] = useState(initialDuration);
  const [error, setError] = useState<string | null>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const [baseline, setBaseline] = useState({
    title: initialTitle,
    timeStr: initialTimeStr,
    color: initialColor,
    markerType: initialType,
    duration: initialDuration,
  });

  useEffect(() => {
    if (!open || !marker) return;
    const nextTitle = marker.title ?? '';
    const nextTimeStr = formatTimeInput(marker.time);
    const nextColor = marker.color ?? MARKER_COLORS[0];
    const nextType = (marker.markerType ?? '') as MarkerType;
    const nextDuration = String(
      typeof marker.duration === 'number' && Number.isFinite(marker.duration)
        ? Math.min(120, Math.max(15, marker.duration))
        : 30,
    );
    setTitle(nextTitle);
    setTimeStr(nextTimeStr);
    setColor(nextColor);
    setMarkerType(nextType);
    setDuration(nextDuration);
    setError(null);
    setRemoveConfirmOpen(false);
    setBaseline({
      title: nextTitle,
      timeStr: nextTimeStr,
      color: nextColor,
      markerType: nextType,
      duration: nextDuration,
    });
  }, [open, marker]);

  const isDirty = useMemo(
    () =>
      title !== baseline.title ||
      timeStr !== baseline.timeStr ||
      color !== baseline.color ||
      markerType !== baseline.markerType ||
      (markerType === 'soundbite' && duration !== baseline.duration),
    [title, timeStr, color, markerType, duration, baseline],
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
      setError('Enter a valid time (e.g. 1:20.5 or 90)');
      return;
    }
    if (maxTimeSec > 0 && timeSec > maxTimeSec) {
      setError(`Time cannot exceed ${formatTimeInput(maxTimeSec)}`);
      return;
    }
    const type = markerType || undefined;
    let nextDuration: number | undefined;
    if (type === 'soundbite') {
      nextDuration = clampSoundbiteDuration(duration);
    }
    setError(null);
    onSave({
      time: timeSec,
      title: title.trim() || undefined,
      color: color || undefined,
      markerType: type,
      duration: nextDuration,
    });
    close();
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={guardOnOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay
            className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`}
          />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentOnModal}`}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              labelInputRef.current?.focus();
            }}
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
              <Dialog.Title className={styles.dialogTitle}>Edit marker</Dialog.Title>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                onClick={requestClose}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              Set the label, time, color, and type. Chapters and soundbites carry into the
              final episode on render.
            </Dialog.Description>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                marginTop: '1rem',
              }}
            >
              <label className={styles.chapterEditLabel}>
                <span>Label</span>
                <input
                  ref={labelInputRef}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Optional label"
                  className={styles.chapterEditInput}
                />
              </label>
              <label className={styles.chapterEditLabel}>
                <span>Time</span>
                <input
                  type="text"
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                  placeholder="1:20.5 or 90"
                  className={styles.chapterEditInput}
                />
              </label>
              <div className={styles.chapterEditLabel}>
                <span>Color</span>
                <div className={styles.chapterColorRow} role="group" aria-label="Marker color">
                  {MARKER_COLORS.map((c) => {
                    const isSelected = (color ?? MARKER_COLORS[0]) === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        className={`${styles.chapterColorBtn} ${
                          isSelected ? styles.chapterColorBtnSelected : ''
                        }`}
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
              <div className={styles.chapterEditLabel}>
                <span>Type</span>
                <div className={styles.markerTypeRow} role="group" aria-label="Marker type">
                  {(
                    [
                      { value: '' as const, label: 'None' },
                      { value: 'chapter' as const, label: 'Chapter' },
                      { value: 'soundbite' as const, label: 'Soundbite' },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={value || 'none'}
                      type="button"
                      className={
                        markerType === value
                          ? styles.statusToggleActive
                          : styles.statusToggleBtn
                      }
                      onClick={() => {
                        setMarkerType(value);
                        if (value === 'soundbite') {
                          const n = Number(duration);
                          if (!Number.isFinite(n) || n < 15 || n > 120) {
                            setDuration('30');
                          }
                        }
                      }}
                      aria-pressed={markerType === value}
                      aria-label={label}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {markerType === 'soundbite' && (
                <label className={styles.chapterEditLabel}>
                  <span>Soundbite duration (seconds)</span>
                  <input
                    type="number"
                    min={15}
                    max={120}
                    step={1}
                    inputMode="numeric"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className={styles.chapterEditInput}
                    aria-label="Soundbite duration in seconds"
                  />
                </label>
              )}
              {error && (
                <p className={styles.error} role="alert" style={{ margin: 0 }}>
                  {error}
                </p>
              )}
            </div>
            <div
              className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}
              style={{ marginTop: '1.25rem' }}
            >
              <button type="button" className={styles.cancel} onClick={requestClose}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.dialogConfirmRemove}
                onClick={() => setRemoveConfirmOpen(true)}
                aria-label="Remove marker"
                title="Remove marker"
              >
                <Trash2 size={14} aria-hidden />
                Remove
              </button>
              <button
                type="button"
                className={styles.renderBtnPrimary}
                onClick={handleSave}
                aria-label="Save marker"
              >
                Save
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
      <RemoveMarkerConfirmDialog
        open={removeConfirmOpen}
        onOpenChange={setRemoveConfirmOpen}
        onConfirm={() => {
          onRemove();
          close();
        }}
      />
    </>
  );
}

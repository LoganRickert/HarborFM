import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Marker } from '@harborfm/shared';
import styles from '../../../pages/EpisodeEditor.module.css';

export interface SegmentSplitConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (params: { minutes: number; seconds: number }) => void;
  loading: boolean;
  durationSec: number;
  /** Current segment markers; used for optional split-at-marker. */
  markers?: Marker[];
}

type SplitSource = 'time' | 'marker';

function formatDuration(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.max(0, sec) % 60;
  const sRounded = Math.round(s * 100) / 100;
  return `${m}m ${sRounded}s`;
}

function parseMinutes(raw: string): number | null {
  if (raw.trim() === '') return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

function parseSeconds(raw: string): number | null {
  if (raw.trim() === '') return null;
  if (!/^\d*\.?\d*$/.test(raw.trim()) || raw.trim() === '.') return null;
  const v = parseFloat(raw);
  return Number.isFinite(v) && v >= 0 && v < 60 ? v : null;
}

function midpointSplitFields(durationSec: number): { minutes: string; seconds: string } {
  if (!(durationSec > 0) || !Number.isFinite(durationSec)) {
    return { minutes: '', seconds: '' };
  }
  const halfSec = Math.round(durationSec / 2);
  const minutes = Math.floor(halfSec / 60);
  const seconds = halfSec % 60;
  return { minutes: String(minutes), seconds: String(seconds) };
}

function secToFields(sec: number): { minutes: string; seconds: string } {
  const clamped = Math.max(0, sec);
  const minutes = Math.floor(clamped / 60);
  const seconds = Math.round((clamped - minutes * 60) * 100) / 100;
  return { minutes: String(minutes), seconds: String(seconds) };
}

function markerTypeLabel(markerType?: Marker['markerType']): string {
  if (markerType === 'chapter') return 'Chapter';
  if (markerType === 'soundbite') return 'Soundbite';
  return 'Marker';
}

function markerOptionLabel(m: Marker): string {
  const title = m.title?.trim();
  const type = markerTypeLabel(m.markerType);
  const time = formatDuration(m.time);
  if (title) return `${time} - ${title} (${type})`;
  return `${time} (${type})`;
}

export function SegmentSplitConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
  durationSec,
  markers = [],
}: SegmentSplitConfirmDialogProps) {
  const [source, setSource] = useState<SplitSource>('time');
  const [minutesText, setMinutesText] = useState('');
  const [secondsText, setSecondsText] = useState('');
  const [selectedMarkerKey, setSelectedMarkerKey] = useState('');

  const splitMarkers = useMemo(
    () =>
      markers
        .map((m, index) => ({ m, index }))
        .filter(({ m }) => Number.isFinite(m.time) && m.time > 0 && m.time < durationSec)
        .sort((a, b) => a.m.time - b.m.time),
    [markers, durationSec],
  );

  useEffect(() => {
    if (!open) return;
    const mid = midpointSplitFields(durationSec);
    setSource('time');
    setMinutesText(mid.minutes);
    setSecondsText(mid.seconds);
  }, [open, durationSec]);

  useEffect(() => {
    if (!open) return;
    setSelectedMarkerKey((prev) => {
      if (prev && splitMarkers.some((x) => String(x.index) === prev)) return prev;
      return splitMarkers[0] ? String(splitMarkers[0].index) : '';
    });
  }, [open, splitMarkers]);

  const selectedMarker = splitMarkers.find((x) => String(x.index) === selectedMarkerKey)?.m;

  const minutes =
    source === 'marker' && selectedMarker != null
      ? Math.floor(selectedMarker.time / 60)
      : parseMinutes(minutesText);
  const seconds =
    source === 'marker' && selectedMarker != null
      ? Math.round((selectedMarker.time % 60) * 100) / 100
      : parseSeconds(secondsText);
  const splitSec =
    minutes != null && seconds != null ? minutes * 60 + seconds : NaN;
  const splitValid =
    minutes != null &&
    seconds != null &&
    Number.isFinite(splitSec) &&
    splitSec > 0 &&
    splitSec < durationSec &&
    (source === 'time' || selectedMarker != null);

  const showTimeInvalid =
    source === 'time' &&
    durationSec > 0 &&
    (minutesText !== '' || secondsText !== '') &&
    !splitValid;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentOnModal}`}
          onEscapeKeyDown={(e) => e.stopPropagation()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Segment Split</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description asChild>
            <div className={styles.dialogDescription}>
              Split this segment into two at the time or marker below. This will update the audio
              file and cannot be undone.
              <div className={styles.removeSilenceNote}>
                Markers at or after the split time move to the new segment.
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                Segment length: {formatDuration(durationSec)}
              </div>
            </div>
          </Dialog.Description>

          <div
            className={styles.publishSettingSegmented}
            role="group"
            aria-label="Split using"
            style={{ marginTop: '0.75rem', width: '100%' }}
          >
            <button
              type="button"
              className={
                source === 'time'
                  ? styles.publishSettingSegmentedActive
                  : styles.publishSettingSegmentedBtn
              }
              onClick={() => setSource('time')}
              disabled={loading}
              aria-pressed={source === 'time'}
            >
              Time
            </button>
            <button
              type="button"
              className={
                source === 'marker'
                  ? styles.publishSettingSegmentedActive
                  : styles.publishSettingSegmentedBtn
              }
              onClick={() => {
                setSource('marker');
                if (!selectedMarkerKey && splitMarkers[0]) {
                  setSelectedMarkerKey(String(splitMarkers[0].index));
                }
              }}
              disabled={loading || splitMarkers.length === 0}
              aria-pressed={source === 'marker'}
              title={
                splitMarkers.length === 0
                  ? 'Add a marker between the start and end to split here'
                  : undefined
              }
            >
              Marker
            </button>
          </div>

          {source === 'time' ? (
            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'flex-end',
                marginTop: '0.75rem',
                marginBottom: '0.5rem',
                width: '100%',
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  flex: '1 1 0',
                  minWidth: 0,
                }}
              >
                <span style={{ fontSize: '0.9375rem', color: 'var(--text-muted)' }}>Minutes</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className={styles.input}
                  style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', minWidth: 0 }}
                  value={minutesText}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === '' || /^\d+$/.test(next)) setMinutesText(next);
                  }}
                  disabled={loading}
                  placeholder="0"
                  aria-label="Split at minutes"
                />
              </label>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  flex: '1 1 0',
                  minWidth: 0,
                }}
              >
                <span style={{ fontSize: '0.9375rem', color: 'var(--text-muted)' }}>Seconds</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={styles.input}
                  style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', minWidth: 0 }}
                  value={secondsText}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === '' || /^\d*\.?\d*$/.test(next)) setSecondsText(next);
                  }}
                  disabled={loading}
                  placeholder="0"
                  aria-label="Split at seconds"
                />
              </label>
            </div>
          ) : (
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                marginTop: '0.75rem',
                marginBottom: '0.5rem',
                width: '100%',
              }}
            >
              <span style={{ fontSize: '0.9375rem', color: 'var(--text-muted)' }}>Marker</span>
              <select
                className={styles.select}
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={selectedMarkerKey}
                onChange={(e) => {
                  const key = e.target.value;
                  setSelectedMarkerKey(key);
                  const found = splitMarkers.find((x) => String(x.index) === key);
                  if (found) {
                    const fields = secToFields(found.m.time);
                    setMinutesText(fields.minutes);
                    setSecondsText(fields.seconds);
                  }
                }}
                disabled={loading || splitMarkers.length === 0}
                aria-label="Split at marker"
              >
                {splitMarkers.length === 0 ? (
                  <option value="">No markers available</option>
                ) : (
                  splitMarkers.map(({ m, index }) => (
                    <option key={index} value={String(index)}>
                      {markerOptionLabel(m)}
                    </option>
                  ))
                )}
              </select>
            </label>
          )}

          {showTimeInvalid && (
            <p className={`${styles.error} ${styles.rateLimitError}`} role="alert">
              Enter a time greater than 0 and less than {formatDuration(durationSec)}.
            </p>
          )}
          {source === 'marker' && splitMarkers.length === 0 && (
            <p className={`${styles.error} ${styles.rateLimitError}`} role="alert">
              Add a marker between the start and end of the segment to split here.
            </p>
          )}
          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <button
              type="button"
              className={styles.cancel}
              onClick={(e) => {
                e.stopPropagation();
                onOpenChange(false);
              }}
              aria-label="Cancel segment split"
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.dialogConfirmRemove}
              onClick={(e) => {
                e.stopPropagation();
                if (!splitValid || minutes == null || seconds == null) return;
                onConfirm({ minutes, seconds });
              }}
              disabled={loading || !splitValid}
              aria-label="Confirm segment split"
            >
              {loading ? 'Splitting...' : 'Confirm'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

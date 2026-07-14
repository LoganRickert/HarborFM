import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from '../../../pages/EpisodeEditor.module.css';

export interface SegmentSplitConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (params: { minutes: number; seconds: number }) => void;
  loading: boolean;
  durationSec: number;
}

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

export function SegmentSplitConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
  durationSec,
}: SegmentSplitConfirmDialogProps) {
  const [minutesText, setMinutesText] = useState('');
  const [secondsText, setSecondsText] = useState('');

  useEffect(() => {
    if (open) {
      const mid = midpointSplitFields(durationSec);
      setMinutesText(mid.minutes);
      setSecondsText(mid.seconds);
    }
  }, [open, durationSec]);

  const minutes = parseMinutes(minutesText);
  const seconds = parseSeconds(secondsText);
  const splitSec =
    minutes != null && seconds != null ? minutes * 60 + seconds : NaN;
  const splitValid =
    minutes != null &&
    seconds != null &&
    Number.isFinite(splitSec) &&
    splitSec > 0 &&
    splitSec < durationSec;

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
              Split this segment into two at the time below. This will update the audio file and
              cannot be undone.
              <div className={styles.removeSilenceNote}>
                Markers at or after the split time move to the new segment.
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                Segment length: {formatDuration(durationSec)}
              </div>
            </div>
          </Dialog.Description>
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
          {!splitValid && durationSec > 0 && (minutesText !== '' || secondsText !== '') && (
            <p className={`${styles.error} ${styles.rateLimitError}`} role="alert">
              Enter a time greater than 0 and less than {formatDuration(durationSec)}.
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

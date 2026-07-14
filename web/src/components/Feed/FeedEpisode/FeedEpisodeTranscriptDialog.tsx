import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { parseSrt, parseSrtTimeToSeconds } from '../../SegmentModal/utils/srt';
import styles from './FeedEpisodeTranscriptDialog.module.css';

export interface FeedEpisodeTranscriptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Public or private transcript.srt URL. */
  transcriptUrl: string;
  episodeTitle?: string;
  /** Seek episode audio to this time (seconds) and start playback. */
  onSeekTo?: (timeSec: number) => void;
  /** Current playback position in seconds; used to highlight the active cue. */
  currentTime?: number;
}

function formatCueClock(srtTime: string): string {
  const total = Math.floor(Math.max(0, parseSrtTimeToSeconds(srtTime)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function FeedEpisodeTranscriptDialog({
  open,
  onOpenChange,
  transcriptUrl,
  episodeTitle,
  onSeekTo,
  currentTime = 0,
}: FeedEpisodeTranscriptDialogProps) {
  const [raw, setRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeCueRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRaw(null);

    fetch(transcriptUrl, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Transcript not found.' : 'Failed to load transcript.');
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setRaw(text);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load transcript.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, transcriptUrl]);

  const cues = useMemo(() => {
    if (!raw || !raw.includes('-->')) return null;
    const entries = parseSrt(raw);
    return entries.length > 0 ? entries : null;
  }, [raw]);

  const activeIndex = useMemo(() => {
    if (!cues || cues.length === 0) return -1;
    for (let i = 0; i < cues.length; i++) {
      const start = parseSrtTimeToSeconds(cues[i]!.start);
      const end = parseSrtTimeToSeconds(cues[i]!.end);
      if (currentTime + 0.05 >= start && currentTime < end) return i;
    }
    return -1;
  }, [cues, currentTime]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    activeCueRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open, activeIndex]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          aria-describedby="feed-episode-transcript-desc"
        >
          <div className={styles.header}>
            <div className={styles.headerText}>
              <Dialog.Title className={styles.title}>Transcript</Dialog.Title>
              <Dialog.Description id="feed-episode-transcript-desc" className={styles.subtitle}>
                {episodeTitle?.trim() || 'Episode transcript'}
              </Dialog.Description>
            </div>
            <Dialog.Close className={styles.closeBtn} aria-label="Close">
              <X size={20} strokeWidth={2} aria-hidden />
            </Dialog.Close>
          </div>

          <div className={styles.body}>
            {loading && <p className={styles.status}>Loading transcript…</p>}
            {!loading && error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {!loading && !error && cues && (
              <ol className={styles.cueList}>
                {cues.map((cue, i) => {
                  const clock = formatCueClock(cue.start);
                  const timeSec = parseSrtTimeToSeconds(cue.start);
                  const isActive = i === activeIndex;
                  return (
                    <li
                      key={`${cue.start}-${i}`}
                      ref={isActive ? activeCueRef : undefined}
                      className={`${styles.cue} ${isActive ? styles.cueActive : ''}`}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      {onSeekTo ? (
                        <button
                          type="button"
                          className={styles.cueTimeBtn}
                          onClick={() => {
                            // Land slightly before the cue so speech at the stamped time isn't missed.
                            onSeekTo(Math.max(0, timeSec - 0.1));
                          }}
                          aria-label={`Play from ${clock}`}
                          title={`Play from ${clock}`}
                        >
                          <time dateTime={cue.start}>{clock}</time>
                        </button>
                      ) : (
                        <time className={styles.cueTime} dateTime={cue.start}>
                          {clock}
                        </time>
                      )}
                      <p className={styles.cueText}>{cue.text}</p>
                    </li>
                  );
                })}
              </ol>
            )}
            {!loading && !error && !cues && raw != null && (
              <pre className={styles.fallback}>{raw.trim() || '(empty)'}</pre>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

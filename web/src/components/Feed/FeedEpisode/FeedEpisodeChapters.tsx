import { useId, useMemo, useState } from 'react';
import { ChevronRight, Play } from 'lucide-react';
import styles from './FeedEpisodeChapters.module.css';

export type FeedChapterMarker = { time: number; title?: string; color?: string };

const DEFAULT_CHAPTER_COLOR = '#3b82f6';

export interface FeedEpisodeChaptersProps {
  markers: FeedChapterMarker[];
  currentTime: number;
  /** Episode duration in seconds - used for the last chapter’s progress end. */
  durationSec?: number;
  onPlayChapter: (time: number) => void;
  className?: string;
}

function formatChapterTime(seconds: number): string {
  const total = Math.floor(Math.max(0, seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Index of the chapter currently playing (last marker at or before currentTime). */
function activeChapterIndex(markers: FeedChapterMarker[], currentTime: number): number {
  let active = -1;
  for (let i = 0; i < markers.length; i++) {
    if (markers[i]!.time <= currentTime + 0.25) active = i;
    else break;
  }
  return active;
}

/** 0–1 progress through a chapter given playhead and chapter bounds. */
function chapterProgress(
  currentTime: number,
  startSec: number,
  endSec: number
): number {
  const span = endSec - startSec;
  if (!(span > 0)) return currentTime >= startSec ? 1 : 0;
  if (currentTime <= startSec) return 0;
  if (currentTime >= endSec) return 1;
  return (currentTime - startSec) / span;
}

export function FeedEpisodeChapters({
  markers,
  currentTime,
  durationSec = 0,
  onPlayChapter,
  className,
}: FeedEpisodeChaptersProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => [...markers].sort((a, b) => a.time - b.time),
    [markers]
  );

  if (sorted.length === 0) return null;

  const activeIndex = activeChapterIndex(sorted, currentTime);
  const wrapClass = [styles.wrap, className].filter(Boolean).join(' ');
  const lastEnd = Math.max(durationSec, sorted[sorted.length - 1]!.time);

  return (
    <div className={wrapClass}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className={styles.toggleLabel}>Chapters</span>
        <ChevronRight
          size={18}
          strokeWidth={2.25}
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
          aria-hidden
        />
      </button>

      <div
        id={panelId}
        className={`${styles.panel} ${expanded ? styles.panelOpen : ''}`}
        aria-hidden={!expanded}
      >
        <div className={styles.panelInner}>
          <ul className={styles.list} role="list">
            {sorted.map((marker, i) => {
              const title = marker.title?.trim() || `Chapter ${i + 1}`;
              const timeLabel = formatChapterTime(marker.time);
              const isActive = i === activeIndex;
              const startSec = marker.time;
              const endSec = sorted[i + 1]?.time ?? lastEnd;
              const progress = chapterProgress(currentTime, startSec, endSec);
              const progressPct = Math.round(progress * 100);

              return (
                <li
                  key={`${marker.time}-${i}`}
                  className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                  style={{ borderRightColor: marker.color?.trim() || DEFAULT_CHAPTER_COLOR }}
                >
                  <div className={styles.itemRow}>
                    <button
                      type="button"
                      className={styles.playBtn}
                      onClick={() => onPlayChapter(marker.time)}
                      aria-label={`Play ${title} at ${timeLabel}`}
                      title={`Play from ${timeLabel}`}
                    >
                      <Play size={16} strokeWidth={2.25} aria-hidden />
                    </button>
                    <span className={styles.title}>{title}</span>
                    <span className={styles.time}>{timeLabel}</span>
                  </div>
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPct}
                    aria-label={`${title} progress`}
                  >
                    <div
                      className={`${styles.progressFill} ${isActive ? styles.progressFillActive : ''}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

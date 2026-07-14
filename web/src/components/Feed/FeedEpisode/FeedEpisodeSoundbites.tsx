import { useId, useMemo, useRef, useState } from 'react';
import { ChevronRight, Play, Pause } from 'lucide-react';
import styles from './FeedEpisodeChapters.module.css';

export type FeedSoundbiteMarker = {
  time: number;
  duration: number;
  title?: string;
  color?: string;
};

const DEFAULT_SOUNDBITE_COLOR = '#f97316';

export interface FeedEpisodeSoundbitesProps {
  soundbites: FeedSoundbiteMarker[];
  currentTime: number;
  /** True while episode audio is playing. */
  isPlaying?: boolean;
  seekAndPlay: (
    time: number,
    opts?: { soundbiteDurationSec?: number; onSoundbiteEnd?: () => void },
  ) => void;
  onPause?: () => void;
  /** Resume from current playhead (used when the active soundbite is paused). */
  onResume?: () => void;
  className?: string;
}

function formatTime(seconds: number): string {
  const total = Math.floor(Math.max(0, seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Index of the soundbite whose clip window contains the playhead (-1 if none). */
function activeSoundbiteIndex(soundbites: FeedSoundbiteMarker[], currentTime: number): number {
  let active = -1;
  for (let i = 0; i < soundbites.length; i++) {
    const sb = soundbites[i]!;
    const end = sb.time + sb.duration;
    if (sb.time <= currentTime + 0.25 && currentTime < end + 0.05) active = i;
  }
  return active;
}

function clipProgress(currentTime: number, startSec: number, endSec: number): number {
  const span = endSec - startSec;
  if (!(span > 0)) return currentTime >= startSec ? 1 : 0;
  if (currentTime <= startSec) return 0;
  if (currentTime >= endSec) return 1;
  return (currentTime - startSec) / span;
}

export function FeedEpisodeSoundbites({
  soundbites,
  currentTime,
  isPlaying = false,
  seekAndPlay,
  onPause,
  onResume,
  className,
}: FeedEpisodeSoundbitesProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => [...soundbites].sort((a, b) => a.time - b.time),
    [soundbites],
  );
  const sortedRef = useRef(sorted);
  sortedRef.current = sorted;

  const playFromIndexRef = useRef<(index: number) => void>(() => {});
  playFromIndexRef.current = (index: number) => {
    const list = sortedRef.current;
    const sb = list[index];
    if (!sb) return;
    const hasNext = index + 1 < list.length;
    seekAndPlay(sb.time, {
      soundbiteDurationSec: sb.duration,
      onSoundbiteEnd: hasNext ? () => playFromIndexRef.current(index + 1) : undefined,
    });
  };

  if (sorted.length === 0) return null;

  const activeIndex = activeSoundbiteIndex(sorted, currentTime);
  const wrapClass = [styles.wrap, className].filter(Boolean).join(' ');

  return (
    <div className={wrapClass}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className={styles.toggleLabel}>Soundbites</span>
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
              const title = marker.title?.trim() || `Soundbite ${i + 1}`;
              const timeLabel = `${formatTime(marker.time)} · ${Math.round(marker.duration)}s`;
              const isActive = i === activeIndex;
              const showPause = isActive && isPlaying;
              const startSec = marker.time;
              const endSec = marker.time + marker.duration;
              const progress = clipProgress(currentTime, startSec, endSec);
              const progressPct = Math.round(progress * 100);

              return (
                <li
                  key={`${marker.time}-${marker.duration}-${i}`}
                  className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                  style={{ borderRightColor: marker.color?.trim() || DEFAULT_SOUNDBITE_COLOR }}
                >
                  <div className={styles.itemRow}>
                    <button
                      type="button"
                      className={styles.playBtn}
                      onClick={() => {
                        if (showPause) {
                          onPause?.();
                          return;
                        }
                        if (isActive) {
                          const remaining = endSec - currentTime;
                          if (remaining > 0.15) {
                            const hasNext = i + 1 < sorted.length;
                            seekAndPlay(currentTime, {
                              soundbiteDurationSec: remaining,
                              onSoundbiteEnd: hasNext
                                ? () => playFromIndexRef.current(i + 1)
                                : undefined,
                            });
                          } else {
                            onResume?.();
                          }
                          return;
                        }
                        playFromIndexRef.current(i);
                      }}
                      aria-label={
                        showPause
                          ? `Pause ${title}`
                          : isActive
                            ? `Resume ${title}`
                            : `Play ${title} (${Math.round(marker.duration)} seconds)`
                      }
                      title={
                        showPause
                          ? 'Pause'
                          : isActive
                            ? 'Resume'
                            : `Play soundbite from ${formatTime(marker.time)}`
                      }
                    >
                      {showPause ? (
                        <Pause size={16} strokeWidth={2.25} aria-hidden />
                      ) : (
                        <Play size={16} strokeWidth={2.25} aria-hidden />
                      )}
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

import { useState, useRef, useEffect, useCallback } from 'react';
import { Volume2 } from 'lucide-react';
import { formatDurationEmbed } from '../../utils/format';
import styles from './FeedPlaybackControls.module.css';

export interface FeedPlaybackControlsProps {
  currentTime: number;
  durationSec: number;
  volume: number;
  setVolume: (volume: number) => void;
  playbackRate: number;
  cyclePlaybackRate: () => void;
  className?: string;
}

const COMPACT_VOLUME_WIDTH_PX = 200;
const VOLUME_IDLE_MS = 10_000;

export function FeedPlaybackControls({
  currentTime,
  durationSec,
  volume,
  setVolume,
  playbackRate,
  cyclePlaybackRate,
  className,
}: FeedPlaybackControlsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [compactVolume, setCompactVolume] = useState(false);
  const [volumeExpanded, setVolumeExpanded] = useState(false);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const scheduleCollapse = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      setVolumeExpanded(false);
    }, VOLUME_IDLE_MS);
  }, [clearIdleTimer]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(([entry]) => {
      const compact = entry.contentRect.width <= COMPACT_VOLUME_WIDTH_PX;
      setCompactVolume(compact);
      if (!compact) {
        setVolumeExpanded(false);
        clearIdleTimer();
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      clearIdleTimer();
    };
  }, [clearIdleTimer]);

  const handleVolumeBtnClick = () => {
    if (!compactVolume) return;
    setVolumeExpanded((open) => {
      const next = !open;
      if (next) scheduleCollapse();
      else clearIdleTimer();
      return next;
    });
  };

  const handleVolumeInput = (value: number) => {
    setVolume(value);
    if (compactVolume && volumeExpanded) scheduleCollapse();
  };

  const rowClassName = [
    styles.controlsRow,
    volumeExpanded ? styles.volumeExpanded : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={containerRef} className={rowClassName}>
      <span className={styles.time}>
        <span className={styles.timeCurrent}>{formatDurationEmbed(Math.ceil(currentTime))}</span>
        <span className={styles.timeSep}> / </span>
        <span className={styles.timeDuration}>{formatDurationEmbed(Math.ceil(durationSec))}</span>
      </span>
      <button
        type="button"
        className={styles.speedBtn}
        onClick={cyclePlaybackRate}
        aria-label="Playback speed"
      >
        {playbackRate}x
      </button>
      <button
        type="button"
        className={styles.volumeBtn}
        onClick={handleVolumeBtnClick}
        aria-label="Volume"
        aria-expanded={compactVolume ? volumeExpanded : undefined}
      >
        <Volume2 size={18} aria-hidden />
      </button>
      <div className={styles.volumeSliderHost}>
        <Volume2 size={18} className={styles.volumeIconWide} aria-hidden />
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => handleVolumeInput(Number(e.target.value))}
          onPointerDown={() => {
            if (compactVolume && volumeExpanded) scheduleCollapse();
          }}
          className={styles.volumeSlider}
          aria-label="Volume"
        />
      </div>
    </div>
  );
}

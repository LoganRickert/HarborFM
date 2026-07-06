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

export function FeedPlaybackControls({
  currentTime,
  durationSec,
  volume,
  setVolume,
  playbackRate,
  cyclePlaybackRate,
  className,
}: FeedPlaybackControlsProps) {
  return (
    <div className={className ? `${styles.controlsRow} ${className}` : styles.controlsRow}>
      <span className={styles.time}>
        {formatDurationEmbed(Math.ceil(currentTime))} / {formatDurationEmbed(Math.ceil(durationSec))}
      </span>
      <button
        type="button"
        className={styles.speedBtn}
        onClick={cyclePlaybackRate}
        aria-label="Playback speed"
      >
        {playbackRate}x
      </button>
      <div className={styles.volumeWrap}>
        <Volume2 size={18} className={styles.volumeIcon} aria-hidden />
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className={styles.volumeSlider}
          aria-label="Volume"
        />
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { Play, Pause, FileAudio } from 'lucide-react';
import { downloadEpisodeUrl, finalEpisodeWaveformUrl } from '../../api/audio';
import { WaveformCanvas, type WaveformData } from './WaveformCanvas';
import styles from '../EpisodeEditor.module.css';

export interface GenerateFinalBarProps {
  episodeId: string;
  segmentCount: number;
  onBuild: () => void;
  isBuilding: boolean;
  hasFinalAudio: boolean;
  finalDurationSec: number;
}

export function GenerateFinalBar({
  episodeId,
  segmentCount,
  onBuild,
  isBuilding,
  hasFinalAudio,
  finalDurationSec,
}: GenerateFinalBarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (!hasFinalAudio || !episodeId || finalDurationSec <= 0) {
      setWaveformData(null);
      return;
    }
    let cancelled = false;
    fetch(finalEpisodeWaveformUrl(episodeId), { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.data?.length) setWaveformData(data as WaveformData);
        else if (!cancelled) setWaveformData(null);
      })
      .catch(() => {
        if (!cancelled) setWaveformData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId, hasFinalAudio, finalDurationSec]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      el.currentTime = 0;
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onLoadedMetadata = () => setCurrentTime(el.currentTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [finalDurationSec]);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      el.src = downloadEpisodeUrl(episodeId, 'final');
      setIsPlaying(true);
      el.play().catch(() => setIsPlaying(false));
    }
  }

  const durationSec = finalDurationSec > 0 ? finalDurationSec : 0;

  return (
    <div className={styles.generateBar}>
      <div className={styles.generateBarHeader}>
        <h2 className={styles.generateBarTitle}>Generate final episode</h2>
        <p className={styles.generateBarSub}>
          Build the final MP3 from your sections. When done, you can play it here or download it for your feed.
        </p>
      </div>
      {hasFinalAudio && durationSec > 0 && (
        <div className={styles.generateBarPlayback}>
          <button
            type="button"
            className={styles.segmentBtn}
            onClick={togglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause final episode' : 'Play final episode'}
          >
            {isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
          </button>
          {waveformData ? (
            <WaveformCanvas
              data={waveformData}
              durationSec={durationSec}
              currentTime={currentTime}
              onSeek={(time) => {
                const el = audioRef.current;
                if (el) {
                  el.currentTime = time;
                  setCurrentTime(time);
                }
              }}
              className={styles.generateBarWaveform}
            />
          ) : (
            <div className={styles.generateBarProgressPlaceholder} />
          )}
        </div>
      )}
      <audio ref={audioRef} style={{ display: 'none' }} />
      <div className={styles.generateBarInner}>
        <div className={styles.generateBarActions}>
          <button
            type="button"
            className={styles.renderBtnPrimary}
            onClick={onBuild}
            disabled={segmentCount === 0 || isBuilding}
            aria-label={isBuilding ? 'Building…' : 'Build final episode'}
          >
            <FileAudio size={20} strokeWidth={2} aria-hidden />
            <span>{isBuilding ? 'Building…' : 'Build final episode'}</span>
          </button>
          {hasFinalAudio && (
            <a href={downloadEpisodeUrl(episodeId, 'final')} download className={styles.renderDownload}>
              Download final audio
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

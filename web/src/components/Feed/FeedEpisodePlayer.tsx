import { useState, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import { useFeedAudioPlayer } from '../../hooks/useFeedAudioPlayer';
import { publicEpisodeWaveformUrl, PublicEpisodeWithAuth } from '../../api/public';
import { WaveformCanvas } from '../../pages/EpisodeEditor/WaveformCanvas';
import { FeedEpisodePlayerProps } from '../../types/feed';
import styles from './FeedEpisodePlayer.module.css';

export function FeedEpisodePlayer({
  episode,
  podcastSlug,
  isPlaying,
  onPlay,
  onPause,
}: FeedEpisodePlayerProps) {
  const [audioLoadFailed, setAudioLoadFailed] = useState(false);
  // Use private URL if available, otherwise fallback to public
  const episodeWithAuth = episode as PublicEpisodeWithAuth;
  const audioUrl = episodeWithAuth.privateAudioUrl || episode.audioUrl || null;
  const durationSec = episode.audioDurationSec ?? 0;

  useEffect(() => setAudioLoadFailed(false), [audioUrl]);

  const {
    audioRef,
    waveformData,
    currentTime,
    hasWaveform,
    togglePlay,
    seek,
  } = useFeedAudioPlayer({
    audioUrl,
    podcastSlug,
    episodeSlug: episode.slug,
    durationSec,
    waveformUrlFn: publicEpisodeWaveformUrl,
    privateWaveformUrl: episodeWithAuth.privateWaveformUrl,
    onPlay,
    onPause,
  });

  if (!audioUrl) return null;

  if (audioLoadFailed) {
    return (
      <div className={styles.noAudioCard} aria-label="No audio">
        <p className={styles.noAudioText}>Audio not available.</p>
      </div>
    );
  }

  return (
    <div className={styles.player}>
      {hasWaveform ? (
        <div className={styles.playbackRow}>
          <button
            type="button"
            className={styles.playPauseBtn}
            onClick={togglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={22} aria-hidden /> : <Play size={22} aria-hidden />}
          </button>
          <WaveformCanvas
            data={waveformData!}
            durationSec={durationSec}
            currentTime={currentTime}
            markers={episode.markers ?? []}
            onSeek={seek}
            className={styles.waveform}
          />
        </div>
      ) : null}
      {hasWaveform ? (
        <audio
          ref={audioRef}
          id={`audio-${episode.id}`}
          preload="metadata"
          style={{ display: 'none' }}
          onError={() => setAudioLoadFailed(true)}
        >
          <source src={audioUrl} type={episode.audioMime || 'audio/mpeg'} />
        </audio>
      ) : (
        <audio
          ref={audioRef}
          id={`audio-${episode.id}`}
          src={audioUrl}
          controls
          className={styles.audio}
          preload="metadata"
          onError={() => setAudioLoadFailed(true)}
        />
      )}
    </div>
  );
}

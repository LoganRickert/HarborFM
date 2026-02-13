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
  // Use private URL if available, otherwise fallback to public
  const episodeWithAuth = episode as PublicEpisodeWithAuth;
  const audioUrl = episodeWithAuth.private_audio_url || episode.audio_url || null;
  const durationSec = episode.audio_duration_sec ?? 0;

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
    privateWaveformUrl: episodeWithAuth.private_waveform_url,
    onPlay,
    onPause,
  });

  if (!audioUrl) return null;

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
        >
          <source src={audioUrl} type={episode.audio_mime || 'audio/mpeg'} />
        </audio>
      ) : (
        <audio
          ref={audioRef}
          id={`audio-${episode.id}`}
          src={audioUrl}
          controls
          className={styles.audio}
          preload="metadata"
        />
      )}
    </div>
  );
}

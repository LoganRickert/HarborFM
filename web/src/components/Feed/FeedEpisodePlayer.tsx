import { useState, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import { useFeedAudioPlayer } from '../../hooks/useFeedAudioPlayer';
import { publicEpisodeWaveformUrl, PublicEpisodeWithAuth } from '../../api/public';
import { WaveformCanvas } from '../../pages/EpisodeEditor/WaveformCanvas';
import { FeedPlaybackControls } from './FeedPlaybackControls';
import { FeedEpisodeChapters } from './FeedEpisode/FeedEpisodeChapters';
import { FeedEpisodeSoundbites } from './FeedEpisode/FeedEpisodeSoundbites';
import { FadeSlide } from './FadeSlide';
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
  const markers = episode.markers ?? [];
  const soundbites = episode.soundbites ?? [];

  useEffect(() => setAudioLoadFailed(false), [audioUrl]);

  const {
    audioRef,
    waveformData,
    currentTime,
    isPlaying: audioPlaying,
    hasWaveform,
    togglePlay,
    seek,
    seekAndPlay,
    volume,
    setVolume,
    playbackRate,
    cyclePlaybackRate,
  } = useFeedAudioPlayer({
    audioUrl,
    podcastSlug,
    episodeSlug: episode.slug,
    durationSec,
    waveformUrlFn: publicEpisodeWaveformUrl,
    privateWaveformUrl: episodeWithAuth.privateWaveformUrl,
    onPlay,
    onPause,
    persistPlaybackPosition: true,
    isActive: isPlaying,
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
            title={audioPlaying ? 'Pause' : 'Play'}
            aria-label={audioPlaying ? 'Pause' : 'Play'}
          >
            {audioPlaying ? <Pause size={22} aria-hidden /> : <Play size={22} aria-hidden />}
          </button>
          <WaveformCanvas
            data={waveformData!}
            durationSec={durationSec}
            currentTime={currentTime}
            markers={markers}
            onSeek={seek}
            className={styles.waveform}
          />
        </div>
      ) : null}
      {hasWaveform ? (
        <FadeSlide show={isPlaying || audioPlaying}>
          <FeedPlaybackControls
            currentTime={currentTime}
            durationSec={durationSec}
            volume={volume}
            setVolume={setVolume}
            playbackRate={playbackRate}
            cyclePlaybackRate={cyclePlaybackRate}
          />
        </FadeSlide>
      ) : null}
      {markers.length > 0 ? (
        <FeedEpisodeChapters
          markers={markers}
          currentTime={currentTime}
          durationSec={durationSec}
          isPlaying={audioPlaying}
          onPlayChapter={seekAndPlay}
          onPause={togglePlay}
          onResume={togglePlay}
          className={styles.chapters}
        />
      ) : null}
      {soundbites.length > 0 ? (
        <FeedEpisodeSoundbites
          soundbites={soundbites}
          currentTime={currentTime}
          isPlaying={audioPlaying}
          seekAndPlay={seekAndPlay}
          onPause={togglePlay}
          onResume={togglePlay}
          className={styles.chapters}
        />
      ) : null}
      {hasWaveform ? (
        <audio
          ref={audioRef}
          id={`audio-${episode.id}`}
          preload="none"
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
          preload="none"
          onError={() => setAudioLoadFailed(true)}
        />
      )}
    </div>
  );
}

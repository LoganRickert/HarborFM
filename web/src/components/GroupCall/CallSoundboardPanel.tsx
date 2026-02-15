import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Disc, ChevronDown, Minimize2, Maximize2, Play, Pause, Search, Volume2, VolumeX, X } from 'lucide-react';
import { listLibrary, libraryStreamUrl, libraryWaveformUrl, type LibraryAsset } from '../../api/library';
import { WaveformCanvas, type WaveformData } from '../../pages/EpisodeEditor/WaveformCanvas';
import styles from './CallSoundboardPanel.module.css';

export interface CallSoundboardPanelProps {
  connectSoundboard: (el: HTMLAudioElement | null) => void;
  setSoundboardVolume: (volume: number) => void;
  disabled?: boolean;
  onClose?: () => void;
  minimized: boolean;
  onMinimizeToggle: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  soundboardMuted: boolean;
  onSoundboardMuteToggle: () => void;
  muteDisabled?: boolean;
}

function SoundboardItem({
  asset,
  isPlaying,
  currentTime,
  onPlayPause,
  onSeek,
}: {
  asset: LibraryAsset;
  isPlaying: boolean;
  currentTime: number;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
}) {
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const durationSec = asset.duration_sec ?? 0;

  useEffect(() => {
    if (durationSec <= 0) {
      setWaveformData(null);
      return;
    }
    let cancelled = false;
    fetch(libraryWaveformUrl(asset.id), { credentials: 'include' })
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
  }, [asset.id, durationSec]);

  if (durationSec <= 0) return null;

  const progress = durationSec > 0 ? Math.min(1, Math.max(0, currentTime / durationSec)) : 0;

  return (
    <li className={styles.soundItem}>
      <span className={styles.soundItemName} title={asset.name}>
        {asset.name}
      </span>
      <div className={styles.waveformRow}>
        <button
          type="button"
          className={styles.playPauseBtn}
          onClick={onPlayPause}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? `Pause ${asset.name}` : `Play ${asset.name}`}
        >
          {isPlaying ? <Pause size={16} strokeWidth={2} aria-hidden /> : <Play size={16} strokeWidth={2} aria-hidden />}
        </button>
        {waveformData ? (
          <WaveformCanvas
            data={waveformData}
            durationSec={durationSec}
            currentTime={currentTime}
            onSeek={onSeek}
            onPlayPause={onPlayPause}
            className={styles.waveformTrack}
          />
        ) : (
          <div
            className={styles.waveformPlaceholder}
            role="progressbar"
            aria-valuenow={Math.round(currentTime)}
            aria-valuemin={0}
            aria-valuemax={durationSec}
            aria-label="Playback position"
            onClick={onPlayPause}
          >
            <div
              className={styles.waveformPlaceholderFill}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>
    </li>
  );
}

export function CallSoundboardPanel({
  connectSoundboard,
  setSoundboardVolume,
  onClose,
  minimized,
  onMinimizeToggle,
  volume,
  onVolumeChange,
  soundboardMuted,
  onSoundboardMuteToggle,
  muteDisabled,
}: CallSoundboardPanelProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(10);

  const SOUNDBOARD_PAGE_SIZE = 10;

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: () => listLibrary(),
  });
  const allAssets = data?.assets ?? [];

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = allAssets.filter((a) => {
      if ((a.duration_sec ?? 0) <= 0) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const ta = new Date(a.created_at ?? 0).getTime();
      const tb = new Date(b.created_at ?? 0).getTime();
      return tb - ta; // newest first
    });
    return list;
  }, [allAssets, searchQuery]);

  const displayedAssets = useMemo(
    () => filteredAndSorted.slice(0, visibleCount),
    [filteredAndSorted, visibleCount]
  );
  const hasMore = visibleCount < filteredAndSorted.length;

  useEffect(() => {
    const playable = allAssets.filter((a) => (a.duration_sec ?? 0) > 0);
    if (allAssets.length > 0) {
      console.log('[Soundboard] assets loaded', { total: allAssets.length, playable: playable.length, ids: playable.map((a) => a.id) });
    }
  }, [allAssets]);

  useEffect(() => {
    setVisibleCount(SOUNDBOARD_PAGE_SIZE);
  }, [searchQuery]);

  useEffect(() => {
    setSoundboardVolume(volume);
  }, [volume, setSoundboardVolume]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        connectSoundboard(null);
        audioRef.current = null;
      }
      setPlayingId(null);
    };
  }, [connectSoundboard]);

  async function handlePlay(asset: LibraryAsset) {
    console.log('[Soundboard] handlePlay START', { assetId: asset.id, assetName: asset.name, playingId, connectSoundboardType: typeof connectSoundboard });
    if (playingId === asset.id) {
      console.log('[Soundboard] Stopping current playback');
      if (audioRef.current) {
        audioRef.current.pause();
        connectSoundboard(null);
        audioRef.current = null;
      }
      setPlayingId(null);
      setCurrentTime(0);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      connectSoundboard(null);
      audioRef.current = null;
    }
    const audio = new Audio(libraryStreamUrl(asset.id));
    audioRef.current = audio;
    setPlayingId(asset.id);
    setCurrentTime(0);
    audio.onended = () => {
      console.log('[Soundboard] audio.onended');
      connectSoundboard(null);
      audioRef.current = null;
      setPlayingId(null);
      setCurrentTime(0);
    };
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
    try {
      console.log('[Soundboard] calling connectSoundboard(audio)...');
      const connectResult = connectSoundboard(audio);
      const didReturnPromise = connectResult && typeof (connectResult as Promise<unknown>).then === 'function';
      console.log('[Soundboard] connectSoundboard returned', { didReturnPromise });
      await connectResult;
      console.log('[Soundboard] connectSoundboard succeeded');
    } catch (err) {
      console.error('[Soundboard] connectSoundboard failed', err);
      connectSoundboard(null);
    }
    if (audioRef.current === audio) {
      console.log('[Soundboard] about to call audio.play()');
      try {
        await audio.play();
        console.log('[Soundboard] audio.play succeeded');
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        if (isAbort) {
          // play() interrupted by pause() — user likely switched sounds; only clean up if still current
          if (audioRef.current === audio) {
            connectSoundboard(null);
            audioRef.current = null;
            setPlayingId(null);
          }
        } else {
          console.error('[Soundboard] audio.play failed', err);
          connectSoundboard(null);
          audioRef.current = null;
          setPlayingId(null);
        }
      }
    } else {
      console.log('[Soundboard] Skipped audio.play - audioRef changed');
    }
  }

  function handleSeek(asset: LibraryAsset, time: number) {
    if (playingId !== asset.id || !audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }

  return (
    <div className={styles.panel} role="region" aria-label="Soundboard" data-minimized={minimized || undefined}>
      <div className={styles.header}>
        <Disc size={18} strokeWidth={2} aria-hidden />
        <span className={styles.title}>Soundboard</span>
        <span className={styles.headerSpacer} />
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onSoundboardMuteToggle}
          disabled={muteDisabled}
          aria-label={soundboardMuted ? 'Unmute soundboard (guests will hear)' : 'Mute soundboard (guests won\'t hear)'}
          title={soundboardMuted ? 'Unmute soundboard (guests will hear)' : 'Mute soundboard (guests won\'t hear)'}
        >
          {soundboardMuted ? <VolumeX size={16} strokeWidth={2} aria-hidden /> : <Volume2 size={16} strokeWidth={2} aria-hidden />}
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onMinimizeToggle}
          aria-label={minimized ? 'Maximize' : 'Minimize'}
          title={minimized ? 'Maximize' : 'Minimize'}
        >
          {minimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
        </button>
        {onClose && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close soundboard"
            title="Close soundboard"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
      {!minimized && (
        <div className={styles.volumeSection}>
          <span className={styles.volumeLabel} aria-hidden>
            Volume
          </span>
          <input
            type="range"
            className={styles.volumeSlider}
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10) / 100;
              onVolumeChange(v);
              setSoundboardVolume(v);
            }}
            aria-label="Soundboard volume"
          />
        </div>
      )}
      <div className={styles.body}>
        {allAssets.length === 0 ? (
          <p className={styles.emptyHint}>No library items. Add sounds in the Library.</p>
        ) : (
          <>
            <div className={styles.searchRow}>
              <Search size={16} strokeWidth={2} className={styles.searchIcon} aria-hidden />
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Search sounds..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search soundboard"
              />
            </div>
            {filteredAndSorted.length === 0 ? (
              <p className={styles.emptyHint}>No sounds match your search.</p>
            ) : (
              <>
                <ul className={styles.soundList}>
                  {displayedAssets.map((asset) => (
                    <SoundboardItem
                      key={asset.id}
                      asset={asset}
                      isPlaying={playingId === asset.id}
                      currentTime={playingId === asset.id ? currentTime : 0}
                      onPlayPause={() => {
                        console.log('[Soundboard] play button clicked', { assetId: asset.id, assetName: asset.name });
                        handlePlay(asset);
                      }}
                      onSeek={(time) => handleSeek(asset, time)}
                    />
                  ))}
                </ul>
                {hasMore && (
                  <button
                    type="button"
                    className={styles.loadMoreBtn}
                    onClick={() => setVisibleCount((n) => n + SOUNDBOARD_PAGE_SIZE)}
                  >
                    <ChevronDown size={18} strokeWidth={2} aria-hidden />
                    Load more
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

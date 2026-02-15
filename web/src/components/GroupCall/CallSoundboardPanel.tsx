import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback';
import { useQuery } from '@tanstack/react-query';
import { Disc, ChevronDown, Minimize2, Maximize2, Play, Pause, Search, Volume2, VolumeX, X } from 'lucide-react';
import { listLibrary, libraryWaveformUrl, type LibraryAsset } from '../../api/library';
import { WaveformCanvas, type WaveformData } from '../../pages/EpisodeEditor/WaveformCanvas';
import styles from './CallSoundboardPanel.module.css';

export interface CallSoundboardPanelProps {
  playSoundboard: (assetId: string, startTimeSec?: number) => void;
  stopSoundboard: () => void;
  setSoundboardVolume: (volume: number) => void;
  onSoundboardStoppedRef?: React.MutableRefObject<(() => void) | null>;
  disabled?: boolean;
  onClose?: () => void;
  minimized: boolean;
  onMinimizeToggle: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  soundboardMuted: boolean;
  onSoundboardMuteToggle: () => void;
  muteDisabled?: boolean;
  /** When true and onRecordingEvent provided, soundboard play/stop emits recording events for sync. */
  recording?: boolean;
  onRecordingEvent?: (ev: { event: string; assetId?: string; clientTimestampMs?: number; durationSec?: number }) => void;
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
  onPlayPause: (e?: React.MouseEvent) => void;
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
          data-playing={isPlaying || undefined}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPlayPause(e);
          }}
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
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const target = e.currentTarget;
              const rect = target.getBoundingClientRect();
              const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              onSeek(frac * durationSec);
            }}
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
  playSoundboard,
  stopSoundboard,
  setSoundboardVolume,
  onSoundboardStoppedRef,
  onClose,
  minimized,
  onMinimizeToggle,
  volume,
  onVolumeChange,
  soundboardMuted,
  onSoundboardMuteToggle,
  muteDisabled,
  recording,
  onRecordingEvent,
}: CallSoundboardPanelProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const justPausedRef = useRef<{ assetId: string; at: number } | null>(null);
  const transitioningToAssetIdRef = useRef<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(10);
  const [localVolume, setLocalVolume] = useState(volume);

  const SOUNDBOARD_PAGE_SIZE = 10;

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: () => listLibrary(),
  });
  const allAssets = data?.assets ?? [];

  const filteredAndSorted = useMemo(() => {
    const assets = data?.assets ?? [];
    const q = searchQuery.trim().toLowerCase();
    let list = assets.filter((a) => {
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
  }, [data?.assets, searchQuery]);

  const displayedAssets = useMemo(
    () => filteredAndSorted.slice(0, visibleCount),
    [filteredAndSorted, visibleCount]
  );
  const hasMore = visibleCount < filteredAndSorted.length;

  useEffect(() => {
    const assets = data?.assets ?? [];
    const playable = assets.filter((a) => (a.duration_sec ?? 0) > 0);
    if (assets.length > 0) {
      console.log('[Soundboard] assets loaded', { total: assets.length, playable: playable.length, ids: playable.map((a) => a.id) });
    }
  }, [data?.assets]);

  useEffect(() => {
    setVisibleCount(SOUNDBOARD_PAGE_SIZE);
  }, [searchQuery]);

  useEffect(() => {
    setLocalVolume(volume);
  }, [volume]);

  useEffect(() => {
    setSoundboardVolume(volume);
  }, [volume, setSoundboardVolume]);

  const debouncedVolumeUpdate = useDebouncedCallback((v: number) => {
    onVolumeChange(v);
    setSoundboardVolume(v);
  }, 150);

  useEffect(() => {
    if (onSoundboardStoppedRef) {
      onSoundboardStoppedRef.current = () => {
        const transitioningTo = transitioningToAssetIdRef.current;
        transitioningToAssetIdRef.current = null;
        if (transitioningTo) {
          setPlayingId(transitioningTo);
          // Keep progress timer running - it was just started for the new asset
        } else {
          if (progressTimerRef.current) {
            clearInterval(progressTimerRef.current);
            progressTimerRef.current = null;
          }
          setPlayingId(null);
          setCurrentTime(0);
        }
      };
      return () => {
        onSoundboardStoppedRef.current = null;
      };
    }
  }, [onSoundboardStoppedRef]);

  useEffect(() => {
    return () => {
      stopSoundboard();
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setPlayingId(null);
    };
  }, [stopSoundboard]);

  function handlePlay(asset: LibraryAsset) {
    const now = Date.now();
    const durationSec = asset.duration_sec ?? 0;

    if (playingId === asset.id) {
      transitioningToAssetIdRef.current = null;
      justPausedRef.current = { assetId: asset.id, at: now };
      if (recording && onRecordingEvent) {
        onRecordingEvent({ event: 'soundboardPause', assetId: asset.id, clientTimestampMs: now });
      }
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      stopSoundboard();
      setPlayingId(null);
      setCurrentTime(0);
      return;
    }

    const justPaused = justPausedRef.current;
    if (justPaused && now - justPaused.at < 200 && asset.id !== justPaused.assetId) {
      justPausedRef.current = null;
      return;
    }
    justPausedRef.current = null;

    if (playingId) {
      if (recording && onRecordingEvent) {
        onRecordingEvent({ event: 'soundboardPause', assetId: playingId, clientTimestampMs: now });
      }
      stopSoundboard();
    }

    transitioningToAssetIdRef.current = asset.id;

    if (recording && onRecordingEvent) {
      onRecordingEvent({
        event: 'soundboardPlay',
        assetId: asset.id,
        clientTimestampMs: now,
        durationSec: durationSec || undefined,
      });
    }

    playSoundboard(asset.id);
    setPlayingId(asset.id);
    setCurrentTime(0);

    const startTime = Date.now();
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setCurrentTime(Math.min(elapsed, durationSec || elapsed));
      if (durationSec > 0 && elapsed >= durationSec - 0.1) {
        if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
        transitioningToAssetIdRef.current = null;
        setPlayingId(null);
        setCurrentTime(0);
        if (recording && onRecordingEvent) {
          onRecordingEvent({ event: 'soundboardEnd', assetId: asset.id, clientTimestampMs: Date.now() });
        }
      }
    }, 100);
  }

  function handleSeek(asset: LibraryAsset, time: number) {
    const durationSec = asset.duration_sec ?? 0;
    const seekTime = Math.max(0, Math.min(time, durationSec));

    if (playingId === asset.id) {
      transitioningToAssetIdRef.current = asset.id;
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      stopSoundboard();
      if (recording && onRecordingEvent) {
        onRecordingEvent({ event: 'soundboardPause', assetId: asset.id, clientTimestampMs: Date.now() });
        onRecordingEvent({
          event: 'soundboardPlay',
          assetId: asset.id,
          clientTimestampMs: Date.now(),
          durationSec: durationSec || undefined,
        });
      }
      playSoundboard(asset.id, seekTime);
      setPlayingId(asset.id);
      setCurrentTime(seekTime);
      const startTime = Date.now() - seekTime * 1000;
      progressTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        setCurrentTime(Math.min(elapsed, durationSec || elapsed));
        if (durationSec > 0 && elapsed >= durationSec - 0.1) {
          if (progressTimerRef.current) {
            clearInterval(progressTimerRef.current);
            progressTimerRef.current = null;
          }
          transitioningToAssetIdRef.current = null;
          setPlayingId(null);
          setCurrentTime(0);
          if (recording && onRecordingEvent) {
            onRecordingEvent({ event: 'soundboardEnd', assetId: asset.id, clientTimestampMs: Date.now() });
          }
        }
      }, 100);
    } else {
      if (playingId) {
        if (recording && onRecordingEvent) {
          onRecordingEvent({ event: 'soundboardPause', assetId: playingId, clientTimestampMs: Date.now() });
        }
        stopSoundboard();
      }
      transitioningToAssetIdRef.current = asset.id;
      playSoundboard(asset.id, seekTime);
      setPlayingId(asset.id);
      setCurrentTime(seekTime);
      if (recording && onRecordingEvent) {
        onRecordingEvent({
          event: 'soundboardPlay',
          assetId: asset.id,
          clientTimestampMs: Date.now(),
          durationSec: durationSec || undefined,
        });
      }
      const startTime = Date.now() - seekTime * 1000;
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      progressTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        setCurrentTime(Math.min(elapsed, durationSec || elapsed));
        if (durationSec > 0 && elapsed >= durationSec - 0.1) {
          if (progressTimerRef.current) {
            clearInterval(progressTimerRef.current);
            progressTimerRef.current = null;
          }
          transitioningToAssetIdRef.current = null;
          setPlayingId(null);
          setCurrentTime(0);
          if (recording && onRecordingEvent) {
            onRecordingEvent({ event: 'soundboardEnd', assetId: asset.id, clientTimestampMs: Date.now() });
          }
        }
      }, 100);
    }
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
            value={Math.round(localVolume * 100)}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10) / 100;
              setLocalVolume(v);
              debouncedVolumeUpdate(v);
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
                      onPlayPause={(e) => {
                        e?.stopPropagation?.();
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

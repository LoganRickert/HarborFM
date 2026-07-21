import { useState, useEffect, useRef, useCallback } from 'react';
import { WaveformData } from '../pages/EpisodeEditor/WaveformCanvas';
import { useGlobalPlaybackSettings } from './useGlobalPlaybackSettings';
import {
  clearEpisodePlaybackPosition,
  clampStoredEpisodePosition,
  EPISODE_POSITION_SAVE_INTERVAL_MS,
  readEpisodePlaybackPosition,
  writeEpisodePlaybackPosition,
} from './episodePlaybackPosition';

interface UseFeedAudioPlayerParams {
  audioUrl: string | null;
  podcastSlug?: string;
  episodeSlug?: string;
  durationSec?: number;
  waveformUrlFn?: (podcastSlug: string, episodeSlug: string) => string;
  privateWaveformUrl?: string | null;
  onPlay?: () => void;
  onPause?: () => void;
  /** When false, pauses playback (feed list: only one active episode). Defaults to true. */
  isActive?: boolean;
  /** Save/restore listen position in localStorage (feed and episode pages). */
  persistPlaybackPosition?: boolean;
}

export function useFeedAudioPlayer({
  audioUrl,
  podcastSlug,
  episodeSlug,
  durationSec = 0,
  waveformUrlFn,
  privateWaveformUrl,
  onPlay,
  onPause,
  persistPlaybackPosition = false,
  isActive = true,
}: UseFeedAudioPlayerParams) {
  /** Mutable ref for play/seek helpers; kept in sync by the callback ref below. */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /**
   * Liquid themes portal the player after the first paint. A plain ref + useEffect
   * can run while the <audio> is not mounted yet and never re-attach listeners.
   * Track the element in state so timeupdate/play handlers bind when it appears.
   */
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const setAudioRef = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
    setAudioEl((prev) => (prev === el ? prev : el));
  }, []);
  const restoredPositionRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const wasActiveRef = useRef(isActive);
  const soundbiteSessionRef = useRef<{
    endSec: number;
    onClipEnd?: () => void;
  } | null>(null);
  const soundbiteAdvancingRef = useRef(false);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const { volume, setVolume, playbackRate, setPlaybackRate, cyclePlaybackRate } =
    useGlobalPlaybackSettings();

  const hasWaveform = Boolean(waveformData && durationSec > 0);

  const applyPlaybackSettings = useCallback(
    (el: HTMLAudioElement) => {
      el.volume = volume;
      el.playbackRate = playbackRate;
    },
    [volume, playbackRate],
  );

  const savePlaybackPosition = useCallback(() => {
    if (!persistPlaybackPosition || !podcastSlug || !episodeSlug) return;
    const el = audioRef.current;
    if (!el) return;
    writeEpisodePlaybackPosition(podcastSlug, episodeSlug, el.currentTime, durationSec);
  }, [persistPlaybackPosition, podcastSlug, episodeSlug, durationSec]);

  const restorePlaybackPosition = useCallback(
    (el: HTMLAudioElement) => {
      if (pendingSeekRef.current != null) {
        const target = pendingSeekRef.current;
        el.currentTime = target;
        setCurrentTime(target);
        restoredPositionRef.current = true;
        return;
      }
      if (!persistPlaybackPosition || !podcastSlug || !episodeSlug || restoredPositionRef.current) {
        return;
      }
      const saved = readEpisodePlaybackPosition(podcastSlug, episodeSlug);
      const clamped = saved == null ? null : clampStoredEpisodePosition(saved, durationSec);
      if (clamped == null) {
        if (saved != null) clearEpisodePlaybackPosition(podcastSlug, episodeSlug);
        restoredPositionRef.current = true;
        return;
      }
      el.currentTime = clamped;
      setCurrentTime(clamped);
      restoredPositionRef.current = true;
    },
    [persistPlaybackPosition, podcastSlug, episodeSlug, durationSec],
  );

  useEffect(() => {
    restoredPositionRef.current = false;
  }, [persistPlaybackPosition, podcastSlug, episodeSlug, audioUrl, hasWaveform]);

  // Pause when another feed episode becomes active (only on active to inactive transition).
  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      const el = audioEl ?? audioRef.current;
      if (el && !el.paused) {
        el.pause();
        setIsPlaying(false);
      }
    }
    wasActiveRef.current = isActive;
  }, [isActive, audioEl]);

  // Fetch waveform data
  useEffect(() => {
    if (durationSec <= 0 || !audioUrl) {
      setWaveformData(null);
      return;
    }

    // Use private waveform URL if available, otherwise use public waveform URL function
    let waveformUrl: string | null = null;
    if (privateWaveformUrl) {
      waveformUrl = privateWaveformUrl;
    } else if (podcastSlug && episodeSlug && waveformUrlFn) {
      waveformUrl = waveformUrlFn(podcastSlug, episodeSlug);
    }

    if (!waveformUrl) {
      setWaveformData(null);
      return;
    }

    let cancelled = false;
    fetch(waveformUrl)
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
  }, [podcastSlug, episodeSlug, durationSec, audioUrl, waveformUrlFn, privateWaveformUrl]);

  const clearSoundbiteSession = useCallback(() => {
    if (!soundbiteAdvancingRef.current) {
      soundbiteSessionRef.current = null;
    }
  }, []);

  // Set up audio event listeners (must re-run when the <audio> element mounts,
  // e.g. after LiquidFeedPage portals the player block).
  useEffect(() => {
    const el = audioEl;
    if (!el || !audioUrl) return;

    const onPlayEvt = () => {
      setIsPlaying(true);
      onPlay?.();
    };
    const onPauseEvt = () => {
      setIsPlaying(false);
      savePlaybackPosition();
      onPause?.();
      clearSoundbiteSession();
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      soundbiteSessionRef.current = null;
      if (persistPlaybackPosition && podcastSlug && episodeSlug) {
        clearEpisodePlaybackPosition(podcastSlug, episodeSlug);
      }
      onPause?.();
    };
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      const session = soundbiteSessionRef.current;
      if (session && el.currentTime >= session.endSec - 0.05) {
        const onClipEnd = session.onClipEnd;
        soundbiteSessionRef.current = null;
        if (onClipEnd) {
          soundbiteAdvancingRef.current = true;
          try {
            onClipEnd();
          } finally {
            soundbiteAdvancingRef.current = false;
          }
        } else {
          el.pause();
        }
      }
    };
    const onLoadedMetadata = () => {
      applyPlaybackSettings(el);
      restorePlaybackPosition(el);
      setCurrentTime(el.currentTime);
    };
    const onCanPlay = () => {
      applyPlaybackSettings(el);
      restorePlaybackPosition(el);
    };

    el.addEventListener('play', onPlayEvt);
    el.addEventListener('pause', onPauseEvt);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('canplay', onCanPlay);
    applyPlaybackSettings(el);
    restorePlaybackPosition(el);

    return () => {
      el.removeEventListener('play', onPlayEvt);
      el.removeEventListener('pause', onPauseEvt);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('canplay', onCanPlay);
    };
  }, [
    audioEl,
    audioUrl,
    onPlay,
    onPause,
    applyPlaybackSettings,
    restorePlaybackPosition,
    savePlaybackPosition,
    persistPlaybackPosition,
    podcastSlug,
    episodeSlug,
    clearSoundbiteSession,
  ]);

  useEffect(() => {
    if (!audioEl) return;
    applyPlaybackSettings(audioEl);
    restorePlaybackPosition(audioEl);
  }, [audioEl, applyPlaybackSettings, restorePlaybackPosition, audioUrl, hasWaveform]);

  useEffect(() => {
    if (!persistPlaybackPosition || !isPlaying || !podcastSlug || !episodeSlug) return;
    const id = window.setInterval(savePlaybackPosition, EPISODE_POSITION_SAVE_INTERVAL_MS);
    return () => {
      clearInterval(id);
      savePlaybackPosition();
    };
  }, [
    persistPlaybackPosition,
    isPlaying,
    podcastSlug,
    episodeSlug,
    savePlaybackPosition,
  ]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !audioUrl) return;

    if (!el.paused) {
      el.pause();
      setIsPlaying(false);
      onPause?.();
    } else {
      soundbiteSessionRef.current = null;
      onPlay?.();
      const needsLoad = !el.src || el.ended;
      if (needsLoad) {
        el.src = audioUrl;
        el.currentTime = currentTime;
      }
      applyPlaybackSettings(el);
      el.play().catch(() => {
        setIsPlaying(false);
        onPause?.();
      });
    }
  }, [audioUrl, currentTime, onPlay, onPause, applyPlaybackSettings]);

  const seek = useCallback((time: number) => {
    const el = audioRef.current;
    if (el) {
      soundbiteSessionRef.current = null;
      el.currentTime = time;
      setCurrentTime(time);
      savePlaybackPosition();
    }
  }, [savePlaybackPosition]);

  /**
   * Jump to `time` and play. Waits for the seek to finish before play() so Chromium does not
   * abort playback (AbortError) while the UI still looks active. Pending-seek wins over restore.
   * Pass `soundbiteDurationSec` to auto-pause (or call `onSoundbiteEnd`) when the clip ends.
   */
  const seekAndPlay = useCallback(
    (
      time: number,
      opts?: { soundbiteDurationSec?: number; onSoundbiteEnd?: () => void },
    ) => {
      const el = audioRef.current;
      if (!el || !audioUrl) return;

      const target = Math.max(0, time);
      if (opts?.soundbiteDurationSec != null && opts.soundbiteDurationSec > 0) {
        soundbiteSessionRef.current = {
          endSec: target + opts.soundbiteDurationSec,
          onClipEnd: opts.onSoundbiteEnd,
        };
      } else if (!soundbiteAdvancingRef.current) {
        soundbiteSessionRef.current = null;
      }
      pendingSeekRef.current = target;
      restoredPositionRef.current = true;
      setCurrentTime(target);
      onPlay?.();

      if (persistPlaybackPosition && podcastSlug && episodeSlug) {
        writeEpisodePlaybackPosition(podcastSlug, episodeSlug, target, durationSec);
      }

      const playAtTarget = () => {
        const seekTo = pendingSeekRef.current ?? target;
        pendingSeekRef.current = null;
        restoredPositionRef.current = true;
        applyPlaybackSettings(el);

        const startPlayback = () => {
          setCurrentTime(el.currentTime);
          const result = el.play();
          if (result && typeof result.then === 'function') {
            result
              .then(() => {
                if (el.paused) {
                  setIsPlaying(false);
                  onPause?.();
                } else {
                  setIsPlaying(true);
                }
              })
              .catch(() => {
                setIsPlaying(false);
                onPause?.();
              });
          } else if (el.paused) {
            setIsPlaying(false);
            onPause?.();
          } else {
            setIsPlaying(true);
          }
        };

        const alreadyThere = Math.abs(el.currentTime - seekTo) < 0.05 && !el.seeking;
        if (alreadyThere) {
          startPlayback();
          return;
        }

        let started = false;
        const startOnce = () => {
          if (started) return;
          started = true;
          window.clearTimeout(fallbackTimer);
          startPlayback();
        };

        const fallbackTimer = window.setTimeout(startOnce, 750);
        el.addEventListener('seeked', startOnce, { once: true });
        try {
          el.currentTime = seekTo;
          setCurrentTime(seekTo);
        } catch {
          pendingSeekRef.current = seekTo;
          window.clearTimeout(fallbackTimer);
          el.removeEventListener('seeked', startOnce);
        }
      };

      if (!el.currentSrc || el.ended) {
        el.src = audioUrl;
        el.addEventListener('canplay', playAtTarget, { once: true });
      } else {
        playAtTarget();
      }
    },
    [
      audioUrl,
      onPlay,
      onPause,
      persistPlaybackPosition,
      podcastSlug,
      episodeSlug,
      durationSec,
      applyPlaybackSettings,
    ],
  );

  return {
    audioRef: setAudioRef,
    waveformData,
    currentTime,
    isPlaying,
    hasWaveform,
    togglePlay,
    seek,
    seekAndPlay,
    setIsPlaying,
    setCurrentTime,
    volume,
    setVolume,
    playbackRate,
    setPlaybackRate,
    cyclePlaybackRate,
  };
}

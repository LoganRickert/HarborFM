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
  const audioRef = useRef<HTMLAudioElement>(null);
  const restoredPositionRef = useRef(false);
  const wasActiveRef = useRef(isActive);
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
      const el = audioRef.current;
      if (el && !el.paused) {
        el.pause();
        setIsPlaying(false);
      }
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

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

  // Set up audio event listeners
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    
    const onPlayEvt = () => {
      setIsPlaying(true);
      onPlay?.();
    };
    const onPauseEvt = () => {
      setIsPlaying(false);
      savePlaybackPosition();
      onPause?.();
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (persistPlaybackPosition && podcastSlug && episodeSlug) {
        clearEpisodePlaybackPosition(podcastSlug, episodeSlug);
      }
      onPause?.();
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
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
    audioUrl,
    onPlay,
    onPause,
    applyPlaybackSettings,
    restorePlaybackPosition,
    savePlaybackPosition,
    persistPlaybackPosition,
    podcastSlug,
    episodeSlug,
  ]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    applyPlaybackSettings(el);
    restorePlaybackPosition(el);
  }, [applyPlaybackSettings, restorePlaybackPosition, audioUrl, hasWaveform]);

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
      el.currentTime = time;
      setCurrentTime(time);
      savePlaybackPosition();
    }
  }, [savePlaybackPosition]);

  return {
    audioRef,
    waveformData,
    currentTime,
    isPlaying,
    hasWaveform,
    togglePlay,
    seek,
    setIsPlaying,
    setCurrentTime,
    volume,
    setVolume,
    playbackRate,
    setPlaybackRate,
    cyclePlaybackRate,
  };
}

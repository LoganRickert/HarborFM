import { useState, useEffect, useRef, useCallback } from 'react';
import { WaveformData } from '../pages/EpisodeEditor/WaveformCanvas';

interface UseFeedAudioPlayerParams {
  audioUrl: string | null;
  podcastSlug?: string;
  episodeSlug?: string;
  durationSec?: number;
  waveformUrlFn?: (podcastSlug: string, episodeSlug: string) => string;
  privateWaveformUrl?: string | null;
  onPlay?: () => void;
  onPause?: () => void;
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
}: UseFeedAudioPlayerParams) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const hasWaveform = Boolean(waveformData && durationSec > 0);

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
      onPause?.();
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      onPause?.();
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onLoadedMetadata = () => setCurrentTime(el.currentTime);
    
    el.addEventListener('play', onPlayEvt);
    el.addEventListener('pause', onPauseEvt);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    
    return () => {
      el.removeEventListener('play', onPlayEvt);
      el.removeEventListener('pause', onPauseEvt);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [audioUrl, onPlay, onPause]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
      onPause?.();
    } else {
      if (!el.src || el.ended) {
        el.src = audioUrl;
      }
      el.currentTime = currentTime;
      el.play().catch(() => {
        setIsPlaying(false);
        onPause?.();
      });
    }
  }, [isPlaying, audioUrl, currentTime, onPause]);

  const seek = useCallback((time: number) => {
    const el = audioRef.current;
    if (el) {
      el.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

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
  };
}

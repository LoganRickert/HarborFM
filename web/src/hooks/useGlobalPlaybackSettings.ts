import { useEffect, useState } from 'react';

const VOLUME_KEY = 'harborfm_playback_volume';
const RATE_KEY = 'harborfm_playback_rate';
export const PLAYBACK_RATES = [1, 1.5, 2, 2.5] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

type Listener = () => void;
const listeners = new Set<Listener>();

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw == null) return 1;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  } catch {
    return 1;
  }
}

function readStoredPlaybackRate(): PlaybackRate {
  try {
    const raw = localStorage.getItem(RATE_KEY);
    if (raw == null) return 1;
    const n = Number(raw);
    return PLAYBACK_RATES.includes(n as PlaybackRate) ? (n as PlaybackRate) : 1;
  } catch {
    return 1;
  }
}

let volume = readStoredVolume();
let playbackRate = readStoredPlaybackRate();

function emit() {
  listeners.forEach((listener) => listener());
}

export function setGlobalVolume(next: number) {
  volume = Math.max(0, Math.min(1, next));
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // ignore quota / private mode
  }
  emit();
}

export function setGlobalPlaybackRate(next: number) {
  playbackRate = PLAYBACK_RATES.includes(next as PlaybackRate)
    ? (next as PlaybackRate)
    : 1;
  try {
    localStorage.setItem(RATE_KEY, String(playbackRate));
  } catch {
    // ignore
  }
  emit();
}

export function cycleGlobalPlaybackRate() {
  const idx = PLAYBACK_RATES.indexOf(playbackRate);
  setGlobalPlaybackRate(PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length]);
}

export function useGlobalPlaybackSettings() {
  const [, tick] = useState(0);

  useEffect(() => {
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === VOLUME_KEY) {
        volume = readStoredVolume();
        emit();
      }
      if (e.key === RATE_KEY) {
        playbackRate = readStoredPlaybackRate();
        emit();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return {
    volume,
    setVolume: setGlobalVolume,
    playbackRate,
    setPlaybackRate: setGlobalPlaybackRate,
    cyclePlaybackRate: cycleGlobalPlaybackRate,
  };
}

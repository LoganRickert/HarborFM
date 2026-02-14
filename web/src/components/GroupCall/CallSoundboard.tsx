import { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Square } from 'lucide-react';
import { listLibrary, libraryStreamUrl, type LibraryAsset } from '../../api/library';
import styles from './CallSoundboard.module.css';

export interface CallSoundboardProps {
  connectSoundboard: (el: HTMLAudioElement | null) => void;
  disabled?: boolean;
}

const MAX_SOUNDBOARD_ITEMS = 8;

export function CallSoundboard({ connectSoundboard, disabled }: CallSoundboardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: () => listLibrary(),
  });
  const assets = (data?.assets ?? []).slice(0, MAX_SOUNDBOARD_ITEMS);

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

  function handlePlay(asset: LibraryAsset) {
    if (disabled) return;
    if (playingId === asset.id) {
      if (audioRef.current) {
        audioRef.current.pause();
        connectSoundboard(null);
        audioRef.current = null;
      }
      setPlayingId(null);
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
    audio.play().catch(() => {
      connectSoundboard(null);
      audioRef.current = null;
      setPlayingId(null);
    });
    audio.onended = () => {
      connectSoundboard(null);
      audioRef.current = null;
      setPlayingId(null);
    };
    connectSoundboard(audio);
  }

  return (
    <div className={styles.soundboard}>
      <span className={styles.soundboardLabel}>Soundboard</span>
      <div className={styles.soundboardGrid}>
        {assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className={playingId === asset.id ? styles.soundboardBtnActive : styles.soundboardBtn}
            onClick={() => handlePlay(asset)}
            disabled={disabled}
            title={asset.name}
            aria-label={playingId === asset.id ? `Stop ${asset.name}` : `Play ${asset.name}`}
          >
            {playingId === asset.id ? (
              <Square size={14} />
            ) : (
              <Play size={14} />
            )}
            <span className={styles.soundboardBtnLabel}>{asset.name}</span>
          </button>
        ))}
        {assets.length === 0 && (
          <span className={styles.soundboardEmpty}>No library items</span>
        )}
      </div>
    </div>
  );
}

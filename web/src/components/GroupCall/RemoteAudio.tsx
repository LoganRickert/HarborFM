import { useEffect, useRef, useState } from 'react';
import styles from './RemoteAudio.module.css';

/** Renders an audio element for a remote MediaStreamTrack with fallback for autoplay policy. */
export function RemoteAudio({ track }: { track: MediaStreamTrack }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [needsClick, setNeedsClick] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track) return;
    el.srcObject = new MediaStream([track]);
    el.volume = 1;
    el.play()
      .then(() => setNeedsClick(false))
      .catch(() => setNeedsClick(true));
  }, [track]);

  const handleClick = () => {
    audioRef.current?.play()
      .then(() => setNeedsClick(false))
      .catch(() => {});
  };

  return (
    <>
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}
        aria-hidden
      />
      {needsClick && (
        <button
          type="button"
          onClick={handleClick}
          className={styles.enableAudioBtn}
        >
          Click to enable audio
        </button>
      )}
    </>
  );
}

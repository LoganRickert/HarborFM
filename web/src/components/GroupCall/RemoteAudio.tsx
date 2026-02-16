import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAudioUnlock } from './AudioUnlockContext';
import styles from './RemoteAudio.module.css';

export function AudioUnlockBanner() {
  const ctx = useAudioUnlock();
  if (!ctx || !ctx.hasAnyNeedingUnlock) return null;
  return (
    <button
      type="button"
      onClick={ctx.triggerUnlock}
      className={styles.enableAudioBtn}
    >
      Click to enable audio
    </button>
  );
}

const PLAY_RETRY_DELAY_MS = 400;

/** Renders an audio element for a remote MediaStreamTrack with fallback for autoplay policy. */
export function RemoteAudio({ track, volume = 1 }: { track: MediaStreamTrack; volume?: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [needsClick, setNeedsClick] = useState(false);
  const id = useId();
  const unlockContext = useAudioUnlock();

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track) return;
    el.srcObject = new MediaStream([track]);

    const attemptPlay = (): Promise<void> =>
      el.play().then(() => setNeedsClick(false));

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    attemptPlay().catch(() => {
      timeoutId = setTimeout(() => {
        attemptPlay().catch(() => setNeedsClick(true));
      }, PLAY_RETRY_DELAY_MS);
    });

    return () => {
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [track]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);

  const retryPlay = useCallback(() => {
    audioRef.current?.play()
      .then(() => setNeedsClick(false))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!unlockContext) return;
    const unregister = unlockContext.register(id, retryPlay);
    return unregister;
  }, [unlockContext, id, retryPlay]);

  useEffect(() => {
    if (!unlockContext) return;
    unlockContext.setNeedsUnlock(id, needsClick);
  }, [unlockContext, id, needsClick]);

  if (unlockContext) {
    return (
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}
        aria-hidden
      />
    );
  }

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
          onClick={retryPlay}
          className={styles.enableAudioBtn}
        >
          Click to enable audio
        </button>
      )}
    </>
  );
}

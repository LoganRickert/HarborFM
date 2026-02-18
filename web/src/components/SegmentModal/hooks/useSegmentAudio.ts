import { useEffect, useRef, RefObject } from 'react';

export function useSegmentAudio(
  audioRef: RefObject<HTMLAudioElement | null>,
  trimRangesForSkip: Array<[number, number]>,
  setCurrentTime: (t: number) => void,
  setIsPlaying: (v: boolean) => void,
  isEditTabVisible?: boolean
) {
  const trimRangesRef = useRef(trimRangesForSkip);
  trimRangesRef.current = trimRangesForSkip;

  useEffect(() => {
    let innerCleanup: (() => void) | undefined;
    // Run after paint so audio element exists when Edit tab is shown
    const id = requestAnimationFrame(() => {
      const el = audioRef.current;
      if (!el) return;
      const audioEl: HTMLAudioElement = el;
      const onPlay = () => setIsPlaying(true);
      const onPause = () => setIsPlaying(false);
      const onEnded = () => {
        setIsPlaying(false);
        audioEl.currentTime = 0;
        setCurrentTime(0);
      };
      const onTimeUpdate = () => {
        const t = audioEl.currentTime;
        setCurrentTime(t);
        if (trimRangesForSkip.length > 0) {
          for (const [start, end] of trimRangesForSkip) {
            if (t >= start && t < end) {
              audioEl.currentTime = end;
              setCurrentTime(end);
              break;
            }
          }
        }
      };
      const onLoadedMetadata = () => setCurrentTime(audioEl.currentTime);
      audioEl.addEventListener('play', onPlay);
      audioEl.addEventListener('pause', onPause);
      audioEl.addEventListener('ended', onEnded);
      audioEl.addEventListener('timeupdate', onTimeUpdate);
      audioEl.addEventListener('loadedmetadata', onLoadedMetadata);

      let rafId: number;
      function tick() {
        if (!audioEl.paused) {
          const t = audioEl.currentTime;
          setCurrentTime(t);
          const ranges = trimRangesRef.current;
          if (ranges.length > 0) {
            for (const [start, end] of ranges) {
              if (t >= start && t < end) {
                audioEl.currentTime = end;
                setCurrentTime(end);
                break;
              }
            }
          }
        }
        rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);

      innerCleanup = () => {
        cancelAnimationFrame(rafId);
        audioEl.removeEventListener('play', onPlay);
        audioEl.removeEventListener('pause', onPause);
        audioEl.removeEventListener('ended', onEnded);
        audioEl.removeEventListener('timeupdate', onTimeUpdate);
        audioEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      };
    });
    return () => {
      cancelAnimationFrame(id);
      innerCleanup?.();
    };
  }, [audioRef, trimRangesForSkip, setCurrentTime, setIsPlaying, isEditTabVisible]);
}

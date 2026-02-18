import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  segmentStreamUrl,
  getSegmentTranscript,
  generateSegmentTranscript,
  deleteSegmentTranscript,
  updateSegmentTranscript,
} from '../../../api/segments';
import { parseSrt, parseSrtTimeToSeconds, formatSrtTimeFromSeconds } from '../utils/srt';

export function useSegmentTranscript(
  episodeId: string,
  segmentId: string,
  segmentAudioPath?: string | null,
  onDeleteEntry?: (entryIndex: number) => void
) {
  const queryClient = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [playingEntryIndex, setPlayingEntryIndex] = useState<number | null>(null);
  const transcriptAudioRef = useRef<HTMLAudioElement>(null);
  const timeUpdateHandlerRef = useRef<(() => void) | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (entryIndex?: number) => deleteSegmentTranscript(episodeId, segmentId, entryIndex),
    onSuccess: (data) => {
      if (data.text !== undefined) {
        setText(data.text);
      } else {
        setText(null);
        setNotFound(true);
      }
      queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
    },
  });

  useEffect(() => {
    const el = transcriptAudioRef.current;
    setLoading(true);
    setNotFound(false);
    setGenerateError(null);
    setText(null);
    setPlayingEntryIndex(null);
    getSegmentTranscript(episodeId, segmentId)
      .then((r) => {
        setText(r.text);
        setNotFound(false);
      })
      .catch((err) => {
        if (err?.message === 'Transcript not found') setNotFound(true);
        else setGenerateError(err?.message ?? 'Failed to load transcript');
      })
      .finally(() => setLoading(false));
    return () => {
      if (el) {
        el.pause();
        el.src = '';
        if (timeUpdateHandlerRef.current) {
          el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
          timeUpdateHandlerRef.current = null;
        }
      }
    };
  }, [episodeId, segmentId]);

  function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    generateSegmentTranscript(episodeId, segmentId, true)
      .then((r) => {
        setText(r.text);
        setNotFound(false);
      })
      .catch((err) => setGenerateError(err?.message ?? 'Failed to generate transcript'))
      .finally(() => setGenerating(false));
  }

  function handleDeleteEntry(entryIndex: number) {
    if (onDeleteEntry) {
      onDeleteEntry(entryIndex);
    } else {
      deleteMutation.mutate(entryIndex);
    }
  }

  const srtEntries = text && text.includes('-->') ? parseSrt(text) : null;

  function handlePlayEntry(index: number, startTime: string, endTime: string) {
    const el = transcriptAudioRef.current;
    if (!el) return;
    const startSec = parseSrtTimeToSeconds(startTime);
    const endSec = parseSrtTimeToSeconds(endTime);
    if (playingEntryIndex === index) {
      el.pause();
      setPlayingEntryIndex(null);
      if (timeUpdateHandlerRef.current) {
        el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
        timeUpdateHandlerRef.current = null;
      }
    } else {
      if (playingEntryIndex !== null) {
        el.pause();
        if (timeUpdateHandlerRef.current) {
          el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
          timeUpdateHandlerRef.current = null;
        }
      }
      setPlayingEntryIndex(index);
      const onTimeUpdate = () => {
        if (el.currentTime >= endSec) {
          el.pause();
          setPlayingEntryIndex(null);
          if (timeUpdateHandlerRef.current) {
            el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
            timeUpdateHandlerRef.current = null;
          }
        }
      };
      timeUpdateHandlerRef.current = onTimeUpdate;
      el.addEventListener('timeupdate', onTimeUpdate);
      el.src = segmentStreamUrl(episodeId, segmentId, segmentAudioPath);
      const cleanup = () => {
        if (timeUpdateHandlerRef.current) {
          el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
          timeUpdateHandlerRef.current = null;
        }
        setPlayingEntryIndex(null);
      };
      const startPlayback = () => {
        el.play().catch(cleanup);
      };
      const isSafari = /^((?!chrome|android).)*safari|iPhone|iPad|Macintosh/i.test(navigator.userAgent) || (navigator as { vendor?: string }).vendor?.includes('Apple');
      const trySeekThenPlay = () => {
        let targetTime = startSec;
        if (el.seekable.length > 0) {
          const maxSeekable = el.seekable.end(0);
          targetTime = Math.min(startSec, maxSeekable);
        }
        if (isSafari) {
          const savedVolume = el.volume;
          el.volume = 0;
          el.play().catch(() => {
            el.volume = savedVolume;
            cleanup();
          });
          const onPlaying = () => {
            el.removeEventListener('playing', onPlaying);
            el.currentTime = targetTime;
            el.volume = savedVolume;
          };
          el.addEventListener('playing', onPlaying, { once: true });
        } else {
          let seekedFired = false;
          const fallback = setTimeout(() => {
            if (!seekedFired && el.paused) startPlayback();
          }, 800);
          const onSeeked = () => {
            seekedFired = true;
            clearTimeout(fallback);
            el.removeEventListener('seeked', onSeeked);
            startPlayback();
          };
          el.addEventListener('seeked', onSeeked, { once: true });
          el.currentTime = targetTime;
        }
      };
      const onReady = () => {
        el.removeEventListener('loadeddata', onReady);
        el.removeEventListener('canplay', onReady);
        trySeekThenPlay();
      };
      el.addEventListener('loadeddata', onReady);
      el.addEventListener('canplay', onReady);
      if (el.readyState >= 2) {
        onReady();
      }
    }
  }

  useEffect(() => {
    const el = transcriptAudioRef.current;
    if (!el) return;
    const onPause = () => {
      if (el.paused && playingEntryIndex !== null) {
        setPlayingEntryIndex(null);
        if (timeUpdateHandlerRef.current) {
          el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
          timeUpdateHandlerRef.current = null;
        }
      }
    };
    el.addEventListener('pause', onPause);
    return () => el.removeEventListener('pause', onPause);
  }, [playingEntryIndex]);

  function adjustTranscriptTime(entryIndex: number, isStart: boolean, adjustMs: number) {
    if (!srtEntries) return;
    const entry = srtEntries[entryIndex];
    if (!entry) return;

    const currentTime = isStart ? entry.start : entry.end;
    const currentSeconds = parseSrtTimeToSeconds(currentTime);
    const newSeconds = Math.max(0, currentSeconds + adjustMs / 1000);
    const newTime = formatSrtTimeFromSeconds(newSeconds);

    const updatedEntries = [...srtEntries];
    if (isStart) {
      updatedEntries[entryIndex] = { ...entry, start: newTime };
    } else {
      updatedEntries[entryIndex] = { ...entry, end: newTime };
    }

    const updatedSrt = updatedEntries
      .map((e, i) => `${i + 1}\n${e.start} --> ${e.end}\n${e.text}\n`)
      .join('\n');

    const prevText = text;
    updateSegmentTranscript(episodeId, segmentId, updatedSrt)
      .then(() => setText(updatedSrt))
      .catch((err) => {
        console.error('Failed to update transcript:', err);
        setText(prevText ?? '');
      });
  }

  return {
    text,
    setText,
    loading,
    notFound,
    generateError,
    generating,
    srtEntries,
    playingEntryIndex,
    transcriptAudioRef,
    handleGenerate,
    handleDeleteEntry,
    handlePlayEntry,
    adjustTranscriptTime,
    deleteMutationPending: deleteMutation.isPending,
  };
}

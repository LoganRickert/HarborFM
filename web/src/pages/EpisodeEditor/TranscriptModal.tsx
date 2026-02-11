import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  segmentStreamUrl,
  getSegmentTranscript,
  generateSegmentTranscript,
  deleteSegmentTranscript,
  updateSegmentTranscript,
  trimSegmentAudio,
  removeSilenceFromSegment,
  applyNoiseSuppressionToSegment,
} from '../../api/segments';
import { getLlmAvailable, askLlm } from '../../api/llm';
import { Play, Pause, FileText, Trash2, Plus, Minus } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import styles from '../EpisodeEditor.module.css';

export function TranscriptModal({
  episodeId,
  segmentId,
  segmentName,
  segmentDuration,
  segmentAudioPath,
  asrAvailable,
  onClose,
  onDeleteEntry,
}: {
  episodeId: string;
  segmentId: string;
  segmentName: string;
  segmentDuration: number;
  segmentAudioPath?: string | null;
  asrAvailable: boolean;
  onClose: () => void;
  onDeleteEntry?: (entryIndex: number) => void;
}) {
  function isRateLimitMessage(msg: string | null): boolean {
    return (msg || '').toLowerCase().includes('too many requests');
  }

  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState<'view' | 'ask' | 'edit'>('view');
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');
  const [trimming, setTrimming] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [previewingStart, setPreviewingStart] = useState(false);
  const [previewingEnd, setPreviewingEnd] = useState(false);
  const [trimConfirmOpen, setTrimConfirmOpen] = useState(false);
  const [pendingTrimAction, setPendingTrimAction] = useState<{ isStart: boolean; timeSec: number } | null>(null);
  const [removingSilence, setRemovingSilence] = useState(false);
  const [removeSilenceConfirmOpen, setRemoveSilenceConfirmOpen] = useState(false);
  const [applyingNoiseSuppression, setApplyingNoiseSuppression] = useState(false);
  const [noiseSuppressionConfirmOpen, setNoiseSuppressionConfirmOpen] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const previewTimeHandlerRef = useRef<(() => void) | null>(null);
  const [askQuestion, setAskQuestion] = useState('');
  const [askResponse, setAskResponse] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [playingEntryIndex, setPlayingEntryIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timeUpdateHandlerRef = useRef<(() => void) | null>(null);
  const queryClient = useQueryClient();

  const { data: llmData } = useQuery({
    queryKey: ['settings', 'llm-available'],
    queryFn: () => getLlmAvailable(),
  });
  const llmAvailable = llmData?.available ?? false;

  const askMutation = useMutation({
    mutationFn: ({ transcript, question }: { transcript: string; question: string }) => askLlm(transcript, question),
    onSuccess: (data) => {
      setAskResponse(data.response);
      setAskError(null);
    },
    onError: (err) => {
      setAskResponse(null);
      setAskError(err instanceof Error ? err.message : 'Failed to get response');
    },
  });

  const deleteTranscriptMutation = useMutation({
    mutationFn: (entryIndex?: number) => deleteSegmentTranscript(episodeId, segmentId, entryIndex),
    onSuccess: (data) => {
      if (data.text !== undefined) {
        // Entry was deleted, update transcript text
        setText(data.text);
      } else {
        // Entire transcript was deleted
        setText(null);
        setNotFound(true);
      }
      queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
    },
  });

  function handleDeleteTranscriptEntry(entryIndex: number) {
    if (onDeleteEntry) {
      onDeleteEntry(entryIndex);
    } else {
      deleteTranscriptMutation.mutate(entryIndex);
    }
  }

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setGenerateError(null);
    setText(null);
    setMode('view');
    setAskQuestion('');
    setAskResponse(null);
    setAskError(null);
    setPlayingEntryIndex(null);
    setTrimStart('');
    setTrimEnd('');
    setTrimError(null);
    setPreviewingStart(false);
    setPreviewingEnd(false);
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.src = '';
      if (timeUpdateHandlerRef.current) {
        el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
        timeUpdateHandlerRef.current = null;
      }
    }
    const previewEl = previewAudioRef.current;
    const previewHandler = previewTimeHandlerRef.current;
    if (previewEl) {
      previewEl.pause();
      previewEl.src = '';
      if (previewHandler) {
        previewEl.removeEventListener('timeupdate', previewHandler);
        previewTimeHandlerRef.current = null;
      }
    }
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
      // Cleanup on unmount or segment change (use captured ref values)
      if (previewEl) {
        previewEl.pause();
        previewEl.src = '';
        if (previewHandler) {
          previewEl.removeEventListener('timeupdate', previewHandler);
          previewTimeHandlerRef.current = null;
        }
      }
    };
  }, [episodeId, segmentId]);

  useEffect(() => {
    // When switching to edit mode from ask/view, reset form and stop playback
    if (mode === 'edit') {
      // Stop any playing audio
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.src = '';
        if (timeUpdateHandlerRef.current) {
          el.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
          timeUpdateHandlerRef.current = null;
        }
      }
      // Stop preview audio
      const previewEl = previewAudioRef.current;
      if (previewEl) {
        previewEl.pause();
        previewEl.src = '';
        if (previewTimeHandlerRef.current) {
          previewEl.removeEventListener('timeupdate', previewTimeHandlerRef.current);
          previewTimeHandlerRef.current = null;
        }
      }
      // Reset form and playback state
      setTrimStart('');
      setTrimEnd('');
      setTrimError(null);
      setPreviewingStart(false);
      setPreviewingEnd(false);
      setPlayingEntryIndex(null);
    }
  }, [mode]);

  function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    generateSegmentTranscript(episodeId, segmentId, true) // true = regenerate even if transcript exists
      .then((r) => {
        setText(r.text);
        setNotFound(false);
      })
      .catch((err) => setGenerateError(err?.message ?? 'Failed to generate transcript'))
      .finally(() => setGenerating(false));
  }

  function extractTextFromSrt(srtText: string): string {
    if (!srtText || !srtText.includes('-->')) {
      // Not SRT format, return as-is
      return srtText;
    }
    const entries = parseSrt(srtText);
    return entries.map((entry) => entry.text).join(' ');
  }

  function handleAskSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = askQuestion.trim();
    if (!q) return;
    const transcriptText = text ? extractTextFromSrt(text) : '';
    askMutation.mutate({ transcript: transcriptText, question: q });
  }

  function parseSrt(srtText: string): Array<{ start: string; end: string; text: string }> {
    const entries: Array<{ start: string; end: string; text: string }> = [];
    const blocks = srtText.split(/\n\s*\n/).filter((b) => b.trim());
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 3) continue;
      const timeLine = lines[1]?.trim();
      if (!timeLine || !timeLine.includes('-->')) continue;
      const [start, end] = timeLine.split('-->').map((s) => s.trim());
      const text = lines.slice(2).join('\n').trim();
      if (start && end && text) {
        entries.push({ start, end, text });
      }
    }
    return entries;
  }

  function formatSrtTime(timeStr: string): string {
    // Keep full precision including milliseconds
    // Format: HH:MM:SS,mmm -> show as MM:SS.mmm or HH:MM:SS.mmm if hours > 0
    const normalized = timeStr.replace(',', '.');
    const parts = normalized.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0] || '0', 10);
      const minutes = parts[1] || '00';
      const seconds = parts[2] || '00.000';
      if (hours === 0) {
        return `${minutes}:${seconds}`;
      }
      return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
    }
    return timeStr;
  }

  function parseSrtTimeToSeconds(timeStr: string): number {
    const normalized = timeStr.replace(',', '.');
    const parts = normalized.split(':');
    if (parts.length !== 3) return 0;
    const hours = parseFloat(parts[0] || '0');
    const minutes = parseFloat(parts[1] || '0');
    const seconds = parseFloat(parts[2] || '0');
    return hours * 3600 + minutes * 60 + seconds;
  }

  function formatSrtTimeFromSeconds(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  }

  function adjustTranscriptTime(entryIndex: number, isStart: boolean, adjustMs: number) {
    if (!srtEntries) return;
    const entry = srtEntries[entryIndex];
    if (!entry) return;
    
    const currentTime = isStart ? entry.start : entry.end;
    const currentSeconds = parseSrtTimeToSeconds(currentTime);
    const newSeconds = Math.max(0, currentSeconds + adjustMs / 1000);
    const newTime = formatSrtTimeFromSeconds(newSeconds);
    
    // Update local state immediately for responsive UI
    const updatedEntries = [...srtEntries];
    if (isStart) {
      updatedEntries[entryIndex] = { ...entry, start: newTime };
    } else {
      updatedEntries[entryIndex] = { ...entry, end: newTime };
    }
    
    // Rebuild SRT text
    const updatedSrt = updatedEntries
      .map((e, i) => {
        return `${i + 1}\n${e.start} --> ${e.end}\n${e.text}\n`;
      })
      .join('\n');
    
    // Update transcript on server
    updateSegmentTranscript(episodeId, segmentId, updatedSrt)
      .then(() => {
        setText(updatedSrt);
      })
      .catch((err) => {
        console.error('Failed to update transcript:', err);
        // Revert on error
        setText(text);
      });
  }

  function handleTrimSubmit(e: React.FormEvent) {
    e.preventDefault();
  }

  function handlePreview(isStart: boolean) {
    const el = previewAudioRef.current;
    if (!el) return;
    
    const timeValue = isStart ? trimStart : trimEnd;
    const timeSec = parseFloat(timeValue);
    if (Number.isNaN(timeSec) || timeSec < 0) {
      setTrimError('Invalid time value');
      return;
    }
    
    const totalDurationSec = segmentDuration;
    
    if (isStart) {
      // Preview trim start: play from trimStart for 10 seconds
      if (previewingStart) {
        el.pause();
        setPreviewingStart(false);
        if (previewTimeHandlerRef.current) {
          el.removeEventListener('timeupdate', previewTimeHandlerRef.current);
          previewTimeHandlerRef.current = null;
        }
      } else {
        // Stop any other preview
        if (previewingEnd) {
          el.pause();
          setPreviewingEnd(false);
        }
        if (previewTimeHandlerRef.current) {
          el.removeEventListener('timeupdate', previewTimeHandlerRef.current);
        }
        
        setPreviewingStart(true);
        setPreviewingEnd(false);
        setTrimError(null);
        
        const onTimeUpdate = () => {
          const elapsed = el.currentTime - timeSec;
          if (elapsed >= 10 || el.currentTime >= totalDurationSec) {
            el.pause();
            setPreviewingStart(false);
            el.removeEventListener('timeupdate', onTimeUpdate);
            previewTimeHandlerRef.current = null;
          }
        };
        previewTimeHandlerRef.current = onTimeUpdate;
        
        // Reset and load new source
        el.pause();
        el.currentTime = 0;
        const audioUrl = segmentStreamUrl(episodeId, segmentId, segmentAudioPath);
        el.src = audioUrl;
        el.load(); // Force reload
        
        const onSeeked = () => {
          // Verify we actually seeked to the right position (within 0.5 seconds)
          const actualTime = el.currentTime;
          if (Math.abs(actualTime - timeSec) > 0.5) {
            // Seek didn't work, try again
            console.warn(`Seek to ${timeSec} failed, actual time is ${actualTime}, retrying...`);
            setTimeout(() => {
              el.currentTime = timeSec;
            }, 100);
            return;
          }
          // Now that we've seeked, start playing
          el.addEventListener('timeupdate', onTimeUpdate);
          el.play().catch(() => {
            setPreviewingStart(false);
            el.removeEventListener('timeupdate', onTimeUpdate);
            previewTimeHandlerRef.current = null;
          });
        };
        
        const attemptSeek = () => {
          try {
            // Wait for seekable ranges to be available
            if (el.seekable.length > 0) {
              const maxSeekable = el.seekable.end(0);
              const targetTime = Math.min(timeSec, maxSeekable);
              if (targetTime < el.seekable.start(0)) {
                // Can't seek to this position yet, wait a bit
                setTimeout(attemptSeek, 100);
                return;
              }
              el.currentTime = targetTime;
              // Wait for seek to complete
              el.addEventListener('seeked', onSeeked, { once: true });
            } else {
              // If not seekable yet, try again shortly
              setTimeout(attemptSeek, 100);
            }
          } catch (err) {
            console.error('Failed to seek audio:', err);
            setPreviewingStart(false);
            previewTimeHandlerRef.current = null;
          }
        };
        
        const onCanPlay = () => {
          attemptSeek();
        };
        
        el.addEventListener('canplay', onCanPlay, { once: true });
      }
    } else {
      // Preview trim end: play last 10 seconds before trim end, then stop
      if (previewingEnd) {
        el.pause();
        setPreviewingEnd(false);
        if (previewTimeHandlerRef.current) {
          el.removeEventListener('timeupdate', previewTimeHandlerRef.current);
          previewTimeHandlerRef.current = null;
        }
      } else {
        // Stop any other preview
        if (previewingStart) {
          el.pause();
          setPreviewingStart(false);
        }
        if (previewTimeHandlerRef.current) {
          el.removeEventListener('timeupdate', previewTimeHandlerRef.current);
        }
        
        setPreviewingEnd(true);
        setPreviewingStart(false);
        setTrimError(null);
        
        const endTimeSec = totalDurationSec - timeSec; // trim end is duration to remove from end
        const startTimeSec = Math.max(0, endTimeSec - 10);
        
        const onTimeUpdate = () => {
          if (el.currentTime >= endTimeSec || el.currentTime >= totalDurationSec) {
            el.pause();
            setPreviewingEnd(false);
            el.removeEventListener('timeupdate', onTimeUpdate);
            previewTimeHandlerRef.current = null;
          }
        };
        previewTimeHandlerRef.current = onTimeUpdate;
        
        const onLoadedMetadata = () => {
          el.currentTime = startTimeSec;
          el.addEventListener('timeupdate', onTimeUpdate);
          el.play().catch(() => {
            setPreviewingEnd(false);
            el.removeEventListener('timeupdate', onTimeUpdate);
            previewTimeHandlerRef.current = null;
          });
        };
        
        el.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
        el.src = segmentStreamUrl(episodeId, segmentId, segmentAudioPath);
        if (el.readyState >= 2) {
          onLoadedMetadata();
        }
      }
    }
  }

  function handleTrimClick(isStart: boolean) {
    const timeValue = isStart ? trimStart : trimEnd;
    const timeSec = parseFloat(timeValue);
    if (Number.isNaN(timeSec) || timeSec < 0) {
      setTrimError('Invalid time value');
      return;
    }
    
    // Show confirmation dialog
    setPendingTrimAction({ isStart, timeSec });
    setTrimConfirmOpen(true);
  }

  function handleTrimConfirm() {
    if (!pendingTrimAction) return;
    
    const { isStart, timeSec } = pendingTrimAction;
    setTrimConfirmOpen(false);
    setTrimming(true);
    setTrimError(null);
    
    const totalDurationSec = segmentDuration;
    
    // For trim end, calculate absolute end time (duration - trimEnd)
    const endSec = isStart ? undefined : (totalDurationSec - timeSec);
    
    trimSegmentAudio(episodeId, segmentId, isStart ? timeSec : undefined, endSec)
      .then(() => {
        // Reset form
        setTrimStart('');
        setTrimEnd('');
        // Reload segments
        queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
        // Generate new transcript after trimming
        return generateSegmentTranscript(episodeId, segmentId, true);
      })
      .then((r) => {
        setText(r.text);
        setNotFound(false);
      })
      .catch((err) => {
        setTrimError(err?.message ?? 'Failed to trim audio');
      })
      .finally(() => {
        setTrimming(false);
        setPendingTrimAction(null);
      });
  }

  function handleRemoveSilenceClick() {
    setRemoveSilenceConfirmOpen(true);
  }

  function handleNoiseSuppressionClick() {
    setNoiseSuppressionConfirmOpen(true);
  }

  function handleNoiseSuppressionConfirm() {
    setNoiseSuppressionConfirmOpen(false);
    setApplyingNoiseSuppression(true);
    setTrimError(null);
    applyNoiseSuppressionToSegment(episodeId, segmentId, -45)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
        // Reload transcript display if one exists (audio path changed); no transcript is fine
        return getSegmentTranscript(episodeId, segmentId)
          .then((r) => {
            setText(r.text ?? null);
            setNotFound(r.text == null);
          })
          .catch(() => {
            setText(null);
            setNotFound(true);
          });
      })
      .catch((err) => {
        setTrimError(err?.message ?? 'Failed to apply noise suppression');
      })
      .finally(() => {
        setApplyingNoiseSuppression(false);
      });
  }

  function handleRemoveSilenceConfirm() {
    setRemoveSilenceConfirmOpen(false);
    setRemovingSilence(true);
    setTrimError(null);
    
    removeSilenceFromSegment(episodeId, segmentId, 1.5, -55)
      .then(() => {
        // Reset form
        setTrimStart('');
        setTrimEnd('');
        // Reload segments
        queryClient.invalidateQueries({ queryKey: ['segments', episodeId] });
        // Generate new transcript after removing silence
        return generateSegmentTranscript(episodeId, segmentId, true);
      })
      .then((r) => {
        setText(r.text);
        setNotFound(false);
      })
      .catch((err) => {
        setTrimError(err?.message ?? 'Failed to remove silence');
      })
      .finally(() => {
        setRemovingSilence(false);
      });
  }

  function handlePlayEntry(index: number, startTime: string, endTime: string) {
    const el = audioRef.current;
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
          // Safari often ignores currentTime when set before first play. Workaround: play (muted), then set currentTime on 'playing'.
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
    const el = audioRef.current;
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
    return () => {
      el.removeEventListener('pause', onPause);
    };
  }, [playingEntryIndex]);

  const hasTranscript = !loading && text != null && text.trim() !== '';
  const showTranscriptModeBar = asrAvailable || llmAvailable;
  const srtEntries = text && text.includes('-->') ? parseSrt(text) : null;

  // If ASR isn't configured, default to Edit (since View/regen are not available).
  useEffect(() => {
    if (!asrAvailable && mode === 'view') {
      setMode('edit');
    }
  }, [asrAvailable, mode]);

  // If neither ASR nor LLM is configured, keep mode on Edit (no tab bar).
  useEffect(() => {
    if (!asrAvailable && !llmAvailable && mode !== 'edit') {
      setMode('edit');
    }
  }, [asrAvailable, llmAvailable, mode]);

  // If ask becomes unavailable while on Ask tab (no LLM or no transcript), fall back.
  useEffect(() => {
    if (mode === 'ask' && (!llmAvailable || !hasTranscript)) {
      setMode(asrAvailable ? 'view' : 'edit');
    }
  }, [mode, llmAvailable, asrAvailable, hasTranscript]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={`${styles.dialogContent} ${styles.dialogContentWide}`} aria-describedby={undefined}>
          <Dialog.Title className={styles.dialogTitle}>{segmentName}</Dialog.Title>
          <div className={styles.dialogDescription}>
            {showTranscriptModeBar && (
              <div className={styles.transcriptToggleWrap}>
                <div className={styles.transcriptToggle} role="tablist" aria-label="Transcript mode">
                  {asrAvailable && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'view'}
                      aria-label="View transcript"
                      className={mode === 'view' ? styles.transcriptToggleActive : styles.transcriptToggleBtn}
                      onClick={() => setMode('view')}
                    >
                      View
                    </button>
                  )}
                  {llmAvailable && hasTranscript && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'ask'}
                      aria-label="Ask questions about transcript"
                      className={mode === 'ask' ? styles.transcriptToggleActive : styles.transcriptToggleBtn}
                      onClick={() => setMode('ask')}
                    >
                      Ask
                    </button>
                  )}
                  {asrAvailable && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'edit'}
                      aria-label="Edit transcript"
                      className={mode === 'edit' ? styles.transcriptToggleActive : styles.transcriptToggleBtn}
                      onClick={() => setMode('edit')}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            )}
            {loading && <p>Loading...</p>}
            {!loading && text != null && mode === 'view' && (
              <>
                {srtEntries ? (
                  <>
                    <div className={styles.transcriptCards}>
                      {srtEntries.map((entry, i) => (
                        <div key={i} className={styles.transcriptCard}>
                          <div className={styles.transcriptCardText}>{entry.text}</div>
                          <div className={styles.transcriptCardFooter}>
                            <div className={styles.transcriptCardTimeControls}>
                              <div className={styles.transcriptCardTimeGroup}>
                                <div className={styles.transcriptCardTimeButtons}>
                                  <button
                                    type="button"
                                    className={styles.transcriptCardTimeBtn}
                                    onClick={() => adjustTranscriptTime(i, true, -200)}
                                    title="Subtract 200ms from start"
                                    aria-label={`Subtract 200ms from start time of segment ${i + 1}`}
                                  >
                                    <Minus size={12} aria-hidden />
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.transcriptCardTimeBtn}
                                    onClick={() => adjustTranscriptTime(i, true, 200)}
                                    title="Add 200ms to start"
                                    aria-label={`Add 200ms to start time of segment ${i + 1}`}
                                  >
                                    <Plus size={12} aria-hidden />
                                  </button>
                                </div>
                                <span className={styles.transcriptCardTimeLabel}>Start: {formatSrtTime(entry.start)}</span>
                              </div>
                              <div className={styles.transcriptCardTimeGroup}>
                                <div className={styles.transcriptCardTimeButtons}>
                                  <button
                                    type="button"
                                    className={styles.transcriptCardTimeBtn}
                                    onClick={() => adjustTranscriptTime(i, false, -200)}
                                    title="Subtract 200ms from end"
                                    aria-label={`Subtract 200ms from end time of segment ${i + 1}`}
                                  >
                                    <Minus size={12} aria-hidden />
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.transcriptCardTimeBtn}
                                    onClick={() => adjustTranscriptTime(i, false, 200)}
                                    title="Add 200ms to end"
                                    aria-label={`Add 200ms to end time of segment ${i + 1}`}
                                  >
                                    <Plus size={12} aria-hidden />
                                  </button>
                                </div>
                                <span className={styles.transcriptCardTimeLabel}>End: {formatSrtTime(entry.end)}</span>
                              </div>
                            </div>
                            <div className={styles.transcriptCardFooterActions}>
                              <button
                                type="button"
                                className={styles.transcriptCardBtn}
                                onClick={() => handlePlayEntry(i, entry.start, entry.end)}
                                title={playingEntryIndex === i ? 'Pause' : 'Play'}
                                aria-label={playingEntryIndex === i ? `Pause transcript segment ${i + 1}` : `Play transcript segment ${i + 1}`}
                              >
                                {playingEntryIndex === i ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                              </button>
                              <button
                                type="button"
                                className={styles.transcriptCardBtn}
                                onClick={() => handleDeleteTranscriptEntry(i)}
                                disabled={deleteTranscriptMutation.isPending}
                                title="Delete this segment"
                                aria-label={`Delete transcript segment ${i + 1}`}
                              >
                                <Trash2 size={14} aria-hidden />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <audio ref={audioRef} style={{ display: 'none' }} />
                  </>
                ) : (
                  <pre className={styles.transcriptText}>{text || '(empty)'}</pre>
                )}
                {generateError && (
                  <p className={`${styles.error} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}>
                    {generateError}
                  </p>
                )}
              </>
            )}
            {!loading && text != null && mode === 'ask' && (
              <div className={styles.transcriptAsk}>
                <form onSubmit={handleAskSubmit} className={styles.transcriptAskForm}>
                  <input
                    type="text"
                    className={styles.transcriptAskInput}
                    placeholder="Ask something about this transcript..."
                    value={askQuestion}
                    onChange={(e) => setAskQuestion(e.target.value)}
                    disabled={askMutation.isPending}
                    aria-label="Question"
                  />
                  <button type="submit" className={styles.transcriptAskSubmit} disabled={askMutation.isPending || !askQuestion.trim()} aria-label="Submit question">
                    {askMutation.isPending ? '...' : 'Submit'}
                  </button>
                </form>
                {askError && (
                  <p className={`${styles.error} ${isRateLimitMessage(askError) ? styles.rateLimitError : ''}`}>
                    {askError}
                  </p>
                )}
                {askResponse != null && (
                  <div className={styles.transcriptAskResponse}>
                    {askResponse}
                  </div>
                )}
              </div>
            )}
            {!loading && mode === 'edit' && (
              <div className={styles.transcriptEdit}>
                <form onSubmit={handleTrimSubmit} className={styles.transcriptEditForm}>
                  <div className={styles.transcriptEditGroup}>
                    <label className={styles.transcriptEditLabel}>
                      Trim start (seconds)
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        className={styles.transcriptEditInput}
                        placeholder="0.000"
                        value={trimStart}
                        onChange={(e) => setTrimStart(e.target.value)}
                        disabled={trimming || previewingStart || previewingEnd}
                        aria-label="Trim start time"
                      />
                    </label>
                    <div className={styles.transcriptEditActions}>
                      <button
                        type="button"
                        className={styles.transcriptEditPreviewBtn}
                        onClick={() => handlePreview(true)}
                        disabled={trimming || !trimStart.trim() || previewingEnd}
                        title="Preview 10 seconds from trim start"
                        aria-label={previewingStart ? 'Pause preview' : 'Preview 10 seconds from trim start'}
                      >
                        {previewingStart ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                      </button>
                      <button
                        type="button"
                        className={styles.transcriptEditBtn}
                        onClick={() => handleTrimClick(true)}
                        disabled={trimming || !trimStart.trim() || previewingStart || previewingEnd}
                        aria-label="Trim start of segment"
                      >
                        {trimming ? 'Trimming...' : 'Trim Start'}
                      </button>
                    </div>
                  </div>
                  <div className={styles.transcriptEditGroup}>
                    <label className={styles.transcriptEditLabel}>
                      Trim end (seconds to remove)
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        className={styles.transcriptEditInput}
                        placeholder="0.000"
                        value={trimEnd}
                        onChange={(e) => setTrimEnd(e.target.value)}
                        disabled={trimming || previewingStart || previewingEnd}
                        aria-label="Seconds to trim from end"
                      />
                    </label>
                    <div className={styles.transcriptEditActions}>
                      <button
                        type="button"
                        className={styles.transcriptEditPreviewBtn}
                        onClick={() => handlePreview(false)}
                        disabled={trimming || !trimEnd.trim() || previewingStart}
                        title="Preview last 10 seconds before trim end"
                        aria-label={previewingEnd ? 'Pause preview' : 'Preview last 10 seconds before trim end'}
                      >
                        {previewingEnd ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                      </button>
                      <button
                        type="button"
                        className={styles.transcriptEditBtn}
                        onClick={() => handleTrimClick(false)}
                        disabled={trimming || !trimEnd.trim() || previewingStart || previewingEnd}
                        aria-label="Trim end of segment"
                      >
                        {trimming ? 'Trimming...' : 'Trim End'}
                      </button>
                    </div>
                  </div>
                  {trimError && (
                    <p className={`${styles.error} ${isRateLimitMessage(trimError) ? styles.rateLimitError : ''}`}>
                      {trimError}
                    </p>
                  )}
                  <div className={styles.transcriptEditGroup}>
                    <button
                      type="button"
                      className={styles.transcriptEditBtn}
                      onClick={handleRemoveSilenceClick}
                      disabled={trimming || removingSilence || applyingNoiseSuppression || previewingStart || previewingEnd}
                      style={{ width: '100%', marginTop: '0.5rem' }}
                      aria-label="Remove silence from segment"
                    >
                      {removingSilence ? 'Removing Silence...' : 'Remove Silence'}
                    </button>
                    <button
                      type="button"
                      className={styles.transcriptEditBtn}
                      onClick={handleNoiseSuppressionClick}
                      disabled={trimming || removingSilence || applyingNoiseSuppression || previewingStart || previewingEnd}
                      style={{ width: '100%', marginTop: '0.5rem' }}
                      aria-label="Apply noise suppression to segment"
                    >
                      {applyingNoiseSuppression ? 'Applying...' : 'Noise Suppression'}
                    </button>
                  </div>
                </form>
                <audio ref={previewAudioRef} style={{ display: 'none' }} />
              </div>
            )}
            <Dialog.Root open={trimConfirmOpen} onOpenChange={(open) => {
              if (!open) {
                setTrimConfirmOpen(false);
                setPendingTrimAction(null);
              }
            }}>
              <Dialog.Portal>
                <Dialog.Overlay className={styles.dialogOverlay} />
                <Dialog.Content
                  className={styles.dialogContent}
                  onEscapeKeyDown={(e) => {
                    e.stopPropagation();
                  }}
                  onPointerDownOutside={(e) => {
                    e.preventDefault();
                  }}
                  onInteractOutside={(e) => {
                    e.preventDefault();
                  }}
                >
                  <Dialog.Title className={styles.dialogTitle}>
                    Confirm Trim
                  </Dialog.Title>
                  <Dialog.Description className={styles.dialogDescription}>
                    {pendingTrimAction?.isStart
                      ? `Are you sure you want to trim ${pendingTrimAction.timeSec.toFixed(3)} seconds from the start? This will update the audio file and generate a new transcript.`
                      : `Are you sure you want to trim ${pendingTrimAction?.timeSec.toFixed(3) ?? 0} seconds from the end? This will update the audio file and generate a new transcript.`}
                  </Dialog.Description>
                  <div className={styles.dialogActions}>
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTrimConfirmOpen(false);
                        setPendingTrimAction(null);
                      }}
                      aria-label="Cancel trim operation"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.dialogConfirmRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTrimConfirm();
                      }}
                      disabled={trimming}
                      aria-label="Confirm trim operation"
                    >
                      {trimming ? 'Trimming...' : 'Confirm'}
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <Dialog.Root open={removeSilenceConfirmOpen} onOpenChange={(open) => {
              if (!open) {
                setRemoveSilenceConfirmOpen(false);
              }
            }}>
              <Dialog.Portal>
                <Dialog.Overlay className={styles.dialogOverlay} />
                <Dialog.Content
                  className={styles.dialogContent}
                  onEscapeKeyDown={(e) => {
                    e.stopPropagation();
                  }}
                  onPointerDownOutside={(e) => {
                    e.preventDefault();
                  }}
                  onInteractOutside={(e) => {
                    e.preventDefault();
                  }}
                >
                  <Dialog.Title className={styles.dialogTitle}>
                    Remove Silence
                  </Dialog.Title>
                  <Dialog.Description className={styles.dialogDescription}>
                    Are you sure you want to remove all silence periods longer than 2 seconds? This will update the audio file and generate a new transcript.
                  </Dialog.Description>
                  <div className={styles.dialogActions}>
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRemoveSilenceConfirmOpen(false);
                      }}
                      aria-label="Cancel removing silence"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.dialogConfirmRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveSilenceConfirm();
                      }}
                      disabled={removingSilence}
                      aria-label="Confirm remove silence"
                    >
                      {removingSilence ? 'Removing...' : 'Confirm'}
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <Dialog.Root open={noiseSuppressionConfirmOpen} onOpenChange={(open) => {
              if (!open) {
                setNoiseSuppressionConfirmOpen(false);
              }
            }}>
              <Dialog.Portal>
                <Dialog.Overlay className={styles.dialogOverlay} />
                <Dialog.Content
                  className={styles.dialogContent}
                  onEscapeKeyDown={(e) => {
                    e.stopPropagation();
                  }}
                  onPointerDownOutside={(e) => {
                    e.preventDefault();
                  }}
                  onInteractOutside={(e) => {
                    e.preventDefault();
                  }}
                >
                  <Dialog.Title className={styles.dialogTitle}>
                    Noise Suppression
                  </Dialog.Title>
                  <Dialog.Description className={styles.dialogDescription}>
                    Apply FFT-based noise suppression to reduce background noise? This will update the audio file. Transcript timings are unchanged.
                  </Dialog.Description>
                  <div className={styles.dialogActions}>
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={(e) => {
                        e.stopPropagation();
                        setNoiseSuppressionConfirmOpen(false);
                      }}
                      aria-label="Cancel noise suppression"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.dialogConfirmRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNoiseSuppressionConfirm();
                      }}
                      disabled={applyingNoiseSuppression}
                      aria-label="Confirm noise suppression"
                    >
                      {applyingNoiseSuppression ? 'Applying...' : 'Confirm'}
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            {!loading && notFound && text == null && mode === 'view' && (
              <>
                {asrAvailable && (
                  <button
                    type="button"
                    className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary} ${styles.transcriptGenerateBtn}`}
                    onClick={handleGenerate}
                    disabled={generating}
                    aria-label={generating ? 'Generating transcript' : 'Generate transcript'}
                  >
                    <FileText size={24} strokeWidth={2} aria-hidden />
                    <span>{generating ? 'Generating...' : 'Generate transcript'}</span>
                  </button>
                )}
                {generateError && (
                  <p className={`${styles.error} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}>
                    {generateError}
                  </p>
                )}
              </>
            )}
            {!loading && !notFound && text == null && generateError && (
              <p className={`${styles.error} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}>
                {generateError}
              </p>
            )}
          </div>
          <div className={styles.dialogActions}>
            {!loading && text != null && mode === 'view' && (
              <button
                type="button"
                className={styles.cancel}
                onClick={handleGenerate}
                disabled={generating || !asrAvailable}
                style={{ marginRight: 'auto' }}
                aria-label="Generate new transcript"
              >
                {generating ? 'Generating...' : 'New Transcript'}
              </button>
            )}
            <Dialog.Close asChild>
              <button type="button" className={styles.cancel} aria-label="Close transcript">Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}


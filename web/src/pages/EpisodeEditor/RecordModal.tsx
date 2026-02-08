import { useState, useEffect, useRef } from 'react';
import { RotateCcw, PlusCircle, Play, Pause } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { formatDuration } from './utils';
import styles from '../EpisodeEditor.module.css';

export interface RecordModalProps {
  onClose: () => void;
  onAdd: (file: File, name?: string | null) => void;
  isAdding: boolean;
  error?: string;
}

export function RecordModal({ onClose, onAdd, isAdding, error }: RecordModalProps) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isPlaybackPlaying, setIsPlaybackPlaying] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasSeenAudio, setHasSeenAudio] = useState(false);
  const hasSeenAudioRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement>(null);
  const recordProgressTrackRef = useRef<HTMLDivElement>(null);
  const recordCardRef = useRef<HTMLDivElement>(null);
  const recordButtonRef = useRef<HTMLButtonElement>(null);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelAnimationRef = useRef<number | null>(null);

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (levelAnimationRef.current != null) cancelAnimationFrame(levelAnimationRef.current);
      if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close();
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!recording && !blob && recordButtonRef.current) recordButtonRef.current.focus();
      else if (recording && stopButtonRef.current) stopButtonRef.current.focus();
      else if (blob && cancelButtonRef.current) cancelButtonRef.current.focus();
    }, 0);
    return () => clearTimeout(timeout);
  }, [recording, blob]);

  useEffect(() => {
    const card = recordCardRef.current;
    if (!card) return;
    function handleKeyDown(e: KeyboardEvent) {
      const c = recordCardRef.current;
      if (!c) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCloseConfirm(true);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        c.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => {
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey) {
        if (active === first || !c.contains(active)) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (active === last || !c.contains(active)) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [recording, blob]);

  useEffect(() => {
    if (!blob) {
      setPlaybackUrl(null);
      setPlaybackCurrentTime(0);
      setPlaybackDuration(0);
      setIsPlaybackPlaying(false);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPlaybackUrl(url);
    setPlaybackDuration(seconds);
    setPlaybackCurrentTime(0);
    return () => URL.revokeObjectURL(url);
  }, [blob, seconds]);

  useEffect(() => {
    const el = playbackAudioRef.current;
    if (!el || !playbackUrl) return;
    const onTimeUpdate = () => setPlaybackCurrentTime(Number.isFinite(el.currentTime) ? el.currentTime : 0);
    const onLoadedMetadata = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setPlaybackDuration(d);
    };
    const onPlay = () => setIsPlaybackPlaying(true);
    const onPause = () => setIsPlaybackPlaying(false);
    const onEnded = () => {
      setIsPlaybackPlaying(false);
      setPlaybackCurrentTime(Number.isFinite(el.currentTime) ? el.currentTime : 0);
    };
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [playbackUrl]);

  function startLevelMeter(stream: MediaStream) {
    // Safari uses webkitAudioContext; must be created in user gesture (we're in Record click)
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    audioContextRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    analyser.minDecibels = -60;
    analyser.maxDecibels = -10;
    source.connect(analyser);
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    ctx.resume().catch(() => {});

    const AUDIO_THRESHOLD = 5;

    function tick() {
      const ctxNow = audioContextRef.current;
      const an = analyserRef.current;
      if (ctxNow && an && ctxNow.state === 'running') {
        an.getByteFrequencyData(data);
        let max = 0;
        for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
        setAudioLevel(Math.min(100, Math.round((max / 255) * 100)));

        if (max >= AUDIO_THRESHOLD && !hasSeenAudioRef.current) {
          hasSeenAudioRef.current = true;
          setHasSeenAudio(true);
        }
      }
      levelAnimationRef.current = requestAnimationFrame(tick);
    }

    levelAnimationRef.current = requestAnimationFrame(tick);
  }

  function stopLevelMeter() {
    if (levelAnimationRef.current != null) {
      cancelAnimationFrame(levelAnimationRef.current);
      levelAnimationRef.current = null;
    }
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
    hasSeenAudioRef.current = false;
    setHasSeenAudio(false);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      startLevelMeter(stream);
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopLevelMeter();
        const b = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setBlob(b);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      recorder.start(1000);
      setRecording(true);
      setSeconds(0);
      setBlob(null);
      hasSeenAudioRef.current = false;
      setHasSeenAudio(false);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      try {
        if (
          'wakeLock' in navigator &&
          typeof (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request === 'function'
        ) {
          wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen');
        }
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error(err);
      alert('Could not access microphone.');
    }
  }

  function stopRecording() {
    if (recorderRef.current && recording) {
      recorderRef.current.stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      releaseWakeLock();
      setRecording(false);
    }
  }

  function handleAdd() {
    if (!blob) return;
    const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `recording.${ext}`, { type: blob.type });
    onAdd(file, sectionName.trim() || null);
  }

  function togglePlayback() {
    const el = playbackAudioRef.current;
    if (!el) return;
    if (isPlaybackPlaying) el.pause();
    else el.play().catch(() => {});
  }

  function handleRecordProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = playbackAudioRef.current;
    const track = recordProgressTrackRef.current;
    if (!el || !track || playbackDuration <= 0) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = frac * playbackDuration;
    setPlaybackCurrentTime(frac * playbackDuration);
  }

  const recordProgress = playbackDuration > 0 ? Math.min(1, playbackCurrentTime / playbackDuration) : 0;

  function requestClose() {
    setShowCloseConfirm(true);
  }

  function confirmClose() {
    setShowCloseConfirm(false);
    onClose();
  }

  return (
    <div className={styles.recordOverlay} onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div ref={recordCardRef} className={styles.recordCard} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="record-title">
        <h3 id="record-title" className={styles.recordTitle}>
          Record a section
        </h3>
        <p className={styles.recordSub}>Use your microphone. When done, stop and add to the episode.</p>
        {!recording && !blob && (
          <button ref={recordButtonRef} type="button" className={`${styles.recordBtn} ${styles.record}`} onClick={startRecording} aria-label="Start recording">
            ●
          </button>
        )}
        {recording && (
          <>
            <div className={styles.recordTime}>{formatDuration(seconds)}</div>
            <div className={styles.recordLevelWrap} aria-live="polite" aria-label="Microphone level">
              <div className={styles.recordLevelBar} role="presentation">
                <div className={styles.recordLevelFill} style={{ width: `${audioLevel}%` }} />
              </div>
              {!hasSeenAudio && (
                <p className={styles.recordLevelHint}>
                  {audioLevel < 2 ? 'No input — check if microphone is muted' : 'Microphone active'}
                </p>
              )}
            </div>
            <button ref={stopButtonRef} type="button" className={`${styles.recordBtn} ${styles.stop}`} onClick={stopRecording} aria-label="Stop recording">
              ■
            </button>
          </>
        )}
        {isMobile && !blob && (
          <p className={styles.recordMobileNote}>Please do not navigate away from this page or the recording may be stopped or lost.</p>
        )}
        {blob && !recording && (
          <>
            <label className={styles.recordLabel}>
              Section name (optional)
              <input
                type="text"
                className={styles.recordNameInput}
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                placeholder="e.g. Intro, Ad read"
              />
            </label>
            {playbackUrl && (
              <div className={styles.recordPlaybackWrap}>
                <audio ref={playbackAudioRef} key={playbackUrl} src={playbackUrl} preload="metadata" style={{ display: 'none' }} />
                <div className={styles.recordPlaybackRow}>
                  <button type="button" className={styles.segmentBtn} onClick={togglePlayback} title={isPlaybackPlaying ? 'Pause' : 'Play'} aria-label={isPlaybackPlaying ? 'Pause playback' : 'Play playback'}>
                    {isPlaybackPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
                  </button>
                  <div className={styles.recordPlaybackInfo}>
                    <div className={styles.segmentMeta}>
                      {formatDuration(Math.floor(playbackCurrentTime))} / {formatDuration(Math.floor(playbackDuration))}
                    </div>
                    <div
                      ref={recordProgressTrackRef}
                      className={styles.segmentProgressTrack}
                      onClick={handleRecordProgressClick}
                      role="progressbar"
                      aria-valuenow={Math.round(playbackCurrentTime)}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(playbackDuration)}
                      aria-label="Playback position"
                    >
                      <div className={styles.segmentProgressFill} style={{ width: `${recordProgress * 100}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className={styles.recordChoiceRow}>
              <button type="button" className={styles.recordChoiceBtn} onClick={() => { setBlob(null); setSeconds(0); }} aria-label="Record again">
                <RotateCcw size={24} strokeWidth={2} aria-hidden />
                <span>Record again</span>
              </button>
              <button type="button" className={`${styles.recordChoiceBtn} ${styles.recordChoiceBtnPrimary}`} onClick={handleAdd} disabled={isAdding} aria-label={isAdding ? 'Adding to episode' : 'Add to episode'}>
                <PlusCircle size={24} strokeWidth={2} aria-hidden />
                <span>{isAdding ? 'Adding…' : 'Add to episode'}</span>
              </button>
            </div>
          </>
        )}
        {error && <p className={styles.error} style={{ marginTop: '0.5rem' }}>{error}</p>}
        <div className={styles.recordActions} style={{ marginTop: '1rem' }}>
          <button ref={cancelButtonRef} type="button" className={styles.libraryClose} onClick={requestClose} aria-label="Cancel recording">
            Cancel
          </button>
        </div>
      </div>

      <Dialog.Root open={showCloseConfirm} onOpenChange={(o) => !o && setShowCloseConfirm(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <Dialog.Title className={styles.dialogTitle}>Discard recording?</Dialog.Title>
            <p className={styles.dialogDescription}>Your recording will not be saved.</p>
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel} aria-label="Stay and continue recording">
                  Stay
                </button>
              </Dialog.Close>
              <button type="button" className={styles.dialogConfirmRemove} onClick={confirmClose} aria-label="Discard recording">
                Discard
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

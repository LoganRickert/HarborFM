import { useState, useEffect, useRef, useCallback } from 'react';
import { RotateCcw, PlusCircle, Play, Pause, X, Upload, Settings, Mic, Volume2 } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { formatDuration } from './utils';
import { formatDurationHMS } from '../../utils/format';
import { createAudioLevelProcessor } from '../../utils/audioLevel';
import { DEVICE_ID_KEY, getAgcKey, getMicVolumeKey } from '../../constants/micSettings';
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
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isPlaybackPlaying, setIsPlaybackPlaying] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<'close' | 'discard_preview' | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasSeenAudio, setHasSeenAudio] = useState(false);
  const hasSeenAudioRef = useRef(false);
  const [deviceId, setDeviceId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(DEVICE_ID_KEY) || '';
  });
  const [autoGainControl, setAutoGainControl] = useState(() => {
    if (typeof window === 'undefined') return true;
    const id = localStorage.getItem(DEVICE_ID_KEY) || 'default';
    const stored = localStorage.getItem(getAgcKey(id));
    if (stored === 'false') return false;
    if (stored === 'true') return true;
    return true;
  });
  const [micVolume, setMicVolume] = useState(() => {
    if (typeof window === 'undefined') return 1;
    const id = localStorage.getItem(DEVICE_ID_KEY) || 'default';
    const stored = localStorage.getItem(getMicVolumeKey(id));
    if (stored == null) return 1;
    const v = parseFloat(stored);
    return Number.isFinite(v) ? Math.max(0, Math.min(8, v)) : 1;
  });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listenToSelf, setListenToSelf] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const settingsStreamRef = useRef<MediaStream | null>(null);
  const settingsAudioContextRef = useRef<AudioContext | null>(null);
  const settingsAnalyserRef = useRef<AnalyserNode | null>(null);
  const selfListenGainRef = useRef<GainNode | null>(null);
  const micVolumeGainRef = useRef<GainNode | null>(null);
  const settingsLevelAnimationRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement>(null);
  const recordProgressTrackRef = useRef<HTMLDivElement>(null);
  const recordCardRef = useRef<HTMLDivElement>(null);
  const recordButtonRef = useRef<HTMLButtonElement>(null);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelAnimationRef = useRef<number | null>(null);

  const hasPreview = !!(blob || uploadedFile);

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }

  const refreshDevices = useCallback(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      ?.then((all) => {
        const audioInputs = all.filter((d) => d.kind === 'audioinput');
        setDevices(audioInputs);
        setDeviceId((prev) => {
          const stored = typeof window !== 'undefined' ? localStorage.getItem(DEVICE_ID_KEY) || '' : '';
          const preferred = prev || stored;
          const stillValid = preferred && audioInputs.some((d) => d.deviceId === preferred);
          return stillValid ? preferred : audioInputs[0]?.deviceId ?? '';
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!deviceId || typeof window === 'undefined') return;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    const agcStored = localStorage.getItem(getAgcKey(deviceId));
    setAutoGainControl(agcStored === 'false' ? false : true);
    const volStored = localStorage.getItem(getMicVolumeKey(deviceId)) ?? localStorage.getItem(getMicVolumeKey('default'));
    const v = parseFloat(volStored ?? '1');
    setMicVolume(Number.isFinite(v) ? Math.max(0, Math.min(8, v)) : 1);
  }, [deviceId]);

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
      if (settingsLevelAnimationRef.current != null) cancelAnimationFrame(settingsLevelAnimationRef.current);
      if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close();
      if (settingsAudioContextRef.current?.state !== 'closed') settingsAudioContextRef.current?.close();
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (settingsStreamRef.current) settingsStreamRef.current.getTracks().forEach((t) => t.stop());
      releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!recording && !hasPreview && recordButtonRef.current) recordButtonRef.current.focus();
      else if (recording && stopButtonRef.current) stopButtonRef.current.focus();
      else if (hasPreview && cancelButtonRef.current) cancelButtonRef.current.focus();
    }, 0);
    return () => clearTimeout(timeout);
  }, [recording, hasPreview]);

  useEffect(() => {
    const card = recordCardRef.current;
    if (!card) return;
    function handleKeyDown(e: KeyboardEvent) {
      const c = recordCardRef.current;
      if (!c) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!recording && !hasPreview) onClose();
        else {
          setPendingConfirm('close');
          setShowCloseConfirm(true);
        }
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
  }, [recording, hasPreview, onClose]);

  useEffect(() => {
    if (blob) {
      const url = URL.createObjectURL(blob);
      setPlaybackUrl(url);
      setPlaybackDuration(seconds);
      setPlaybackCurrentTime(0);
      return () => URL.revokeObjectURL(url);
    }
    if (uploadedFile) {
      const url = URL.createObjectURL(uploadedFile);
      setPlaybackUrl(url);
      setPlaybackDuration(0);
      setPlaybackCurrentTime(0);
      return () => URL.revokeObjectURL(url);
    }
    setPlaybackUrl(null);
    setPlaybackCurrentTime(0);
    setPlaybackDuration(0);
    setIsPlaybackPlaying(false);
  }, [blob, seconds, uploadedFile]);

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

  function stopSettingsPreview() {
    if (settingsLevelAnimationRef.current != null) {
      cancelAnimationFrame(settingsLevelAnimationRef.current);
      settingsLevelAnimationRef.current = null;
    }
    if (settingsAudioContextRef.current?.state !== 'closed') {
      settingsAudioContextRef.current?.close();
      settingsAudioContextRef.current = null;
    }
    settingsAnalyserRef.current = null;
    selfListenGainRef.current = null;
    micVolumeGainRef.current = null;
    if (settingsStreamRef.current) {
      settingsStreamRef.current.getTracks().forEach((t) => t.stop());
      settingsStreamRef.current = null;
    }
    setListenToSelf(false);
  }

  async function setupSettingsMicrophone(overrides?: { autoGainControl?: boolean; micVolume?: number }): Promise<boolean> {
    const agc = overrides?.autoGainControl ?? autoGainControl;
    const vol = overrides?.micVolume ?? micVolume;
    if (settingsStreamRef.current) return true;
    const audioConstraints: MediaTrackConstraints = {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      sampleRate: { ideal: 48000 },
      autoGainControl: agc,
      noiseSuppression: false,
      ...(!agc ? { echoCancellation: false } : {}),
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      settingsStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      settingsAudioContextRef.current = ctx;
      const micSource = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      micSource.connect(analyser);
      settingsAnalyserRef.current = analyser;
      const micVolumeGain = ctx.createGain();
      micVolumeGain.gain.value = agc ? 1 : Math.max(0, Math.min(8, vol));
      micSource.connect(micVolumeGain);
      micVolumeGainRef.current = micVolumeGain;
      const selfListenGain = ctx.createGain();
      selfListenGain.gain.value = 0;
      micVolumeGain.connect(selfListenGain);
      selfListenGain.connect(ctx.destination);
      selfListenGainRef.current = selfListenGain;
      await ctx.resume();
      const computeLevel = createAudioLevelProcessor(analyser);
      function tick() {
        const an = settingsAnalyserRef.current;
        const ctxNow = settingsAudioContextRef.current;
        if (an && ctxNow && ctxNow.state === 'running') {
          setAudioLevel(computeLevel());
        }
        settingsLevelAnimationRef.current = requestAnimationFrame(tick);
      }
      settingsLevelAnimationRef.current = requestAnimationFrame(tick);
      refreshDevices();
      return true;
    } catch {
      setAudioLevel(0);
      return false;
    }
  }

  const toggleListenToSelfSettings = async () => {
    const ok = await setupSettingsMicrophone();
    if (!ok) return;
    const gain = selfListenGainRef.current;
    const ctx = settingsAudioContextRef.current;
    if (!gain || !ctx) return;
    await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return;
    setListenToSelf((prev) => {
      gain.gain.value = prev ? 0 : 1;
      return !prev;
    });
  };

  const handleDeviceChange = (newDeviceId: string) => {
    setDeviceId(newDeviceId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DEVICE_ID_KEY, newDeviceId);
    }
    stopSettingsPreview();
  };

  const handleAutoGainControlChange = async (enabled: boolean) => {
    const wasListening = listenToSelf;
    setAutoGainControl(enabled);
    if (typeof window !== 'undefined' && deviceId) {
      localStorage.setItem(getAgcKey(deviceId), String(enabled));
    }
    stopSettingsPreview();
    if (wasListening) {
      const ok = await setupSettingsMicrophone({ autoGainControl: enabled });
      if (ok) {
        const gain = selfListenGainRef.current;
        const ctx = settingsAudioContextRef.current;
        if (gain && ctx) {
          await ctx.resume().catch(() => {});
          if (ctx.state === 'running') {
            gain.gain.value = 1;
            setListenToSelf(true);
          }
        }
      }
    }
  };

  const handleMicVolumeChange = (vol: number) => {
    const clamped = Math.max(0, Math.min(8, vol));
    setMicVolume(clamped);
    if (typeof window !== 'undefined') {
      localStorage.setItem(getMicVolumeKey(deviceId || 'default'), String(clamped));
    }
    const gain = micVolumeGainRef.current;
    if (gain && !autoGainControl) gain.gain.value = clamped;
  };

  useEffect(() => {
    if (settingsOpen) {
      refreshDevices();
    } else {
      stopSettingsPreview();
    }
  }, [settingsOpen, refreshDevices]);

  useEffect(() => {
    if (!settingsOpen) return;
    const g = micVolumeGainRef.current;
    if (g) g.gain.value = autoGainControl ? 1 : Math.max(0, Math.min(8, micVolume));
  }, [settingsOpen, autoGainControl, micVolume]);

  async function startRecording() {
    try {
      stopSettingsPreview();
      const audioConstraints: MediaTrackConstraints = {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        sampleRate: { ideal: 48000 },
        autoGainControl,
        noiseSuppression: false,
        ...(!autoGainControl ? { echoCancellation: false } : {}),
      };
      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      streamRef.current = rawStream;
      chunksRef.current = [];
      let streamForRecorder: MediaStream;
      if (autoGainControl) {
        streamForRecorder = rawStream;
        startLevelMeter(rawStream);
      } else {
        const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const micSource = ctx.createMediaStreamSource(rawStream);
        const analyser = ctx.createAnalyser();
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        micSource.connect(analyser);
        analyser.connect(silentGain);
        silentGain.connect(ctx.destination);
        analyserRef.current = analyser;
        const micVolumeGain = ctx.createGain();
        micVolumeGain.gain.value = Math.max(0, Math.min(8, micVolume));
        micSource.connect(micVolumeGain);
        const sendDest = ctx.createMediaStreamDestination();
        micVolumeGain.connect(sendDest);
        streamForRecorder = sendDest.stream;
        ctx.resume().catch(() => {});
        const computeLevel = createAudioLevelProcessor(analyser);
        function tick() {
          const an = analyserRef.current;
          const ctxNow = audioContextRef.current;
          if (an && ctxNow && ctxNow.state === 'running') {
            setAudioLevel(computeLevel());
          }
          levelAnimationRef.current = requestAnimationFrame(tick);
        }
        levelAnimationRef.current = requestAnimationFrame(tick);
      }
      const recorder = new MediaRecorder(streamForRecorder);
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
      setUploadedFile(null);
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
    if (uploadedFile) {
      onAdd(uploadedFile, sectionName.trim() || null);
      return;
    }
    if (!blob) return;
    const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `recording.${ext}`, { type: blob.type });
    onAdd(file, sectionName.trim() || null);
  }

  function handleUploadFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    setSectionName(file.name.replace(/\.[^.]+$/, ''));
    setBlob(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function clearUploadedFile() {
    setUploadedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
    if (!recording && !hasPreview) {
      onClose();
    } else {
      setPendingConfirm('close');
      setShowCloseConfirm(true);
    }
  }

  function requestDiscardPreview() {
    setPendingConfirm('discard_preview');
    setShowCloseConfirm(true);
  }

  function confirmDiscard() {
    if (pendingConfirm === 'close') {
      setShowCloseConfirm(false);
      setPendingConfirm(null);
      onClose();
    } else if (pendingConfirm === 'discard_preview') {
      setShowCloseConfirm(false);
      setPendingConfirm(null);
      setBlob(null);
      setSeconds(0);
      clearUploadedFile();
    }
  }

  function dismissConfirm() {
    setShowCloseConfirm(false);
    setPendingConfirm(null);
  }

  return (
    <div className={styles.recordOverlay} onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div ref={recordCardRef} className={styles.recordCard} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="record-title">
        <div className={styles.dialogHeaderRow}>
          <h3 id="record-title" className={styles.dialogTitle}>
            Record A Section
          </h3>
          <button type="button" className={styles.dialogClose} onClick={requestClose} aria-label="Close">
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {!recording && !hasPreview && !settingsOpen && (
          <p className={styles.recordSub}>Use your microphone or upload audio. To begin, click the red record button below.</p>
        )}

        {!recording && !hasPreview && !settingsOpen && (
          <>
            <button ref={recordButtonRef} type="button" className={`${styles.recordBtn} ${styles.record}`} onClick={startRecording} aria-label="Start recording">
              ●
            </button>
            {isMobile && (
              <p className={styles.recordMobileNote}>Please do not navigate away from this page or the recording may be stopped or lost. Please record for less than 30 minutes to avoid issues.</p>
            )}
            {!isMobile && (
              <p className={styles.recordMobileNote}>Please do not navigate away from this page or the recording may be stopped or lost.</p>
            )}
            <button
              type="button"
              className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary} ${styles.libraryChooseFileBtn}`}
              style={{ width: '100%', marginTop: '0.75rem' }}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Choose file to upload"
            >
              <Upload size={24} strokeWidth={2} aria-hidden />
              <span>Choose File to Upload</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/mp4,audio/webm,audio/ogg,.mp3,.wav,.m4a,.webm,.ogg"
              style={{ display: 'none' }}
              onChange={handleUploadFileSelect}
            />
          </>
        )}

        {recording && (
          <>
            <div className={styles.recordRow}>
              <button ref={stopButtonRef} type="button" className={`${styles.recordBtn} ${styles.stop}`} onClick={stopRecording} aria-label="Stop recording">
                ■
              </button>
              <span className={styles.recordDurationBadge} aria-live="polite">
                {formatDurationHMS(seconds)}
              </span>
            </div>
            <div className={styles.recordLevelWrap} aria-live="polite" aria-label="Microphone level">
              <div className={styles.recordLevelBar} role="presentation">
                <div className={styles.recordLevelFill} style={{ width: `${audioLevel}%` }} />
              </div>
              {!hasSeenAudio && (
                <p className={styles.recordLevelHint}>
                  {audioLevel < 2 ? 'No input - check if microphone is muted' : 'Microphone active'}
                </p>
              )}
            </div>
          </>
        )}

        {hasPreview && !recording && (
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
            {blob && (
              <button type="button" className={`${styles.recordChoiceBtn} ${styles.recordChoiceBtnSecondary}`} style={{ width: '100%', marginTop: '0.5rem' }} onClick={requestDiscardPreview} aria-label="Record again">
                <RotateCcw size={24} strokeWidth={2} aria-hidden />
                <span>Record again</span>
              </button>
            )}
            {uploadedFile && (
              <button type="button" className={styles.recordChoiceBtn} style={{ width: '100%', marginTop: '0.5rem' }} onClick={requestDiscardPreview} aria-label="Choose different file">
                <Upload size={24} strokeWidth={2} aria-hidden />
                <span>Choose different file</span>
              </button>
            )}
            <div className={styles.recordFooterRow}>
              <button ref={cancelButtonRef} type="button" className={styles.libraryClose} onClick={requestClose} aria-label="Cancel">
                Cancel
              </button>
              <button type="button" className={styles.recordFooterPrimaryBtn} onClick={handleAdd} disabled={isAdding} aria-label={isAdding ? 'Adding to episode' : 'Add to episode'}>
                <PlusCircle size={18} strokeWidth={2} aria-hidden />
                <span>{isAdding ? 'Adding...' : 'Add to episode'}</span>
              </button>
            </div>
          </>
        )}

        {!hasPreview && !recording && (
          <>
            {settingsOpen && (
              <div className={styles.recordSettingsPanel}>
                {devices.length > 0 ? (
                  <>
                <div className={styles.recordSettingsMic}>
                  <label className={styles.recordSettingsLabel} htmlFor="record-modal-mic">
                    Microphone
                  </label>
                  <select
                    id="record-modal-mic"
                    className={styles.recordSettingsSelect}
                    value={deviceId}
                    onChange={(e) => handleDeviceChange(e.target.value)}
                    aria-label="Microphone"
                  >
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.recordSettingsAgc}>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={autoGainControl}
                      onChange={(e) => handleAutoGainControlChange(e.target.checked)}
                      aria-label="Auto Gain Control"
                    />
                    <span className="toggle__track" aria-hidden="true" />
                    <span>Auto Gain Control</span>
                  </label>
                </div>
                {!autoGainControl && (
                  <>
                    <div className={styles.recordSettingsVolume}>
                      <label className={styles.recordSettingsLabel}>Volume</label>
                      <input
                        type="range"
                        min={0}
                        max={800}
                        step={1}
                        value={Math.round((micVolume ?? 1) * 100)}
                        onChange={(e) => {
                          const raw = parseFloat(e.target.value);
                          if (Number.isFinite(raw)) handleMicVolumeChange(raw / 100);
                        }}
                        className={styles.recordSettingsSlider}
                        aria-label="Microphone volume"
                      />
                      <span className={styles.recordSettingsVolumeValue}>{Math.round((micVolume ?? 1) * 100)}%</span>
                    </div>
                    <p className={styles.recordSettingsHint}>
                      Use headphones to avoid feedback. If volume pumps, try disabling &quot;Allow WebRTC to adjust input volume&quot; in chrome://flags.
                    </p>
                  </>
                )}
                <div className={styles.recordSettingsListen}>
                  <button
                    type="button"
                    className={styles.recordListenBtn}
                    onClick={toggleListenToSelfSettings}
                    aria-pressed={listenToSelf}
                    aria-label={listenToSelf ? 'Stop listening to yourself' : 'Listen to yourself'}
                  >
                    {listenToSelf ? <Volume2 size={16} /> : <Mic size={16} />}
                    {listenToSelf ? ' Stop listening' : ' Listen to yourself'}
                  </button>
                </div>
                  </>
                ) : (
                  <p className={styles.recordSettingsEmpty}>No microphones found. Grant microphone permission and refresh.</p>
                )}
              </div>
            )}
            <div className={styles.recordFooterRow}>
              <button ref={cancelButtonRef} type="button" className={styles.libraryClose} onClick={requestClose} aria-label="Cancel">
                Cancel
              </button>
              {!settingsOpen && (
                <button
                  type="button"
                  className={styles.recordFooterSettingsBtn}
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Settings"
                  aria-expanded={settingsOpen}
                >
                  <Settings size={16} strokeWidth={2} aria-hidden />
                  <span>Settings</span>
                </button>
              )}
              {settingsOpen && (
                <button
                  type="button"
                  className={styles.recordFooterPrimaryBtn}
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Back to record"
                >
                  <span>Back To Record</span>
                </button>
              )}
            </div>
          </>
        )}

        {error && <p className={styles.error} style={{ marginTop: '0.5rem' }}>{error}</p>}
      </div>

      <Dialog.Root open={showCloseConfirm} onOpenChange={(o) => !o && dismissConfirm()}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>
                {pendingConfirm === 'discard_preview' ? 'Discard recording or upload?' : 'Discard recording?'}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className={styles.dialogClose} onClick={dismissConfirm} aria-label="Close">
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              {pendingConfirm === 'discard_preview' ? 'Your recording or upload will not be saved.' : 'Your recording will not be saved.'}
            </Dialog.Description>
            <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel} onClick={dismissConfirm} aria-label="Stay and continue">
                  Stay
                </button>
              </Dialog.Close>
              <button type="button" className={styles.dialogConfirmRemove} onClick={confirmDiscard} aria-label="Discard">
                Discard
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

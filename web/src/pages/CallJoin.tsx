import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PhoneOff, Mic, MicOff, Pencil, Check, Volume2, Crown, User, Settings, X, List } from 'lucide-react';
import type { ShowNotesItem } from '@harborfm/shared';
import { getJoinInfo, callWebSocketUrl } from '../api/call';
import { getPublicConfig } from '../api/public';
import { getAgcKey, getMicVolumeKey } from '../constants/micSettings';
import { useMediasoupRoom } from '../hooks/useMediasoupRoom';
import { useMeta } from '../hooks/useMeta';
import { useWakeLock } from '../hooks/useWakeLock';
import { RemoteAudio, AudioUnlockBanner } from '../components/GroupCall/RemoteAudio';
import { AudioUnlockProvider } from '../components/GroupCall/AudioUnlockContext';
import { CallChatPanel, type ChatMessage } from '../components/GroupCall/CallChatPanel';
import { CallJoinHeader } from '../components/CallJoinHeader';
import { LeaveCallConfirmDialog } from '../components/GroupCall/LeaveCallConfirmDialog';
import { CallShowNotesDialog } from '../components/GroupCall/CallShowNotesDialog';
import type { CallJoinInfo } from '../api/call';
import { createAudioLevelProcessor } from '../utils/audioLevel';
import { formatDurationHMS } from '../utils/format';
import { getSiteDisplayName } from '../utils/siteBranding';
import styles from './CallJoin.module.css';

const DISPLAY_NAME_KEY = 'harborfm_call_display_name';
/** Keep guest /api/call/ws alive through proxies (Caddy/nginx idle ~10 min). Matches host CallPanel. */
const HEARTBEAT_INTERVAL_MS = 30_000;

export function CallJoin() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [joinInfo, setJoinInfo] = useState<CallJoinInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: publicConfig } = useQuery({
    queryKey: ['publicConfig', typeof window !== 'undefined' ? window.location.host : ''],
    queryFn: getPublicConfig,
    staleTime: 60_000,
  });
  const siteName = getSiteDisplayName(publicConfig?.whiteLabel);

  useMeta({
    title: joinInfo
      ? `${joinInfo.episode.title} | Join Call | ${siteName}`
      : undefined,
    description: joinInfo
      ? `Join the group call for ${joinInfo.episode.title} on ${joinInfo.podcast.title}.`
      : undefined,
    image: joinInfo?.artworkUrl ?? undefined,
    siteName,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    favicon: joinInfo?.artworkUrl ?? undefined,
  });
  const [name, setName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(DISPLAY_NAME_KEY)?.trim() || '';
  });
  const [password, setPassword] = useState('');
  const [deviceId, setDeviceId] = useState<string>('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [showMicSettings, setShowMicSettings] = useState(false);
  const [autoGainControl, setAutoGainControl] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(getAgcKey('default'));
    if (stored === 'false') return false;
    if (stored === 'true') return true;
    return true;
  });
  const [micVolume, setMicVolume] = useState(() => {
    if (typeof window === 'undefined') return 1;
    const stored = localStorage.getItem(getMicVolumeKey('default'));
    if (stored == null) return 1;
    const v = parseFloat(stored);
    return Number.isFinite(v) ? Math.max(0, Math.min(8, v)) : 1;
  });
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [listeningToSelf, setListeningToSelf] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [webrtcUrl, setWebrtcUrl] = useState<string | undefined>(undefined);
  const [webrtcRoomId, setWebrtcRoomId] = useState<string | undefined>(undefined);
  const [participants, setParticipants] = useState<Array<{ id: string; name: string; isHost: boolean; muted?: boolean; mutedByHost?: boolean; disconnected?: boolean }>>([]);
  const [hostDisconnected, setHostDisconnected] = useState<{ gracePeriodMs: number; endsAt: number } | null>(null);
  const [hostAwayCountdown, setHostAwayCountdown] = useState<number | null>(null);
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [mutedByHost, setMutedByHost] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(true);
  const [chatUnread, setChatUnread] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [recordingInProgress, setRecordingInProgress] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingEpochRef = useRef<number | null>(null);
  const [showNotesGuestVisible, setShowNotesGuestVisible] = useState(false);
  const [showNotesItems, setShowNotesItems] = useState<ShowNotesItem[]>([]);
  const [showNotesOpen, setShowNotesOpen] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const selfListenGainRef = useRef<GainNode | null>(null);
  const micVolumeGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const displayNameInputRef = useRef<HTMLInputElement | null>(null);
  const myParticipantIdRef = useRef<string | null>(null);
  myParticipantIdRef.current = myParticipantId;
  const myParticipant = myParticipantId ? participants.find((p) => p.id === myParticipantId) : null;
  const displayName = myParticipant?.name ?? name;
  const { remoteTracks, remoteMicLevels, soundboardVolumeFromRoom, setMuted, micLevel: sendMicLevel } = useMediasoupRoom(
    webrtcUrl,
    webrtcRoomId,
    deviceId || undefined,
    myParticipantId ?? undefined,
    myParticipant?.name ?? name,
    undefined,
    autoGainControl,
    micVolume,
  );
  // When in-call, show the mediasoup send-path level (what remotes hear), not the pre-join preview mic.
  const displayMicLevel = joined ? sendMicLevel : micLevel;
  const setMutedRef = useRef(setMuted);
  setMutedRef.current = setMuted;

  useWakeLock(joined);

  const applyRecordingState = useCallback((inProgress: boolean, epochMs?: number) => {
    setRecordingInProgress(inProgress);
    if (inProgress) {
      const epoch = typeof epochMs === 'number' ? epochMs : Date.now();
      recordingEpochRef.current = epoch;
      setRecordingSeconds(Math.max(0, Math.floor((Date.now() - epoch) / 1000)));
    } else {
      recordingEpochRef.current = null;
      setRecordingSeconds(0);
    }
  }, []);

  useEffect(() => {
    if (!recordingInProgress || recordingEpochRef.current == null) return;
    const tick = () => {
      const epoch = recordingEpochRef.current;
      if (epoch != null) {
        setRecordingSeconds(Math.max(0, Math.floor((Date.now() - epoch) / 1000)));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [recordingInProgress]);

  const applyShowNotesState = useCallback((visible: boolean, items: ShowNotesItem[]) => {
    setShowNotesGuestVisible(visible);
    setShowNotesItems(items);
    if (!visible || items.length === 0) setShowNotesOpen(false);
  }, []);

  useEffect(() => {
    if (!hostDisconnected) {
      setHostAwayCountdown(null);
      return;
    }
    const tick = () => {
      const remain = Math.max(0, Math.ceil((hostDisconnected.endsAt - Date.now()) / 1000));
      setHostAwayCountdown(remain);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [hostDisconnected]);

  useEffect(() => {
    if (myParticipant?.muted && myParticipant?.mutedByHost) setMutedByHost(true);
    else if (!myParticipant?.muted) setMutedByHost(false);
  }, [myParticipant?.muted, myParticipant?.mutedByHost]);

  useEffect(() => {
    if (!token) {
      navigate('/call/join?error=' + encodeURIComponent('Invalid link'), { replace: true });
      return;
    }
    getJoinInfo(token)
      .then((info) => {
        setJoinInfo(info);
        setLoading(false);
      })
      .catch((err: Error & { status?: number }) => {
        const msg = err?.message ?? 'Invalid or expired link';
        setLoading(false);
        navigate(`/call/join?error=${encodeURIComponent(msg)}`, { replace: true });
      });
  }, [token, navigate]);

  const refreshDevices = useCallback(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        const audioInputs = all.filter((d) => d.kind === 'audioinput');
        setDevices(audioInputs);
        setDeviceId((prev) => {
          const stillValid = prev && audioInputs.some((d) => d.deviceId === prev);
          return stillValid ? prev : audioInputs[0]?.deviceId ?? '';
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshDevices();
    const handleDeviceChange = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
  }, [refreshDevices]);

  useEffect(() => {
    const id = deviceId || 'default';
    const agcStored = localStorage.getItem(getAgcKey(id));
    setAutoGainControl(agcStored === 'false' ? false : true);
    const volStored = localStorage.getItem(getMicVolumeKey(id)) ?? localStorage.getItem(getMicVolumeKey('default'));
    const v = parseFloat(volStored ?? '1');
    setMicVolume(Number.isFinite(v) ? Math.max(0, Math.min(8, v)) : 1);
  }, [deviceId]);

  useEffect(() => {
    const g = micVolumeGainRef.current;
    if (g) g.gain.value = autoGainControl ? 1 : Math.max(0, Math.min(8, micVolume));
  }, [autoGainControl, micVolume]);

  // Request microphone permission when token is validated so device list shows proper labels
  useEffect(() => {
    if (!joinInfo || !navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        refreshDevices();
      })
      .catch(() => {});
  }, [joinInfo, refreshDevices]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close();
      streamRef.current = null;
      analyserRef.current = null;
      audioContextRef.current = null;
      selfListenGainRef.current = null;
      micVolumeGainRef.current = null;
    };
  }, []);

  const prevJoinedRef = useRef(false);
  const prevDeviceIdRef = useRef<string | undefined>(undefined);
  const prevAgcRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const wasInCall = prevJoinedRef.current;
    prevJoinedRef.current = joined;

    const deviceChanged = prevDeviceIdRef.current !== undefined && prevDeviceIdRef.current !== deviceId;
    prevDeviceIdRef.current = deviceId;
    const agcChanged = prevAgcRef.current !== undefined && prevAgcRef.current !== autoGainControl;
    prevAgcRef.current = autoGainControl;

    const shouldTearDown =
      (wasInCall && !joined) ||
      (deviceChanged && !joined && streamRef.current !== null) ||
      (agcChanged && !joined && streamRef.current !== null);

    if (!shouldTearDown || !streamRef.current) return;

    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const s = streamRef.current;
    s.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();
    streamRef.current = null;
    analyserRef.current = null;
    audioContextRef.current = null;
    selfListenGainRef.current = null;
    micVolumeGainRef.current = null;
    setListeningToSelf(false);
  }, [deviceId, joined, autoGainControl]);

  const setupMicrophone = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) {
      const g = micVolumeGainRef.current;
      if (g) g.gain.value = autoGainControl ? 1 : Math.max(0, Math.min(8, micVolume));
      return true;
    }
    const constraints: MediaStreamConstraints = {
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        autoGainControl,
        noiseSuppression: false,
        ...(!autoGainControl ? { echoCancellation: false } : {}),
      },
      video: false,
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const micVolumeGain = ctx.createGain();
      micVolumeGain.gain.value = autoGainControl ? 1 : Math.max(0, Math.min(8, micVolume));
      micVolumeGainRef.current = micVolumeGain;
      src.connect(micVolumeGain);
      const analyser = ctx.createAnalyser();
      micVolumeGain.connect(analyser);
      analyserRef.current = analyser;
      const selfListenGain = ctx.createGain();
      selfListenGain.gain.value = 0;
      micVolumeGain.connect(selfListenGain);
      selfListenGain.connect(ctx.destination);
      selfListenGainRef.current = selfListenGain;
      await ctx.resume();
      const computeLevel = createAudioLevelProcessor(analyser);
      function tick() {
        const an = analyserRef.current;
        if (!an || !audioContextRef.current) return;
        if (audioContextRef.current.state !== 'running') {
          animationRef.current = requestAnimationFrame(tick);
          return;
        }
        setMicLevel(computeLevel());
        animationRef.current = requestAnimationFrame(tick);
      }
      tick();
      refreshDevices();
      return true;
    } catch {
      setMicLevel(0);
      return false;
    }
  }, [deviceId, autoGainControl, micVolume, refreshDevices]);

  const resumeAudioContext = () => {
    if (!streamRef.current) {
      setupMicrophone();
      return;
    }
    audioContextRef.current?.resume().catch(() => {});
  };

  useEffect(() => {
    if (showMicSettings && devices.length > 0) setupMicrophone();
  }, [showMicSettings, devices.length, setupMicrophone]);

  const toggleListenToSelf = async () => {
    const ok = await setupMicrophone();
    if (!ok) return;
    const ctx = audioContextRef.current;
    const gain = selfListenGainRef.current;
    if (!ctx || !gain) return;
    await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return;
    setListeningToSelf((prev) => {
      gain.gain.value = prev ? 0 : 0.5;
      return !prev;
    });
  };

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(
    (ws: WebSocket) => {
      clearHeartbeat();
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    [clearHeartbeat],
  );

  useEffect(() => {
    return () => clearHeartbeat();
  }, [clearHeartbeat]);

  const handleJoin = () => {
    if (!token || !name.trim()) return;
    setError(null);
    setJoining(true);
    // Initialize microphone for level meter (user gesture from Join click)
    setupMicrophone();
    clearHeartbeat();
    const ws = new WebSocket(callWebSocketUrl());
    wsRef.current = ws;
    let resolved = false;
    let joinTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearJoinTimeout = () => {
      if (joinTimeout) {
        clearTimeout(joinTimeout);
        joinTimeout = null;
      }
    };

    joinTimeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      setError('Join timed out. Please try again.');
      setJoining(false);
      ws.close();
    }, 15000);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'guest',
          token,
          name: name.trim(),
          password: joinInfo?.passwordRequired ? password || undefined : undefined,
        })
      );
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'joined') {
          resolved = true;
          clearJoinTimeout();
          setJoined(true);
          startHeartbeat(ws);
          const trimmedName = name.trim();
          if (trimmedName && typeof window !== 'undefined') {
            localStorage.setItem(DISPLAY_NAME_KEY, trimmedName);
          }
          setMyParticipantId(msg.participantId ?? null);
          setParticipants(msg.participants ?? []);
          applyRecordingState(
            msg.recordingInProgress === true,
            typeof msg.recordingStartedAtEpochMs === 'number' ? msg.recordingStartedAtEpochMs : undefined,
          );
          if (msg.hostDisconnected === true && typeof msg.gracePeriodMs === 'number' && typeof msg.endsAt === 'number') {
            setHostDisconnected({ gracePeriodMs: msg.gracePeriodMs, endsAt: msg.endsAt });
          } else {
            setHostDisconnected(null);
          }
          if (msg.webrtcUrl) setWebrtcUrl(msg.webrtcUrl);
          if (msg.roomId) setWebrtcRoomId(msg.roomId);
          applyShowNotesState(
            msg.showNotesGuestVisible === true,
            Array.isArray(msg.showNotesItems) ? (msg.showNotesItems as ShowNotesItem[]) : [],
          );
        } else if (msg.type === 'participants') {
          const list = msg.participants ?? [];
          setParticipants(list);
          const host = list.find((p: { isHost?: boolean }) => p.isHost);
          if (!host?.disconnected) setHostDisconnected(null);
        } else if (msg.type === 'hostDisconnected') {
          if (typeof msg.gracePeriodMs === 'number' && typeof msg.endsAt === 'number') {
            setHostDisconnected({ gracePeriodMs: msg.gracePeriodMs, endsAt: msg.endsAt });
          }
        } else if (msg.type === 'recordingStarted') {
          applyRecordingState(
            true,
            typeof msg.recordingEpochMs === 'number' ? msg.recordingEpochMs : undefined,
          );
        } else if (msg.type === 'recordingStopped') {
          applyRecordingState(false);
        } else if (msg.type === 'showNotesUpdated') {
          applyShowNotesState(
            msg.guestVisible === true,
            Array.isArray(msg.showNotesItems) ? (msg.showNotesItems as ShowNotesItem[]) : [],
          );
        } else if (msg.type === 'participantJoined') {
          setParticipants((prev) => {
            const p = msg.participant;
            if (p && !prev.some((x) => x.id === p.id)) return [...prev, p];
            return prev;
          });
        } else if (msg.type === 'callEnded') {
          clearJoinTimeout();
          clearHeartbeat();
          setHostDisconnected(null);
          setJoined(false);
          setJoining(false);
          wsRef.current = null;
          ws.close();
        } else if (msg.type === 'error') {
          resolved = true;
          clearJoinTimeout();
          clearHeartbeat();
          setError(msg.error ?? 'Could not join');
          setJoining(false);
          ws.close();
        } else if (msg.type === 'setMute') {
          const m = msg.muted === true;
          setMutedState(m);
          setMutedRef.current(m);
          setMutedByHost(m && msg.mutedByHost === true);
        } else if (msg.type === 'chat') {
          setChatMessages((prev) => [
            ...prev,
            {
              participantId: msg.participantId,
              participantName: msg.participantName ?? 'Unknown',
              text: msg.text ?? '',
              timestamp: Date.now(),
            },
          ]);
          if (msg.participantId !== myParticipantIdRef.current) {
            setChatUnread(true);
          }
        } else if (msg.type === 'disconnected') {
          clearJoinTimeout();
          clearHeartbeat();
          setHostDisconnected(null);
          setWebrtcUrl(undefined);
          setWebrtcRoomId(undefined);
          setJoined(false);
          setError('You were disconnected by the host');
          setJoining(false);
          wsRef.current = null;
          ws.close();
        }
      } catch {
        // ignore
      }
    };
    ws.onclose = () => {
      clearJoinTimeout();
      clearHeartbeat();
      setJoining(false);
      wsRef.current = null;
      if (!resolved) {
        setError('Connection closed. Please try again.');
      }
    };
    ws.onerror = () => {
      if (!resolved) setError('Connection failed');
      setJoining(false);
    };
  };

  const handleLeave = () => {
    clearHeartbeat();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'leave' }));
      wsRef.current.close();
    }
    wsRef.current = null;
    setJoined(false);
    setWebrtcUrl(undefined);
    setWebrtcRoomId(undefined);
  };

  const handleUpdateName = (newName: string) => {
    const trimmed = newName.trim();
    if (trimmed && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'updateParticipantName', name: trimmed }));
    }
    setEditingName(false);
  };

  const handleChatSend = (text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat', text }));
    }
  };

  const pageLayout = (content: React.ReactNode) => (
    <div className={styles.page}>
      <CallJoinHeader />
      <div className={styles.container}>
        {content}
      </div>
    </div>
  );

  if (loading) {
    return pageLayout(
      <div className={styles.card}>
        <p className={styles.loading}>Loading…</p>
      </div>
    );
  }

  if (error && !joinInfo) {
    return pageLayout(
      <div className={styles.card}>
        <h1 className={styles.cardTitle}>Could Not Load Call</h1>
        <p className={styles.error}>{error}</p>
      </div>
    );
  }

  if (joined) {
    const audioUnavailable = !webrtcUrl || !webrtcRoomId;
    return pageLayout(
      <AudioUnlockProvider>
      <>
        <div className={`${styles.card} ${recordingInProgress ? styles.cardRecording : ''}`}>
          {joinInfo?.artworkUrl && (
            <img src={joinInfo.artworkUrl} alt={joinInfo ? `${joinInfo.episode.title} artwork` : 'Call artwork'} className={styles.artwork} />
          )}
          {joinInfo && (
            <p className={`${styles.sub} ${styles.podcastEpisode}`}>
              {joinInfo.podcast.title} - {joinInfo.episode.title}
            </p>
          )}
          {recordingInProgress && (
            <div className={styles.recordingBanner} role="status" aria-live="polite">
              <span className={styles.recordingIndicator} aria-hidden />
              <span className={styles.recordingLabel}>Recording</span>
              <span className={styles.recordingDuration}>{formatDurationHMS(recordingSeconds)}</span>
            </div>
          )}
          <h1 className={styles.cardTitle}>You're In The Call</h1>
          {audioUnavailable && (
            <p className={styles.audioUnavailable} role="status">
              Audio is unavailable - the host&apos;s WebRTC service is not running. You can stay in the call but won&apos;t hear or be heard until it&apos;s started.
            </p>
          )}
          {mutedByHost && (
            <p className={styles.mutedByHostHint} role="status">
              You were muted by the host. Ask them to unmute you.
            </p>
          )}
          {hostDisconnected && (
            <p className={styles.hostAwayBanner} role="status">
              Host has left. Call will end in {hostAwayCountdown != null ? `${Math.floor(hostAwayCountdown / 60)}:${String(hostAwayCountdown % 60).padStart(2, '0')}` : '-'} unless they return.
            </p>
          )}
          <div className={styles.callActions}>
            {showNotesGuestVisible && showNotesItems.some((i) => !i.checked) && (
              <button
                type="button"
                className={styles.showNotesBtn}
                onClick={() => setShowNotesOpen(true)}
                aria-label="See show notes"
              >
                <List size={18} strokeWidth={2} aria-hidden />
                <span className={styles.callActionLabel}>See Show Notes</span>
              </button>
            )}
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => {
                if (mutedByHost) return;
                const next = !muted;
                setMutedState(next);
                setMuted(next);
                const ws = wsRef.current;
                if (ws?.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'setMute', muted: next }));
                }
              }}
              disabled={audioUnavailable || mutedByHost}
              aria-label={muted ? 'Unmute' : 'Mute'}
              title={mutedByHost ? 'You were muted by the host' : muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <MicOff size={18} strokeWidth={2} aria-hidden /> : <Mic size={18} strokeWidth={2} aria-hidden />}
              <span className={styles.callActionLabel}>{muted ? 'Unmute' : 'Mute'}</span>
            </button>
            <button
              type="button"
              className={styles.leaveBtn}
              onClick={() => setLeaveConfirmOpen(true)}
              aria-label="Leave call"
            >
              <PhoneOff size={18} strokeWidth={2} aria-hidden />
              <span className={styles.callActionLabel}>Leave Call</span>
            </button>
          </div>
          <p className={styles.participantsLabel}>
            Participants ({participants.length})
          </p>
          <ul className={styles.participantsList}>
            {[...participants]
              .sort((a, b) => (a.isHost === b.isHost ? 0 : a.isHost ? -1 : 1))
              .map((p) => (
              <li
                key={p.id}
                className={styles.participantCard}
                data-host={p.isHost || undefined}
                data-disconnected={p.disconnected || undefined}
                data-my-participant={p.id === myParticipantId || undefined}
              >
                <span className={styles.participantRoleIcon} aria-hidden>
                  {p.isHost ? <Crown size={14} /> : <User size={14} />}
                </span>
                <span className={styles.participantInfo}>
                  {p.id === myParticipantId ? (
                    <>
                      {editingName ? (
                        <span className={styles.nameEditRow}>
                          <input
                            ref={(el) => { displayNameInputRef.current = el; }}
                            type="text"
                            className={styles.nameInput}
                            defaultValue={displayName}
                            placeholder="Your name"
                            maxLength={100}
                            autoFocus
                            onBlur={(e) => handleUpdateName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleUpdateName((e.target as HTMLInputElement).value);
                              if (e.key === 'Escape') setEditingName(false);
                            }}
                            aria-label="Your display name"
                          />
                          <button
                            type="button"
                            className={styles.checkBtn}
                            onClick={() => handleUpdateName(displayNameInputRef.current?.value ?? '')}
                            aria-label="Save name"
                          >
                            <Check size={14} />
                          </button>
                        </span>
                      ) : (
                        <span className={styles.participantNameBlock}>
                          {muted && (
                            <span className={styles.mutedBadge} aria-label="Muted">
                              <MicOff size={10} />
                              Muted
                            </span>
                          )}
                          <span className={styles.participantNameRow}>
                            <span className={styles.participantName} title={displayName}>
                              {displayName}
                            </span>
                            <button
                              type="button"
                              className={styles.editNameBtn}
                              onClick={() => setEditingName(true)}
                              aria-label="Edit your name"
                            >
                              <Pencil size={12} />
                            </button>
                          </span>
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={styles.participantNameBlock}>
                      {p.muted && (
                        <span className={styles.mutedBadge} aria-label="Muted">
                          <MicOff size={10} />
                          Muted
                        </span>
                      )}
                      <span className={styles.participantName} title={p.name}>
                        {p.name}
                        {p.disconnected && <span className={styles.disconnectedBadge}> (left)</span>}
                      </span>
                    </span>
                  )}
                </span>
                <div
                  className={`${styles.participantMicLevel} ${p.id === myParticipantId ? styles.participantMicLevelInteractive : ''}`}
                  role={p.id === myParticipantId ? 'button' : 'img'}
                  tabIndex={p.id === myParticipantId ? 0 : undefined}
                  onClick={p.id === myParticipantId ? resumeAudioContext : undefined}
                  onKeyDown={p.id === myParticipantId ? (e) => e.key === 'Enter' && resumeAudioContext() : undefined}
                  aria-label="Microphone level"
                  title={p.id === myParticipantId ? 'Click if the bar doesn\'t move' : undefined}
                >
                  <div className={styles.micLevelBar} style={{ width: `${p.muted ? 0 : (p.id === myParticipantId ? displayMicLevel : (remoteMicLevels.get(p.id) ?? 0))}%` }} />
                </div>
              </li>
            ))}
          </ul>
          {Array.from(remoteTracks.entries()).map(([id, info]) => (
            <RemoteAudio
              key={id}
              track={info.track}
              volume={info.source === 'soundboard' ? soundboardVolumeFromRoom : 1}
            />
          ))}
          <AudioUnlockBanner />
        </div>
        <div className={styles.chatPanelWrapper}>
          <CallChatPanel
            messages={chatMessages}
            onSend={handleChatSend}
            minimized={chatMinimized}
            onMinimizeToggle={() => setChatMinimized((m) => !m)}
            unread={chatUnread}
            onInteract={() => setChatUnread(false)}
          />
        </div>
        <LeaveCallConfirmDialog
          open={leaveConfirmOpen}
          onOpenChange={setLeaveConfirmOpen}
          onConfirm={handleLeave}
        />
        <CallShowNotesDialog
          open={showNotesOpen}
          onClose={() => setShowNotesOpen(false)}
          items={showNotesItems.filter((i) => !i.checked)}
        />
      </>
      </AudioUnlockProvider>
    );
  }

  return pageLayout(
    <>
      <div className={styles.card}>
        {joinInfo?.artworkUrl && (
          <img src={joinInfo.artworkUrl} alt={joinInfo ? `${joinInfo.episode.title} artwork` : 'Call artwork'} className={styles.artwork} />
        )}
        {joinInfo && (
        <>
          <p className={`${styles.sub} ${styles.podcastEpisode}`}>
            {joinInfo.podcast.title} - {joinInfo.episode.title}
          </p>
          <h1 className={styles.cardTitle}>Join Group Call</h1>
          {joinInfo.hostName && (
            <p className={styles.hostName}>Host: {joinInfo.hostName}</p>
          )}
          <div className={styles.form}>
            <label className={styles.label} htmlFor="call-join-name">
              Your Name
            </label>
            <input
              id="call-join-name"
              type="text"
              className={`${styles.input} ${!name.trim() ? styles.inputRequired : ''}`}
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (typeof window !== 'undefined') {
                  localStorage.setItem(DISPLAY_NAME_KEY, v);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !joining && name.trim()) {
                  handleJoin();
                }
              }}
              placeholder="Enter your name"
              maxLength={100}
            />
            {devices.length > 0 && (
              <button
                type="button"
                className={styles.micSettingsToggle}
                onClick={() => setShowMicSettings(true)}
                aria-expanded={false}
                aria-label="Review microphone settings"
              >
                <Settings size={16} strokeWidth={2} aria-hidden />
                Microphone settings
              </button>
            )}
            {joinInfo.passwordRequired && (
              <>
                <label className={styles.label} htmlFor="call-join-password">
                  Password
                </label>
                <input
                  id="call-join-password"
                  type="password"
                  className={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                />
              </>
            )}
            {error && <p className={styles.error}>{error}</p>}
            <button
              type="button"
              className={styles.joinBtn}
              onClick={handleJoin}
              disabled={joining || !name.trim()}
            >
              {joining ? 'Joining…' : 'Join Call'}
            </button>
          </div>
        </>
      )}
      </div>
      {showMicSettings && devices.length > 0 && (
        <div
          className={styles.micSettingsOverlay}
          onClick={() => setShowMicSettings(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="call-join-mic-settings-title"
        >
          <div
            className={styles.micSettingsPopover}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.micSettingsPopoverHeader}>
              <h3 id="call-join-mic-settings-title" className={styles.micSettingsPopoverTitle}>
                Microphone settings
              </h3>
              <button
                type="button"
                className={styles.micSettingsPopoverClose}
                onClick={() => setShowMicSettings(false)}
                aria-label="Close"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>
            <div className={styles.micSettingsPopoverBody}>
              <div className={styles.micSelector}>
                <label className={styles.label} htmlFor="call-join-mic">
                  Microphone
                </label>
                <select
                  id="call-join-mic"
                  className={styles.select}
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                >
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.agcRow}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={autoGainControl}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      const id = deviceId || 'default';
                      setAutoGainControl(enabled);
                      localStorage.setItem(getAgcKey(id), String(enabled));
                    }}
                    aria-label="Auto Gain Control"
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Auto Gain Control</span>
                </label>
              </div>
              {!autoGainControl && (
                <div className={styles.volumeRow}>
                  <label className={styles.label} htmlFor="call-join-mic-volume">Volume</label>
                  <input
                    id="call-join-mic-volume"
                    type="range"
                    min={0}
                    max={800}
                    step={1}
                    value={Math.round((micVolume ?? 1) * 100)}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value, 10) / 100;
                      const clamped = Math.max(0, Math.min(8, Number.isFinite(raw) ? raw : 1));
                      setMicVolume(clamped);
                      localStorage.setItem(getMicVolumeKey(deviceId || 'default'), String(clamped));
                    }}
                    className={styles.volumeSlider}
                    aria-label="Microphone volume"
                  />
                  <span className={styles.volumeValue}>{Math.round((micVolume ?? 1) * 100)}%</span>
                </div>
              )}
              <div
                className={styles.micLevel}
                role="button"
                tabIndex={0}
                onClick={resumeAudioContext}
                onKeyDown={(e) => e.key === 'Enter' && resumeAudioContext()}
                title="Click if the bar doesn't move"
                aria-label="Microphone level - click to enable if needed"
              >
                <div className={styles.micLevelBar} style={{ width: `${micLevel}%` }} />
              </div>
              <div className={styles.listenRow}>
                <button
                  type="button"
                  className={styles.listenBtn}
                  onClick={toggleListenToSelf}
                  aria-pressed={listeningToSelf}
                  aria-label={listeningToSelf ? 'Stop listening to yourself' : 'Listen to yourself'}
                >
                  {listeningToSelf ? <Volume2 size={16} /> : <Mic size={16} />}
                  {listeningToSelf ? ' Stop listening' : ' Listen to yourself'}
                </button>
              </div>
              <p className={styles.micTestHint}>
                Speak to test your microphone. Level should move when you talk. Click the bar if it doesn&apos;t.
              </p>
              <button
                type="button"
                className={styles.micSettingsDone}
                onClick={() => setShowMicSettings(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

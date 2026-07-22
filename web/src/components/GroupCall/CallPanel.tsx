import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback';
import { Copy, PhoneOff, Users, User, Crown, Mic, Square, MicOff, UserX, Minimize2, Maximize2, Pencil, Check, MessageCircle, Music2, Settings, X, Phone } from 'lucide-react';
import { callWebSocketUrl, getActiveSession } from '../../api/call';
import { DEVICE_ID_KEY, getAgcKey, getMicVolumeKey } from '../../constants/micSettings';
import { formatDurationHMS } from '../../utils/format';
import { useMediasoupRoom } from '../../hooks/useMediasoupRoom';
import { useWakeLock } from '../../hooks/useWakeLock';
import { RemoteAudio, AudioUnlockBanner } from './RemoteAudio';
import { AudioUnlockProvider } from './AudioUnlockContext';
import { CallSoundboardPanel } from './CallSoundboardPanel';
import { CallSettingsPanel } from './CallSettingsPanel';
import { CallChatPanel, type ChatMessage } from './CallChatPanel';
import styles from './CallPanel.module.css';

export interface CallParticipant {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  muted?: boolean;
  /** When true, host muted this participant; host can unmute. When false, participant muted themselves; host cannot unmute. */
  mutedByHost?: boolean;
  source?: "phone";
}

export interface CallPanelProps {
  sessionId: string;
  joinUrl: string;
  /** 4-digit code for quick join from Dashboard. */
  joinCode?: string;
  /** When set with dial-in enabled, show phone number + code for PSTN guests. */
  dialInPhoneNumber?: string | null;
  dialInEnabled?: boolean;
  webrtcUrl?: string;
  roomId?: string;
  /** Host token for host-only WebRTC actions (soundboard). Only for host. */
  hostToken?: string;
  /** Participants from GET /call/session (hydrate before WS connects). */
  initialParticipants?: CallParticipant[];
  /** Episode id for REST participant sync fallback. */
  episodeId?: string;
  /** True when WebRTC is not available (service down or not configured). */
  mediaUnavailable?: boolean;
  onEnd: () => void;
  onCallEnded: () => void;
  onSegmentRecorded?: () => void;
  /** Called when recording state changes (stopped, segment added). Passes pendingSegmentIds and recordingActive for immediate UI update without waiting for API refetch. */
  onRecordingStateChange?: (args?: { pendingSegmentIds?: string[]; recordingActive?: boolean }) => void;
  /** When set, End call button triggers this (e.g. to show confirm dialog) instead of ending immediately. */
  onEndRequest?: () => void;
  /** Called with the actual end-call function (or null on unmount) so parent can invoke it when confirm dialog accepts. */
  onRegisterEndCall?: (endCall: (() => void) | null) => void;
  /** When true, Record segment button is disabled (e.g. owner out of disk space). */
  recordDisabled?: boolean;
  /** Message shown when recordDisabled (e.g. tooltip). */
  recordDisabledMessage?: string;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const DISPLAY_NAME_KEY = 'harborfm_call_display_name';
const SOUNDBOARD_VOLUME_KEY = 'harborfm_soundboard_volume';
/** Socket from a Strict Mode unmount that must be closed when the effect remounts. */
const pendingStrictModeSockets = new Map<string, WebSocket>();
/** Incremented on each CallPanel WS effect run; stale cleanups skip endCall. */
let callPanelConnectGeneration = 0;
/** Per-session connect count to detect React Strict Mode remount. */
const callPanelConnectCountBySession = new Map<string, number>();
const END_CALL_DELAY_MS = 200;

function defaultHostParticipant(name: string): CallParticipant {
  return { id: '__pending_host__', name: name || 'Host', isHost: true, joinedAt: Date.now() };
}

/** Drop optimistic placeholder when the server sent a real host. */
function normalizeParticipants(list: CallParticipant[]): CallParticipant[] {
  const hasRealHost = list.some((p) => p.isHost && p.id !== '__pending_host__');
  if (!hasRealHost) return list;
  return list.filter((p) => p.id !== '__pending_host__');
}

export function CallPanel({ sessionId, joinUrl, joinCode, dialInPhoneNumber, dialInEnabled, webrtcUrl, roomId, hostToken, initialParticipants, episodeId, mediaUnavailable, onEnd, onCallEnded, onSegmentRecorded, onRecordingStateChange, onEndRequest, onRegisterEndCall, recordDisabled = false, recordDisabledMessage }: CallPanelProps) {
  const [displayName, setDisplayName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(DISPLAY_NAME_KEY)?.trim() || '';
  });
  const [editingName, setEditingName] = useState(false);
  const [participants, setParticipants] = useState<CallParticipant[]>(() => initialParticipants ?? []);
  const [copied, setCopied] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingPending, setRecordingPending] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingProcessing, setRecordingProcessing] = useState(false);
  const [recordingProgressMessage, setRecordingProgressMessage] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [soundboardError, setSoundboardError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [webrtcUrlFromWs, setWebrtcUrlFromWs] = useState<string | undefined>(undefined);
  const [roomIdFromWs, setRoomIdFromWs] = useState<string | undefined>(undefined);
  const [hostTokenFromWs, setHostTokenFromWs] = useState<string | undefined>(undefined);
  const [alreadyInCall, setAlreadyInCall] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [soundboardMinimized, setSoundboardMinimized] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMinimized, setSettingsMinimized] = useState(false);
  const initialParticipantsRef = useRef(initialParticipants);
  useEffect(() => {
    initialParticipantsRef.current = initialParticipants;
  }, [initialParticipants]);
  const [deviceId, setDeviceId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(DEVICE_ID_KEY) || '';
  });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
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
  const [soundboardVolume, setSoundboardVolumeState] = useState(() => {
    if (typeof window === 'undefined') return 1;
    const stored = localStorage.getItem(SOUNDBOARD_VOLUME_KEY);
    if (stored == null) return 1;
    const v = parseFloat(stored);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  });
  const [isMobile, setIsMobile] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const migratedFromOtherTabRef = useRef(false);
  const displayNameInputRef = useRef<HTMLInputElement | null>(null);
  const chatOpenRef = useRef(chatOpen);
  const chatMinimizedRef = useRef(chatMinimized);
  const myParticipantIdRef = useRef<string | undefined>(undefined);
  chatOpenRef.current = chatOpen;
  chatMinimizedRef.current = chatMinimized;
  myParticipantIdRef.current = participants.find((p) => p.isHost)?.id;
  // When alreadyInCall, we must NOT connect to WebRTC - only the other tab should be in the room.
  // We'll connect after user clicks "Migrate" and we receive "joined".
  const effectiveWebrtcUrl = alreadyInCall ? undefined : (webrtcUrlFromWs ?? webrtcUrl);
  const effectiveRoomId = alreadyInCall ? undefined : (roomIdFromWs ?? roomId);
  const effectiveHostToken = alreadyInCall ? undefined : (hostTokenFromWs ?? hostToken);
  const myParticipant = participants.find((p) => p.isHost);
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
    refreshDevices();
    const handleDeviceChange = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
  }, [refreshDevices]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = deviceId || 'default';
    if (deviceId) localStorage.setItem(DEVICE_ID_KEY, deviceId);
    const agcStored = localStorage.getItem(getAgcKey(id));
    setAutoGainControl(agcStored === 'false' ? false : true);
    const volStored = localStorage.getItem(getMicVolumeKey(id));
    const v = parseFloat(volStored ?? '1');
    setMicVolume(Number.isFinite(v) ? Math.max(0, Math.min(8, v)) : 1);
  }, [deviceId]);

  useEffect(() => {
    if (!effectiveWebrtcUrl || !effectiveRoomId || !navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        refreshDevices();
      })
      .catch(() => {});
  }, [effectiveWebrtcUrl, effectiveRoomId, refreshDevices]);

  const { remoteTracks, remoteMicLevels, error: mediaError, ready: producerReady, micLevel, micBackgroundNotice, livePublisherIds, publishersTracked, setMuted, playSoundboard, stopSoundboard, setSoundboardVolume, soundboardVolumeFromRoom, resumeSoundboardContext, setSoundboardPanelOpen, onSoundboardStoppedRef, onSoundboardErrorRef, listenToSelf, toggleListenToSelf, stopListenToSelf, setProducerVolume, leaveRoom } = useMediasoupRoom(
    effectiveWebrtcUrl,
    effectiveRoomId,
    deviceId || undefined,
    myParticipant?.id ?? null,
    myParticipant?.name ?? null,
    effectiveHostToken,
    autoGainControl,
    micVolume,
  );

  const debouncedSetProducerVolume = useDebouncedCallback(setProducerVolume, 300);
  useWakeLock(true);

  useEffect(() => {
    setSoundboardPanelOpen(soundboardOpen);
    return () => setSoundboardPanelOpen(false);
  }, [soundboardOpen, setSoundboardPanelOpen]);

  useEffect(() => {
    if (!autoGainControl && producerReady) {
      debouncedSetProducerVolume(micVolume);
    }
  }, [autoGainControl, producerReady, micVolume, debouncedSetProducerVolume]);

  useEffect(() => {
    if ((!settingsOpen || settingsMinimized) && listenToSelf) {
      stopListenToSelf();
    }
  }, [settingsOpen, settingsMinimized, listenToSelf, stopListenToSelf]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const applyParticipantList = (list: CallParticipant[]) => {
    setParticipants(normalizeParticipants(list));
  };

  useEffect(() => {
    if (initialParticipants && initialParticipants.length > 0) {
      applyParticipantList(initialParticipants);
    }
  }, [initialParticipants, sessionId]);

  // REST fallback only while call WS is not connected (WS is authoritative once open).
  useEffect(() => {
    if (!episodeId || wsConnected) return;
    let cancelled = false;
    const syncFromApi = () => {
      getActiveSession(episodeId)
        .then((session) => {
          if (cancelled || !session?.participants?.length) return;
          applyParticipantList(session.participants as CallParticipant[]);
        })
        .catch(() => {});
    };
    syncFromApi();
    const id = setInterval(syncFromApi, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [episodeId, sessionId, wsConnected]);

  useEffect(() => {
    const connectGen = ++callPanelConnectGeneration;
    const sessionConnectCount = (callPanelConnectCountBySession.get(sessionId) ?? 0) + 1;
    callPanelConnectCountBySession.set(sessionId, sessionConnectCount);
    const strictModeRemount = sessionConnectCount > 1 || pendingStrictModeSockets.has(sessionId);
    const orphanWs = pendingStrictModeSockets.get(sessionId);
    if (orphanWs) {
      pendingStrictModeSockets.delete(sessionId);
      try {
        if (orphanWs.readyState === WebSocket.OPEN || orphanWs.readyState === WebSocket.CONNECTING) {
          orphanWs.close();
        }
      } catch {
        /* ignore */
      }
    }
    migratedFromOtherTabRef.current = false;
    setAlreadyInCall(false);
    setWsConnected(false);
    setWebrtcUrlFromWs(undefined);
    setRoomIdFromWs(undefined);
    setHostTokenFromWs(undefined);
    const hostName = localStorage.getItem(DISPLAY_NAME_KEY)?.trim() || '';
    const hydratedParticipants = initialParticipantsRef.current;
    const seed =
      hydratedParticipants && hydratedParticipants.length > 0
        ? hydratedParticipants
        : [defaultHostParticipant(hostName)];
    setParticipants(normalizeParticipants(seed));
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const url = callWebSocketUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;
      const connectTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }, 8000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        setWsConnected(true);
        const name = localStorage.getItem(DISPLAY_NAME_KEY)?.trim() || '';
        ws.send(JSON.stringify({ type: 'host', sessionId, name: name || undefined }));
        ws.send(JSON.stringify({ type: 'heartbeat' }));
      };

      ws.onmessage = (event) => {
        try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'alreadyInCall') {
          if (strictModeRemount && ws.readyState === WebSocket.OPEN) {
            migratedFromOtherTabRef.current = true;
            ws.send(JSON.stringify({ type: 'migrateHost' }));
            return;
          }
          migratedFromOtherTabRef.current = true;
          setAlreadyInCall(true);
        } else if (msg.type === 'joined') {
          const didMigrate = migratedFromOtherTabRef.current;
          migratedFromOtherTabRef.current = false;
          setAlreadyInCall(false);
          if (Array.isArray(msg.participants) && msg.participants.length > 0) {
            applyParticipantList(msg.participants as CallParticipant[]);
          }
          if (msg.webrtcUrl) setWebrtcUrlFromWs(msg.webrtcUrl);
          if (msg.roomId) setRoomIdFromWs(msg.roomId);
          if (msg.hostToken) setHostTokenFromWs(msg.hostToken);
          if (didMigrate && typeof BroadcastChannel !== 'undefined') {
            try {
              const senderId = crypto.randomUUID?.() ?? `migrate-${Date.now()}-${Math.random()}`;
              if (typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem(`harborfm-call-migrate-sender-${sessionId}`, senderId);
              }
              new BroadcastChannel('harborfm-call-migrate').postMessage({ type: 'call-migrated', sessionId, senderId });
            } catch {
              /* ignore */
            }
          }
          if (msg.recordingInProgress === true) {
            setRecording(true);
            setRecordingPending(false);
            setRecordingProcessing(false);
            const epoch = typeof msg.recordingStartedAtEpochMs === 'number' ? msg.recordingStartedAtEpochMs : Date.now();
            setRecordingSeconds(Math.max(0, Math.floor((Date.now() - epoch) / 1000)));
          }
          onRecordingStateChange?.({ pendingSegmentIds: msg.pendingSegmentIds ?? [], recordingActive: msg.recordingInProgress === true });
        } else if (msg.type === 'participants') {
          const list = (msg.participants ?? []) as CallParticipant[];
          if (list.length > 0) applyParticipantList(list);
        } else if (msg.type === 'participantJoined') {
          // participants broadcast usually follows; ignore to avoid duplicates before full list arrives
        } else if (msg.type === 'heartbeatAck' && Array.isArray(msg.participants)) {
          const list = msg.participants as CallParticipant[];
          if (list.length > 0) applyParticipantList(list);
        } else if (msg.type === 'callEnded') {
          onCallEnded();
        } else if (msg.type === 'error') {
          onCallEnded();
        } else if (msg.type === 'recordingStarted') {
          setRecording(true);
          setRecordingPending(false);
          setRecordingError(null);
          setRecordingSeconds(0);
          setRecordingProcessing(false);
          onRecordingStateChange?.({ pendingSegmentIds: msg.pendingSegmentIds ?? [], recordingActive: true });
        } else if (msg.type === 'recordingStopped') {
          const pendingSegmentIds = msg.pendingSegmentIds ?? [];
          setRecording(false);
          setRecordingPending(false);
          setRecordingError(null);
          setRecordingProcessing(true);
          setRecordingProgressMessage(null);
          onRecordingStateChange?.({ pendingSegmentIds, recordingActive: false });
        } else if (msg.type === 'recordingProgress') {
          setRecordingProgressMessage(msg.message ?? msg.stage ?? 'Processing…');
        } else if (msg.type === 'recordingError') {
          setRecording(false);
          setRecordingPending(false);
          setRecordingProcessing(false);
          setRecordingProgressMessage(null);
          setRecordingError(msg.error ?? 'Recording failed');
          onRecordingStateChange?.({ recordingActive: false });
        } else if (msg.type === 'recordingStopFailed') {
          setRecording(false);
          setRecordingPending(false);
          setRecordingProcessing(false);
          setRecordingProgressMessage(null);
          setRecordingError(msg.error ?? 'Failed to stop recording');
          onRecordingStateChange?.({ recordingActive: false });
        } else if (msg.type === 'segmentRecorded') {
          const pendingSegmentIds = (msg as { pendingSegmentIds?: string[] }).pendingSegmentIds ?? [];
          setRecording(false);
          setRecordingPending(false);
          setRecordingError(null);
          setRecordingProcessing(true);
          setRecordingProgressMessage('Segment added successfully');
          onSegmentRecorded?.();
          onRecordingStateChange?.({ pendingSegmentIds, recordingActive: false });
          setTimeout(() => {
            setRecordingProcessing(false);
            setRecordingProgressMessage(null);
          }, 2000);
        } else if (msg.type === 'setMute') {
          setMuted(msg.muted === true);
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
            const chatVisible = chatOpenRef.current && !chatMinimizedRef.current;
            const tabHasFocus = typeof document !== 'undefined' && document.hasFocus();
            if (!chatVisible || !tabHasFocus) setChatUnread(true);
          }
        }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        clearTimeout(connectTimeout);
        if (wsRef.current === ws) {
          setWsConnected(false);
          onCallEnded();
        }
      };

      ws.onerror = () => {
        clearTimeout(connectTimeout);
        if (wsRef.current === ws) onCallEnded();
      };

      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, HEARTBEAT_INTERVAL_MS);
    });

    return () => {
      leaveRoom();
      cancelled = true;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      const wsToClose = wsRef.current;
      wsRef.current = null;
      if (wsToClose) {
        pendingStrictModeSockets.set(sessionId, wsToClose);
        try {
          if (wsToClose.readyState === WebSocket.OPEN || wsToClose.readyState === WebSocket.CONNECTING) {
            wsToClose.close();
          }
        } catch {
          /* ignore */
        }
      }
      const cleanupGen = connectGen;
      setTimeout(() => {
        pendingStrictModeSockets.delete(sessionId);
        if (callPanelConnectGeneration !== cleanupGen) return;
        if (wsToClose?.readyState === WebSocket.OPEN) {
          wsToClose.send(JSON.stringify({ type: 'endCall' }));
          wsToClose.close();
        }
      }, END_CALL_DELAY_MS);
    };
  }, [sessionId, onCallEnded, onSegmentRecorded, onRecordingStateChange, setMuted, leaveRoom]);

  const showMediaUnavailable = mediaUnavailable && !effectiveWebrtcUrl && !effectiveRoomId;
  const showChatView = isMobile && chatOpen;
  const showSoundboardView = isMobile && soundboardOpen;
  const showSettingsView = isMobile && settingsOpen;

  const handleDisplayNameSave = (name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      setDisplayName(trimmed);
      if (typeof window !== 'undefined') {
        localStorage.setItem(DISPLAY_NAME_KEY, trimmed);
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'updateHostName', name: trimmed }));
      }
    }
    setEditingName(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleEndCall = useCallback(() => {
    callPanelConnectCountBySession.delete(sessionId);
    leaveRoom();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'endCall' }));
      wsRef.current.close();
    }
    onEnd();
  }, [onEnd, leaveRoom, sessionId]);

  useEffect(() => {
    onRegisterEndCall?.(handleEndCall);
    return () => onRegisterEndCall?.(null);
  }, [onRegisterEndCall, handleEndCall]);

  const handleStartRecording = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setRecordingError('Call connection not ready. Wait a moment and try again.');
      return;
    }
    if (!recordingPending) {
      setRecordingPending(true);
      setRecordingError(null);
      ws.send(JSON.stringify({ type: 'startRecording', clientEpochMs: Date.now() }));
    }
  };

  const handleStopRecording = () => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stopRecording' }));
      setRecording(false);
    }
  };

  const handleSetMute = (participantId: string, muted: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'setMute', participantId, muted }));
    }
  };

  const handleDisconnect = (participantId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'disconnectParticipant', participantId }));
    }
  };

  const handleChatSend = (text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat', text }));
    }
  };

  const handleChatOpen = () => {
    if (isMobile && minimized) {
      setMinimized(false);
      setSoundboardOpen(false);
      setSettingsOpen(false);
      setChatOpen(true);
      return;
    }
    setChatOpen((prev) => {
      if (!prev && isMobile) {
        setSoundboardOpen(false);
        setSettingsOpen(false);
      }
      return !prev;
    });
  };

  const handleSoundboardOpen = () => {
    if (isMobile && minimized) {
      setMinimized(false);
      setChatOpen(false);
      setSettingsOpen(false);
      setSoundboardOpen(true);
      resumeSoundboardContext();
      return;
    }
    setSoundboardOpen((prev) => {
      if (!prev) {
        if (isMobile) {
          setChatOpen(false);
          setSettingsOpen(false);
        }
        resumeSoundboardContext();
      }
      return !prev;
    });
  };

  const handleSettingsOpen = () => {
    if (isMobile && minimized) {
      setMinimized(false);
      setChatOpen(false);
      setSoundboardOpen(false);
      setSettingsOpen(true);
      return;
    }
    setSettingsOpen((prev) => {
      if (!prev && isMobile) {
        setChatOpen(false);
        setSoundboardOpen(false);
      }
      return !prev;
    });
  };

  const handleSoundboardVolumeChange = (volume: number) => {
    setSoundboardVolumeState(volume);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SOUNDBOARD_VOLUME_KEY, String(volume));
    }
  };

  const handleAutoGainControlChange = (enabled: boolean) => {
    const key = getAgcKey(deviceId || 'default');
    setAutoGainControl(enabled);
    if (typeof window !== 'undefined') {
      localStorage.setItem(key, String(enabled));
    }
  };

  const handleMicVolumeChange = (volume: number) => {
    setMicVolume(volume);
    if (typeof window !== 'undefined' && deviceId) {
      localStorage.setItem(getMicVolumeKey(deviceId), String(volume));
    }
  };

  const handleMigrate = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'migrateHost' }));
    }
  };

  const handleRecordingEvent = (ev: { event: string; assetId?: string; clientTimestampMs?: number; durationSec?: number }) => {
    if (recording && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'recordingEvent', ...ev }));
    }
  };

  if (alreadyInCall) {
    return (
      <div className={styles.panel} role="region" aria-label={`Group call (${participants.length} participants)`} data-testid="already-in-call-panel">
        <div className={styles.header}>
          <Users size={18} strokeWidth={2} aria-hidden />
          <span className={styles.title}>Call ({participants.length})</span>
        </div>
        <p className={styles.alreadyInCallMessage}>
          This user is already in the call in another tab.
        </p>
        <button
          type="button"
          className={styles.migrateBtn}
          onClick={handleMigrate}
          aria-label="Migrate call to this tab"
        >
          Migrate call to this tab
        </button>
      </div>
    );
  }

  const panelContent = (
    <AudioUnlockProvider>
    <div className={styles.panel} role="region" aria-label={`Group call (${participants.length} participants)`} data-minimized={minimized || undefined}>
      <div className={styles.header}>
        <Users size={18} strokeWidth={2} aria-hidden />
        <span className={styles.title}>Call ({participants.length})</span>
        <span className={styles.headerSpacer} />
        <button
          type="button"
          className={`${styles.iconBtn} ${chatOpen ? styles.iconBtnActive : ''} ${chatUnread && !chatOpen ? styles.iconBtnUnread : ''}`}
          onClick={handleChatOpen}
          aria-label={chatOpen ? 'Close chat' : 'Open chat'}
          title={chatOpen ? 'Close chat' : chatUnread ? 'New messages' : 'Open chat'}
          data-testid="chat-open-btn"
        >
          {showChatView ? <X size={16} strokeWidth={2} aria-hidden /> : <MessageCircle size={16} strokeWidth={2} aria-hidden />}
        </button>
        <button
          type="button"
          className={`${styles.iconBtn} ${soundboardOpen ? styles.iconBtnActive : ''}`}
          onClick={handleSoundboardOpen}
          aria-label={soundboardOpen ? 'Close soundboard' : 'Open soundboard'}
          title={soundboardOpen ? 'Close soundboard' : 'Open soundboard'}
          data-testid="soundboard-open-btn"
        >
          {showSoundboardView ? <X size={16} strokeWidth={2} aria-hidden /> : <Music2 size={16} strokeWidth={2} aria-hidden />}
        </button>
        <button
          type="button"
          className={`${styles.iconBtn} ${settingsOpen ? styles.iconBtnActive : ''}`}
          onClick={handleSettingsOpen}
          aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
          title={settingsOpen ? 'Close settings' : 'Open settings'}
          data-testid="settings-open-btn"
        >
          {showSettingsView ? <X size={16} strokeWidth={2} aria-hidden /> : <Settings size={16} strokeWidth={2} aria-hidden />}
        </button>
        {!showChatView && !showSoundboardView && !showSettingsView && (
        <button
          type="button"
          className={styles.endBtnHeader}
          onClick={onEndRequest ?? handleEndCall}
          aria-label="End call"
          title="End call"
        >
          <PhoneOff size={16} strokeWidth={2} aria-hidden />
        </button>
        )}
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setMinimized(!minimized)}
          aria-label={minimized ? 'Maximize' : 'Minimize'}
          title={minimized ? 'Maximize' : 'Minimize'}
        >
          {minimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
        </button>
      </div>
      {!minimized && (showMediaUnavailable || mediaError || recordingError || soundboardError) && (
        <div className={styles.errorCard} role="alert">
          {showMediaUnavailable && (
            <p className={styles.errorCardMessage}>
              Audio is unavailable - WebRTC service is not running or unreachable. Guests can join the call but won&apos;t have audio until the service is started.
            </p>
          )}
          {mediaError && <p className={styles.errorCardMessage}>{mediaError}</p>}
          {recordingError && <p className={styles.errorCardMessage}>{recordingError}</p>}
          {soundboardError && <p className={styles.errorCardMessage}>{soundboardError}</p>}
        </div>
      )}
      {!minimized && micBackgroundNotice && (
        <p className={styles.micBackgroundNotice} role="status" aria-live="polite">
          {micBackgroundNotice}
        </p>
      )}
      {!minimized && !showChatView && !showSoundboardView && !showSettingsView && (
      <>
      <div className={styles.joinRow}>
        <input
          type="text"
          readOnly
          value={joinUrl}
          className={styles.joinInput}
          aria-label="Join link"
        />
        <button
          type="button"
          className={styles.copyBtn}
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy join link'}
          title="Copy link"
        >
          <Copy size={16} strokeWidth={2} />
          {copied ? ' Copied' : ' Copy'}
        </button>
      </div>
      {joinCode && (
        <div className={styles.joinCodeCard} data-testid="call-join-code-card">
          <span className={styles.joinCodeLabel}>Join code</span>
          <span className={styles.joinCodeValue} data-testid="call-join-code-value">{joinCode}</span>
        </div>
      )}
      {dialInEnabled && dialInPhoneNumber && joinCode && (
        <div className={styles.dialInCard} data-testid="call-dial-in-card">
          <span className={styles.joinCodeLabel}>Phone dial-in</span>
          <span className={styles.dialInNumber} data-testid="call-dial-in-number">
            {dialInPhoneNumber}
          </span>
        </div>
      )}
      <div className={styles.participants}>
        <span className={styles.participantsLabel}>
          Participants ({participants.length})
        </span>
        {participants.length === 0 ? (
          <p className={styles.noParticipants}>No participants yet</p>
        ) : (
        <ul className={styles.participantsList}>
          {[...participants]
            .sort((a, b) => (a.isHost === b.isHost ? 0 : a.isHost ? -1 : 1))
            .map((p) => {
              const showMuted =
                Boolean(p.muted) ||
                (publishersTracked &&
                  Boolean(effectiveWebrtcUrl) &&
                  !livePublisherIds.has(p.id));
              return (
            <li key={p.id} className={styles.participantCard} data-host={p.isHost || undefined} data-source={p.source || undefined} data-testid={p.source === 'phone' ? 'call-participant-phone' : undefined}>
              <span className={styles.participantRoleIcon} aria-hidden>
                {p.isHost ? <Crown size={14} /> : p.source === 'phone' ? <Phone size={14} /> : <User size={14} />}
              </span>
              <span className={styles.participantInfo}>
                {p.isHost ? (
                  <>
                    <button
                      type="button"
                      className={styles.participantEditBtn}
                      onClick={() => setEditingName(true)}
                      aria-label="Edit your name"
                      title="Edit your name"
                    >
                      <Pencil size={10} />
                    </button>
                    {editingName ? (
                      <span className={styles.displayNameEditRow}>
                        <input
                          ref={(el) => { displayNameInputRef.current = el; }}
                          type="text"
                          className={styles.displayNameInput}
                          defaultValue={displayName}
                          placeholder="Enter your name"
                          maxLength={100}
                          autoFocus
                          onBlur={(e) => handleDisplayNameSave(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleDisplayNameSave((e.target as HTMLInputElement).value);
                            } else if (e.key === 'Escape') {
                              setEditingName(false);
                            }
                          }}
                          aria-label="Your display name"
                        />
                        <button
                          type="button"
                          className={`${styles.participantEditBtn} ${styles.saveBtn}`}
                          onClick={() => {
                            const val = displayNameInputRef.current?.value;
                            handleDisplayNameSave(val ?? '');
                          }}
                          aria-label="Save name"
                          title="Save name"
                        >
                          <Check size={10} />
                        </button>
                      </span>
                    ) : (
                      <span className={styles.participantNameBlock}>
                        {showMuted && (
                          <span className={styles.mutedBadge}>
                            <MicOff size={10} />
                            Muted
                          </span>
                        )}
                        <span className={styles.participantName} title={displayName || p.name}>
                          {displayName || p.name}
                        </span>
                      </span>
                    )}
                  </>
                ) : (
                  <span className={styles.participantNameBlock}>
                    {showMuted && (
                      <span className={styles.mutedBadge}>
                        <MicOff size={10} />
                        Muted
                      </span>
                    )}
                    <span className={styles.participantName} title={p.name}>
                      {p.name}
                    </span>
                  </span>
                )}
              </span>
              <span className={styles.participantActions}>
                {!p.isHost && (
                  <button
                    type="button"
                    className={styles.disconnectBtn}
                    onClick={() => handleDisconnect(p.id)}
                    aria-label="Disconnect"
                    title="Disconnect"
                  >
                    <UserX size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.muteBtn}
                  onClick={() => handleSetMute(p.id, !p.muted)}
                  disabled={
                    (p.isHost && (!effectiveWebrtcUrl || !producerReady))
                    || (p.muted && !p.isHost && p.mutedByHost === false)
                  }
                  aria-label={p.muted ? (p.isHost ? 'Unmute yourself' : 'Unmute') : (p.isHost ? 'Mute yourself' : 'Mute')}
                  title={
                    p.muted && !p.isHost && p.mutedByHost === false
                      ? 'Guest muted themselves'
                      : p.muted
                        ? 'Unmute'
                        : 'Mute'
                  }
                >
                  {p.muted ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              </span>
              <div className={styles.participantMicLevel} role="img" aria-label="Microphone level">
                <div className={styles.micLevelBar} style={{ width: `${showMuted ? 0 : (p.isHost ? micLevel : (remoteMicLevels.get(p.id) ?? 0))}%` }} />
              </div>
            </li>
              );
          })}
        </ul>
        )}
      </div>
      </>
      )}
      {/* RemoteAudio must stay mounted when soundboard/chat is open on mobile so audio plays */}
      {!minimized &&
        Array.from(remoteTracks.entries()).map(([id, info]) => (
          <RemoteAudio
            key={id}
            track={info.track}
            volume={info.source === 'soundboard' ? (effectiveHostToken ? soundboardVolume : soundboardVolumeFromRoom) : 1}
          />
        ))}
      {!minimized && showChatView && (
        <CallChatPanel
          messages={chatMessages}
          onSend={handleChatSend}
          minimized={false}
          onMinimizeToggle={() => {}}
          embedded
          onInteract={() => setChatUnread(false)}
        />
      )}
      {!minimized && showSoundboardView && (
        <CallSoundboardPanel
          playSoundboard={playSoundboard}
          stopSoundboard={stopSoundboard}
          setSoundboardVolume={setSoundboardVolume}
          onSoundboardStoppedRef={onSoundboardStoppedRef}
          onSoundboardErrorRef={onSoundboardErrorRef}
          onSoundboardError={setSoundboardError}
          onPlayAttempt={() => setSoundboardError(null)}
          disabled={!effectiveWebrtcUrl || !producerReady}
          minimized={false}
          onMinimizeToggle={() => {}}
          volume={soundboardVolume}
          onVolumeChange={handleSoundboardVolumeChange}
          recording={recording}
          onRecordingEvent={handleRecordingEvent}
          embedded
        />
      )}
      {!minimized && showSettingsView && (
        <CallSettingsPanel
          devices={devices}
          deviceId={deviceId}
          onDeviceChange={setDeviceId}
          onClose={() => setSettingsOpen(false)}
          minimized={false}
          onMinimizeToggle={() => {}}
          listenToSelf={listenToSelf}
          onListenToSelfToggle={toggleListenToSelf}
          listenToSelfDisabled={!effectiveWebrtcUrl || !producerReady}
          autoGainControl={autoGainControl}
          onAutoGainControlChange={handleAutoGainControlChange}
          micVolume={micVolume}
          onMicVolumeChange={handleMicVolumeChange}
          embedded
        />
      )}
      {!showChatView && !showSoundboardView && !showSettingsView && (
      <div className={styles.recordSection}>
        <div className={`${styles.recordRow} ${recording ? styles.recordRowRecording : styles.recordRowIdle}`}>
          {recording ? (
            <>
              <button
                type="button"
                className={styles.stopRecordBtn}
                onClick={handleStopRecording}
                aria-label="Stop recording"
              >
                <Square size={16} strokeWidth={2} aria-hidden />
                Stop recording
              </button>
              <span className={styles.recordDurationBadge} aria-live="polite">
                {formatDurationHMS(recordingSeconds)}
              </span>
            </>
          ) : recordingPending ? (
            <span className={styles.recordPending}>Starting…</span>
          ) : (
            <button
              type="button"
              className={styles.recordSegmentBtn}
              onClick={handleStartRecording}
              disabled={recordDisabled || !wsConnected}
              title={
                !wsConnected
                  ? 'Connecting to call…'
                  : recordDisabled
                    ? recordDisabledMessage
                    : undefined
              }
              aria-label={
                recordDisabled
                  ? (recordDisabledMessage ? `Record segment: ${recordDisabledMessage}` : 'Record segment from call (disabled)')
                  : 'Record segment from call'
              }
              data-producer-ready={effectiveWebrtcUrl && producerReady ? 'true' : undefined}
            >
              <Mic size={16} strokeWidth={2} aria-hidden />
              Record Segment
            </button>
          )}
        </div>
        {!minimized && recordingProcessing && (
          <p className={styles.recordingProcessing} role="status">
            {recordingProgressMessage ||
              "Recording stopped successfully. We're now processing the segment. It should be added shortly."}
          </p>
        )}
      </div>
      )}
      {!minimized && <AudioUnlockBanner />}
    </div>
    </AudioUnlockProvider>
  );

  if (!isMobile) {
    return (
      <div className={styles.panelsWrapper}>
        {panelContent}
        {chatOpen && (
          <div className={styles.chatPanelInWrapper}>
            <CallChatPanel
              messages={chatMessages}
              onSend={handleChatSend}
              minimized={chatMinimized}
              onMinimizeToggle={() => setChatMinimized((m) => !m)}
              onClose={() => setChatOpen(false)}
              onInteract={() => setChatUnread(false)}
              unread={chatUnread}
            />
          </div>
        )}
        {soundboardOpen && (
          <div className={styles.soundboardPanelInWrapper}>
            <CallSoundboardPanel
              playSoundboard={playSoundboard}
              stopSoundboard={stopSoundboard}
              setSoundboardVolume={setSoundboardVolume}
              onSoundboardStoppedRef={onSoundboardStoppedRef}
              onSoundboardErrorRef={onSoundboardErrorRef}
              onSoundboardError={setSoundboardError}
              onPlayAttempt={() => setSoundboardError(null)}
              disabled={!effectiveWebrtcUrl || !producerReady}
              onClose={() => setSoundboardOpen(false)}
              minimized={soundboardMinimized}
              onMinimizeToggle={() => setSoundboardMinimized((m) => !m)}
              volume={soundboardVolume}
              onVolumeChange={handleSoundboardVolumeChange}
              recording={recording}
              onRecordingEvent={handleRecordingEvent}
            />
          </div>
        )}
        {settingsOpen && (
          <div className={styles.settingsPanelInWrapper}>
            <CallSettingsPanel
              devices={devices}
              deviceId={deviceId}
              onDeviceChange={setDeviceId}
              onClose={() => setSettingsOpen(false)}
              minimized={settingsMinimized}
              onMinimizeToggle={() => setSettingsMinimized((m) => !m)}
              listenToSelf={listenToSelf}
              onListenToSelfToggle={toggleListenToSelf}
              listenToSelfDisabled={!effectiveWebrtcUrl || !producerReady}
              autoGainControl={autoGainControl}
              onAutoGainControlChange={handleAutoGainControlChange}
              micVolume={micVolume}
              onMicVolumeChange={handleMicVolumeChange}
            />
          </div>
        )}
      </div>
    );
  }

  return panelContent;
}

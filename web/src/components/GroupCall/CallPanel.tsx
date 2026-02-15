import { useEffect, useRef, useState } from 'react';
import { Copy, PhoneOff, Users, User, Crown, Mic, Square, MicOff, UserX, Minimize2, Maximize2, Pencil, Check, MessageCircle, X } from 'lucide-react';
import { callWebSocketUrl } from '../../api/call';
import { formatDurationHMS } from '../../utils/format';
import { useMediasoupRoom } from '../../hooks/useMediasoupRoom';
import { RemoteAudio } from './RemoteAudio';
import { CallSoundboard } from './CallSoundboard';
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
}

export interface CallPanelProps {
  sessionId: string;
  joinUrl: string;
  /** 4-digit code for quick join from Dashboard. */
  joinCode?: string;
  webrtcUrl?: string;
  roomId?: string;
  /** True when WebRTC is not available (service down or not configured). */
  mediaUnavailable?: boolean;
  onEnd: () => void;
  onCallEnded: () => void;
  onSegmentRecorded?: () => void;
  /** When set, End call button triggers this (e.g. to show confirm dialog) instead of ending immediately. */
  onEndRequest?: () => void;
  /** When true, Record segment button is disabled (e.g. owner out of disk space). */
  recordDisabled?: boolean;
  /** Message shown when recordDisabled (e.g. tooltip). */
  recordDisabledMessage?: string;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const DISPLAY_NAME_KEY = 'harborfm_call_display_name';

export function CallPanel({ sessionId, joinUrl, joinCode, webrtcUrl, roomId, mediaUnavailable, onEnd, onCallEnded, onSegmentRecorded, onEndRequest, recordDisabled = false, recordDisabledMessage }: CallPanelProps) {
  const [displayName, setDisplayName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(DISPLAY_NAME_KEY)?.trim() || '';
  });
  const [editingName, setEditingName] = useState(false);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [copied, setCopied] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingProcessing, setRecordingProcessing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [webrtcUrlFromWs, setWebrtcUrlFromWs] = useState<string | undefined>(undefined);
  const [roomIdFromWs, setRoomIdFromWs] = useState<string | undefined>(undefined);
  const [alreadyInCall, setAlreadyInCall] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const displayNameInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveWebrtcUrl = webrtcUrlFromWs ?? webrtcUrl;
  const effectiveRoomId = roomIdFromWs ?? roomId;
  const { remoteTracks, error: mediaError, ready: producerReady, micLevel, setMuted, connectSoundboard } = useMediasoupRoom(
    effectiveWebrtcUrl,
    effectiveRoomId,
  );
  const showMediaUnavailable = mediaUnavailable && !effectiveWebrtcUrl && !effectiveRoomId;
  const showChatView = isMobile && chatOpen;

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

  useEffect(() => {
    setAlreadyInCall(false);
    setWebrtcUrlFromWs(undefined);
    setRoomIdFromWs(undefined);
    const url = callWebSocketUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      const name = localStorage.getItem(DISPLAY_NAME_KEY)?.trim() || '';
      ws.send(JSON.stringify({ type: 'host', sessionId, name: name || undefined }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'alreadyInCall') {
          setAlreadyInCall(true);
        } else if (msg.type === 'joined' && msg.participants) {
          setAlreadyInCall(false);
          setParticipants(msg.participants);
          if (msg.webrtcUrl) setWebrtcUrlFromWs(msg.webrtcUrl);
          if (msg.roomId) setRoomIdFromWs(msg.roomId);
        } else if (msg.type === 'participants') {
          setParticipants(msg.participants ?? []);
        } else if (msg.type === 'participantJoined') {
          setParticipants((prev) => {
            const p = msg.participant;
            if (p && !prev.some((x) => x.id === p.id)) return [...prev, p];
            return prev;
          });
        } else if (msg.type === 'callEnded') {
          onCallEnded();
        } else if (msg.type === 'error') {
          onCallEnded();
        } else if (msg.type === 'recordingStarted') {
          setRecording(true);
          setRecordingSeconds(0);
          setRecordingProcessing(false);
        } else if (msg.type === 'recordingStopped') {
          setRecording(false);
          setRecordingError(null);
          setRecordingProcessing(true);
        } else if (msg.type === 'recordingError') {
          setRecording(false);
          setRecordingProcessing(false);
          setRecordingError(msg.error ?? 'Recording failed');
        } else if (msg.type === 'recordingStopFailed') {
          setRecording(false);
          setRecordingProcessing(false);
          setRecordingError(msg.error ?? 'Failed to stop recording');
        } else if (msg.type === 'segmentRecorded') {
          setRecording(false);
          setRecordingError(null);
          setRecordingProcessing(false);
          onSegmentRecorded?.();
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
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) onCallEnded();
    };

    ws.onerror = () => {
      if (wsRef.current === ws) onCallEnded();
    };

    heartbeatRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      wsRef.current = null;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'endCall' }));
        ws.close();
      }
    };
  }, [sessionId, onCallEnded, onSegmentRecorded, setMuted]);

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

  const handleEndCall = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'endCall' }));
      wsRef.current.close();
    }
    onEnd();
  };

  const handleStartRecording = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'startRecording' }));
      setRecording(true);
    }
  };

  const handleStopRecording = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stopRecording' }));
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
    setChatOpen((prev) => !prev);
  };

  const handleMigrate = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'migrateHost' }));
    }
  };

  if (alreadyInCall) {
    return (
      <div className={styles.panel} role="region" aria-label={`Group call (${participants.length} participants)`} data-testid="already-in-call-panel">
        <div className={styles.header}>
          <Users size={18} strokeWidth={2} aria-hidden />
          <span className={styles.title}>Group Call ({participants.length})</span>
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
    <div className={styles.panel} role="region" aria-label={`Group call (${participants.length} participants)`} data-minimized={minimized || undefined}>
      <div className={styles.header}>
        <Users size={18} strokeWidth={2} aria-hidden />
        <span className={styles.title}>Group Call ({participants.length})</span>
        <span className={styles.headerSpacer} />
        <button
          type="button"
          className={styles.iconBtn}
          onClick={handleChatOpen}
          aria-label={chatOpen ? 'Close chat' : 'Open chat'}
          title={chatOpen ? 'Close chat' : 'Open chat'}
          data-testid="chat-open-btn"
        >
          {showChatView ? <X size={16} strokeWidth={2} aria-hidden /> : <MessageCircle size={16} strokeWidth={2} aria-hidden />}
        </button>
        {!showChatView && (
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
      {!minimized && showMediaUnavailable && (
        <p className={styles.mediaUnavailableBanner} role="status">
          Audio is unavailable - WebRTC service is not running or unreachable. Guests can join the call but won&apos;t have audio until the service is started.
        </p>
      )}
      {!minimized && !showChatView && (
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
      <div className={styles.participants}>
        <CallSoundboard
          connectSoundboard={connectSoundboard}
          disabled={!effectiveWebrtcUrl || !producerReady}
        />
        <div
          className={styles.micLevel}
          role="img"
          aria-label="Microphone level"
          title="Your microphone level"
        >
          <div className={styles.micLevelBar} style={{ width: `${micLevel}%` }} />
        </div>
        <span className={styles.participantsLabel}>
          Participants ({participants.length})
        </span>
        {participants.length === 0 ? (
          <p className={styles.noParticipants}>No participants yet</p>
        ) : (
        <ul className={styles.participantsList}>
          {[...participants]
            .sort((a, b) => (a.isHost === b.isHost ? 0 : a.isHost ? -1 : 1))
            .map((p) => (
            <li key={p.id} className={styles.participantCard} data-host={p.isHost || undefined}>
              <span className={styles.participantRoleIcon} aria-hidden>
                {p.isHost ? <Crown size={14} /> : <User size={14} />}
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
                        {p.muted && (
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
                    {p.muted && (
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
              </span>
            </li>
          ))}
        </ul>
        )}
        {mediaError && (
          <p className={styles.mediaError}>{mediaError}</p>
        )}
        {Array.from(remoteTracks.entries()).map(([id, track]) => (
          <RemoteAudio key={id} track={track} />
        ))}
      </div>
      </>
      )}
      {!minimized && showChatView && (
        <CallChatPanel
          messages={chatMessages}
          onSend={handleChatSend}
          minimized={false}
          onMinimizeToggle={() => {}}
          embedded
        />
      )}
      {!showChatView && (
      <div className={styles.recordSection}>
        <div className={`${styles.recordRow} ${recording ? styles.recordRowRecording : ''}`}>
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
          ) : (
            <button
              type="button"
              className={styles.recordSegmentBtn}
              onClick={handleStartRecording}
              disabled={recordDisabled}
              title={recordDisabled ? recordDisabledMessage : undefined}
              aria-label={
                recordDisabled
                  ? (recordDisabledMessage ? `Record segment: ${recordDisabledMessage}` : 'Record segment from call (disabled)')
                  : 'Record segment from call'
              }
              data-producer-ready={effectiveWebrtcUrl && producerReady ? 'true' : undefined}
            >
              <Mic size={16} strokeWidth={2} aria-hidden />
              Record segment
            </button>
          )}
        </div>
        {!minimized && recordingProcessing && (
          <p className={styles.recordingProcessing} role="status">
            Recording stopped successfully. We&apos;re now processing the segment. It should be added shortly.
          </p>
        )}
        {!minimized && recordingError && (
          <p className={styles.mediaError}>{recordingError}</p>
        )}
      </div>
      )}
    </div>
  );

  if (chatOpen && !isMobile) {
    return (
      <div className={styles.panelsWrapper}>
        {panelContent}
        <div className={styles.chatPanelInWrapper}>
        <CallChatPanel
          messages={chatMessages}
          onSend={handleChatSend}
          minimized={chatMinimized}
          onMinimizeToggle={() => setChatMinimized((m) => !m)}
          onClose={() => setChatOpen(false)}
        />
        </div>
      </div>
    );
  }

  return panelContent;
}

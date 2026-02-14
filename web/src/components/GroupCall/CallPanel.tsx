import { useEffect, useRef, useState } from 'react';
import { Copy, PhoneOff, Users, Mic, Square, MicOff, UserX } from 'lucide-react';
import { callWebSocketUrl } from '../../api/call';
import { useMediasoupRoom } from '../../hooks/useMediasoupRoom';
import { RemoteAudio } from './RemoteAudio';
import styles from './CallPanel.module.css';

export interface CallParticipant {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  muted?: boolean;
}

export interface CallPanelProps {
  sessionId: string;
  joinUrl: string;
  webrtcUrl?: string;
  roomId?: string;
  /** True when WebRTC is not available (service down or not configured). */
  mediaUnavailable?: boolean;
  onEnd: () => void;
  onCallEnded: () => void;
  onSegmentRecorded?: () => void;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export function CallPanel({ sessionId, joinUrl, webrtcUrl, roomId, mediaUnavailable, onEnd, onCallEnded, onSegmentRecorded }: CallPanelProps) {
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [copied, setCopied] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingProcessing, setRecordingProcessing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [webrtcUrlFromWs, setWebrtcUrlFromWs] = useState<string | undefined>(undefined);
  const [roomIdFromWs, setRoomIdFromWs] = useState<string | undefined>(undefined);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const effectiveWebrtcUrl = webrtcUrlFromWs ?? webrtcUrl;
  const effectiveRoomId = roomIdFromWs ?? roomId;
  const { remoteTracks, error: mediaError, ready: producerReady, setMuted } = useMediasoupRoom(
    effectiveWebrtcUrl,
    effectiveRoomId,
  );
  const showMediaUnavailable = mediaUnavailable && !effectiveWebrtcUrl && !effectiveRoomId;

  useEffect(() => {
    setWebrtcUrlFromWs(undefined);
    setRoomIdFromWs(undefined);
    const url = callWebSocketUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'host', sessionId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'joined' && msg.participants) {
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
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      onCallEnded();
    };

    ws.onerror = () => {
      onCallEnded();
    };

    heartbeatRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'endCall' }));
        ws.close();
      }
      wsRef.current = null;
    };
  }, [sessionId, onCallEnded]);

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

  return (
    <div className={styles.panel} role="region" aria-label="Group call">
      <div className={styles.header}>
        <Users size={18} strokeWidth={2} aria-hidden />
        <span className={styles.title}>Group call</span>
      </div>
      {showMediaUnavailable && (
        <p className={styles.mediaUnavailableBanner} role="status">
          Audio is unavailable — WebRTC service is not running or unreachable. Guests can join the call but won&apos;t have audio until the service is started.
        </p>
      )}
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
      <div className={styles.participants}>
        <span className={styles.participantsLabel}>
          Participants ({participants.length})
        </span>
        <ul className={styles.participantsList}>
          {participants.map((p) => (
            <li key={p.id} className={styles.participant}>
              <span className={styles.participantName}>
                {p.name}
                {p.isHost && ' (Host)'}
                {p.muted && ' (muted)'}
              </span>
              {!p.isHost && (
                <span className={styles.participantActions}>
                  <button
                    type="button"
                    className={styles.muteBtn}
                    onClick={() => handleSetMute(p.id, !p.muted)}
                    aria-label={p.muted ? 'Unmute' : 'Mute'}
                    title={p.muted ? 'Unmute' : 'Mute'}
                  >
                    {p.muted ? <MicOff size={14} /> : <Mic size={14} />}
                  </button>
                  <button
                    type="button"
                    className={styles.disconnectBtn}
                    onClick={() => handleDisconnect(p.id)}
                    aria-label="Disconnect"
                    title="Disconnect"
                  >
                    <UserX size={14} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {mediaError && (
          <p className={styles.mediaError}>{mediaError}</p>
        )}
        {Array.from(remoteTracks.entries()).map(([id, track]) => (
          <RemoteAudio key={id} track={track} />
        ))}
      </div>
      <div className={styles.recordSection}>
        <div className={styles.recordRow}>
          {recording ? (
            <button
              type="button"
              className={styles.stopRecordBtn}
              onClick={handleStopRecording}
              aria-label="Stop recording"
            >
              <Square size={16} strokeWidth={2} aria-hidden />
              Stop recording
            </button>
          ) : (
            <button
              type="button"
              className={styles.recordSegmentBtn}
              onClick={handleStartRecording}
              aria-label="Record segment from call"
              data-producer-ready={effectiveWebrtcUrl && producerReady ? 'true' : undefined}
            >
              <Mic size={16} strokeWidth={2} aria-hidden />
              Record segment
            </button>
          )}
        </div>
        {recordingProcessing && (
          <p className={styles.recordingProcessing} role="status">
            Recording stopped successfully. We&apos;re now processing the segment. It should be added shortly.
          </p>
        )}
        {recordingError && (
          <p className={styles.mediaError}>{recordingError}</p>
        )}
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.endBtn}
          onClick={handleEndCall}
          aria-label="End call"
        >
          <PhoneOff size={18} strokeWidth={2} aria-hidden />
          End call
        </button>
      </div>
    </div>
  );
}

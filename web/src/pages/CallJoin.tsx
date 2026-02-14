import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { PhoneOff, Mic, MicOff, Pencil, Check, Volume2, Crown, User } from 'lucide-react';
import { getJoinInfo, callWebSocketUrl } from '../api/call';
import { useMediasoupRoom } from '../hooks/useMediasoupRoom';
import { RemoteAudio } from '../components/GroupCall/RemoteAudio';
import { CallChatPanel, type ChatMessage } from '../components/GroupCall/CallChatPanel';
import { CallJoinHeader } from '../components/CallJoinHeader';
import { LeaveCallConfirmDialog } from '../components/GroupCall/LeaveCallConfirmDialog';
import type { CallJoinInfo } from '../api/call';
import styles from './CallJoin.module.css';

export function CallJoin() {
  const { token } = useParams<{ token: string }>();
  const [joinInfo, setJoinInfo] = useState<CallJoinInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [deviceId, setDeviceId] = useState<string>('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [listeningToSelf, setListeningToSelf] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [webrtcUrl, setWebrtcUrl] = useState<string | undefined>(undefined);
  const [webrtcRoomId, setWebrtcRoomId] = useState<string | undefined>(undefined);
  const [participants, setParticipants] = useState<Array<{ id: string; name: string; isHost: boolean; muted?: boolean; mutedByHost?: boolean }>>([]);
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [mutedByHost, setMutedByHost] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const selfListenGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const displayNameInputRef = useRef<HTMLInputElement | null>(null);
  const { remoteTracks, setMuted } = useMediasoupRoom(webrtcUrl, webrtcRoomId);
  const setMutedRef = useRef(setMuted);
  setMutedRef.current = setMuted;

  const myParticipant = myParticipantId ? participants.find((p) => p.id === myParticipantId) : null;
  const displayName = myParticipant?.name ?? name;

  useEffect(() => {
    if (myParticipant?.muted && myParticipant?.mutedByHost) setMutedByHost(true);
    else if (!myParticipant?.muted) setMutedByHost(false);
  }, [myParticipant?.muted, myParticipant?.mutedByHost]);

  useEffect(() => {
    if (!token) {
      setError('Invalid link');
      setLoading(false);
      return;
    }
    getJoinInfo(token)
      .then(setJoinInfo)
      .catch(() => setError('Invalid or expired link'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        const audioInputs = all.filter((d) => d.kind === 'audioinput');
        setDevices(audioInputs);
        if (audioInputs.length > 0 && !deviceId)
          setDeviceId(audioInputs[0].deviceId);
      })
      .catch(() => {});
  }, [deviceId]);

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
    };
  }, []);

  useEffect(() => {
    if (!streamReady || joined) return;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();
    streamRef.current = null;
    analyserRef.current = null;
    audioContextRef.current = null;
    selfListenGainRef.current = null;
    setStreamReady(false);
    setListeningToSelf(false);
  }, [deviceId, joined]);

  const setupMicrophone = async (): Promise<boolean> => {
    if (streamRef.current) return true;
    const constraints: MediaStreamConstraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      analyser.minDecibels = -60;
      analyser.maxDecibels = -10;
      src.connect(analyser);
      analyserRef.current = analyser;
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0;
      src.connect(gainNode);
      gainNode.connect(ctx.destination);
      selfListenGainRef.current = gainNode;
      await ctx.resume();
      const data = new Uint8Array(analyser.frequencyBinCount);
      function tick() {
        const an = analyserRef.current;
        if (!an || !audioContextRef.current) return;
        if (audioContextRef.current.state !== 'running') {
          animationRef.current = requestAnimationFrame(tick);
          return;
        }
        an.getByteFrequencyData(data);
        let max = 0;
        for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
        setMicLevel(Math.min(100, Math.round((max / 255) * 100)));
        animationRef.current = requestAnimationFrame(tick);
      }
      tick();
      setStreamReady(true);
      return true;
    } catch {
      setMicLevel(0);
      return false;
    }
  };

  const resumeAudioContext = () => {
    if (!streamRef.current) {
      setupMicrophone();
      return;
    }
    audioContextRef.current?.resume().catch(() => {});
  };

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

  const handleJoin = () => {
    if (!token || !name.trim()) return;
    setError(null);
    setJoining(true);
    // Initialize microphone for level meter (user gesture from Join click)
    setupMicrophone();
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
          setMyParticipantId(msg.participantId ?? null);
          setParticipants(msg.participants ?? []);
          if (msg.webrtcUrl) setWebrtcUrl(msg.webrtcUrl);
          if (msg.roomId) setWebrtcRoomId(msg.roomId);
        } else if (msg.type === 'participants') {
          setParticipants(msg.participants ?? []);
        } else if (msg.type === 'participantJoined') {
          setParticipants((prev) => {
            const p = msg.participant;
            if (p && !prev.some((x) => x.id === p.id)) return [...prev, p];
            return prev;
          });
        } else if (msg.type === 'callEnded') {
          clearJoinTimeout();
          setJoined(false);
          setJoining(false);
          wsRef.current = null;
          ws.close();
        } else if (msg.type === 'error') {
          resolved = true;
          clearJoinTimeout();
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
        } else if (msg.type === 'disconnected') {
          clearJoinTimeout();
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
      <>
        <div className={styles.card}>
          {joinInfo?.artworkUrl && (
            <img src={joinInfo.artworkUrl} alt="" className={styles.artwork} />
          )}
          {joinInfo && (
            <p className={`${styles.sub} ${styles.podcastEpisode}`}>
              {joinInfo.podcast.title} — {joinInfo.episode.title}
            </p>
          )}
          <h1 className={styles.cardTitle}>You're In The Call</h1>
          {audioUnavailable && (
            <p className={styles.audioUnavailable} role="status">
              Audio is unavailable — the host&apos;s WebRTC service is not running. You can stay in the call but won&apos;t hear or be heard until it&apos;s started.
            </p>
          )}
          {mutedByHost && (
            <p className={styles.mutedByHostHint} role="status">
              You were muted by the host. Ask them to unmute you.
            </p>
          )}
          <div className={styles.callActions}>
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
          <div
            className={styles.micLevel}
            role="button"
            tabIndex={0}
            onClick={resumeAudioContext}
            onKeyDown={(e) => e.key === 'Enter' && resumeAudioContext()}
            title="Click if the bar doesn't move"
            aria-label="Microphone level — click to enable if needed"
          >
            <div className={styles.micLevelBar} style={{ width: `${micLevel}%` }} />
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
                      </span>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {Array.from(remoteTracks.entries()).map(([id, track]) => (
            <RemoteAudio key={id} track={track} />
          ))}
        </div>
        <div className={styles.chatPanelWrapper}>
          <CallChatPanel
            messages={chatMessages}
            onSend={handleChatSend}
            minimized={chatMinimized}
            onMinimizeToggle={() => setChatMinimized((m) => !m)}
          />
        </div>
        <LeaveCallConfirmDialog
          open={leaveConfirmOpen}
          onOpenChange={setLeaveConfirmOpen}
          onConfirm={handleLeave}
        />
      </>
    );
  }

  return pageLayout(
    <>
      <div className={styles.card}>
        {joinInfo?.artworkUrl && (
          <img src={joinInfo.artworkUrl} alt="" className={styles.artwork} />
        )}
        {joinInfo && (
        <>
          <p className={`${styles.sub} ${styles.podcastEpisode}`}>
            {joinInfo.podcast.title} — {joinInfo.episode.title}
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
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !joining && name.trim()) {
                  handleJoin();
                }
              }}
              placeholder="Enter your name"
              maxLength={100}
            />
            {devices.length > 0 && (
              <>
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
                <div
                  className={styles.micLevel}
                  role="button"
                  tabIndex={0}
                  onClick={resumeAudioContext}
                  onKeyDown={(e) => e.key === 'Enter' && resumeAudioContext()}
                  title="Click if the bar doesn't move"
                  aria-label="Microphone level — click to enable if needed"
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
              </>
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
    </>
  );
}

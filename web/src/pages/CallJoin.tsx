import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getJoinInfo, callWebSocketUrl } from '../api/call';
import { useMediasoupRoom } from '../hooks/useMediasoupRoom';
import { RemoteAudio } from '../components/GroupCall/RemoteAudio';
import styles from './CallJoin.module.css';

export function CallJoin() {
  const { token } = useParams<{ token: string }>();
  const [joinInfo, setJoinInfo] = useState<{
    podcast: { title: string };
    episode: { id: string; title: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [deviceId, setDeviceId] = useState<string>('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [webrtcUrl, setWebrtcUrl] = useState<string | undefined>(undefined);
  const [webrtcRoomId, setWebrtcRoomId] = useState<string | undefined>(undefined);
  const [participants, setParticipants] = useState<Array<{ id: string; name: string; isHost: boolean }>>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const { remoteTracks, setMuted } = useMediasoupRoom(webrtcUrl, webrtcRoomId);
  const setMutedRef = useRef(setMuted);
  setMutedRef.current = setMuted;

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
    if (!deviceId) return;
    const constraints: MediaStreamConstraints = {
      audio: { deviceId: { exact: deviceId } },
      video: false,
    };
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((s) => {
        stream = s;
        streamRef.current = s;
        const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const src = ctx.createMediaStreamSource(s);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        analyser.minDecibels = -60;
        analyser.maxDecibels = -10;
        src.connect(analyser);
        analyserRef.current = analyser;
        ctx.resume().catch(() => {});
        const data = new Uint8Array(analyser.frequencyBinCount);

        function tick() {
          const an = analyserRef.current;
          if (!an || !ctx) return;
          if (ctx.state !== 'running') {
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
      })
      .catch(() => setMicLevel(0));

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      ctx?.close();
      streamRef.current = null;
      analyserRef.current = null;
      audioContextRef.current = null;
    };
  }, [deviceId]);

  const resumeAudioContext = () => {
    audioContextRef.current?.resume().catch(() => {});
  };

  const handleJoin = () => {
    if (!token || !name.trim()) return;
    setError(null);
    setJoining(true);
    const ws = new WebSocket(callWebSocketUrl());
    let resolved = false; // true once we got 'joined' or 'error'
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
      try {
        ws.close();
      } catch {
        // ignore
      }
    }, 15000);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'guest',
          token,
          name: name.trim(),
          password: password || undefined,
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
          ws.close();
        } else if (msg.type === 'error') {
          resolved = true;
          clearJoinTimeout();
          setError(msg.error ?? 'Could not join');
          setJoining(false);
          ws.close();
        } else if (msg.type === 'setMute') {
          setMutedRef.current(msg.muted === true);
        } else if (msg.type === 'disconnected') {
          clearJoinTimeout();
          setWebrtcUrl(undefined);
          setWebrtcRoomId(undefined);
          setJoined(false);
          setError('You were disconnected by the host');
          setJoining(false);
          ws.close();
        }
      } catch {
        // ignore
      }
    };
    ws.onclose = () => {
      clearJoinTimeout();
      setJoining(false);
      if (!resolved) {
        setError('Connection closed. Please try again.');
      }
    };
    ws.onerror = () => {
      if (!resolved) {
        setError('Connection failed');
      }
      setJoining(false);
    };
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.loading}>Loading…</p>
        </div>
      </div>
    );
  }

  if (error && !joinInfo) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Could not load call</h1>
          <p className={styles.error}>{error}</p>
        </div>
      </div>
    );
  }

  if (joined) {
    const audioUnavailable = !webrtcUrl || !webrtcRoomId;
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>You're in the call</h1>
          <p className={styles.sub}>
            {joinInfo?.podcast.title} — {joinInfo?.episode.title}
          </p>
          {audioUnavailable && (
            <p className={styles.audioUnavailable} role="status">
              Audio is unavailable — the host&apos;s WebRTC service is not running. You can stay in the call but won&apos;t hear or be heard until it&apos;s started.
            </p>
          )}
          <div
            className={styles.micLevel}
            role="button"
            tabIndex={0}
            onClick={resumeAudioContext}
            onKeyDown={(e) => e.key === 'Enter' && resumeAudioContext()}
            title="Click if the bar doesn't move"
            aria-label="Microphone level — click to enable if needed"
          >
            <div
              className={styles.micLevelBar}
              style={{ width: `${micLevel}%` }}
            />
          </div>
          <p className={styles.participantsLabel}>
            Participants ({participants.length})
          </p>
          <ul className={styles.participantsList}>
            {participants.map((p) => (
              <li key={p.id}>
                {p.name}
                {p.isHost ? ' (Host)' : ''}
              </li>
            ))}
          </ul>
          {Array.from(remoteTracks.entries()).map(([id, track]) => (
            <RemoteAudio key={id} track={track} />
          ))}
          <p className={styles.note}>
            You can close this page to leave the call.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Join group call</h1>
        {joinInfo && (
          <>
            <p className={styles.sub}>
              {joinInfo.podcast.title} — {joinInfo.episode.title}
            </p>
            <div className={styles.form}>
              <label className={styles.label} htmlFor="call-join-name">
                Your name
              </label>
              <input
                id="call-join-name"
                type="text"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
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
                    <div
                      className={styles.micLevelBar}
                      style={{ width: `${micLevel}%` }}
                    />
                  </div>
                  <p className={styles.micTestHint}>
                    Speak to test your microphone. Level should move when you talk. Click the bar if it doesn&apos;t.
                  </p>
                </>
              )}
              <label className={styles.label} htmlFor="call-join-password">
                Password (if required)
              </label>
              <input
                id="call-join-password"
                type="password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank if no password"
              />
              {error && <p className={styles.error}>{error}</p>}
              <button
                type="button"
                className={styles.joinBtn}
                onClick={handleJoin}
                disabled={joining || !name.trim()}
              >
                {joining ? 'Joining…' : 'Join call'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

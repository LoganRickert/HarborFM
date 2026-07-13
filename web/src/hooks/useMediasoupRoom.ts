import { useCallback, useEffect, useRef, useState } from 'react';
import * as mediasoupClient from 'mediasoup-client';
import { createAudioLevelProcessor } from '../utils/audioLevel.js';

export type RemoteTrackInfo = { track: MediaStreamTrack; source?: string; participantId?: string; participantName?: string; producerId: string };

export function useMediasoupRoom(
  webrtcUrl: string | undefined,
  roomId: string | undefined,
  deviceId?: string,
  participantId?: string | null,
  participantName?: string | null,
  /** Host token for host-only actions (soundboard). Only host receives this. */
  hostToken?: string | null,
  /** When false, disables autoGainControl on the mic. Default true. */
  autoGainControl: boolean = true,
  /** Manual gain 0..8 when AGC off. Applied to live send and recording. Default 1. */
  micVolume: number = 1,
) {
  const [remoteTracks, setRemoteTracks] = useState<Map<string, RemoteTrackInfo>>(new Map());
  const [remoteMicLevels, setRemoteMicLevels] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const producerRef = useRef<mediasoupClient.types.Producer | null>(null);
  const myProducerIdRef = useRef<string | null>(null);
  const recreateMicProducerRef = useRef<(() => Promise<void>) | null>(null);
  const userMutedRef = useRef(false);
  const setMutedRef = useRef<(muted: boolean) => void>((muted) => {
    userMutedRef.current = muted;
    const p = producerRef.current;
    if (muted) {
      if (p) p.pause();
    } else {
      void recreateMicProducerRef.current?.();
    }
  });
  const ctxRef = useRef<AudioContext | null>(null);
  const webrtcWsRef = useRef<WebSocket | null>(null);
  const soundboardVolumeRef = useRef<number>(1);
  const setSoundboardVolumeRef = useRef<(volume: number) => void>(() => {});
  const onSoundboardStoppedRef = useRef<(() => void) | null>(null);
  const onSoundboardErrorRef = useRef<((error: string) => void) | null>(null);
  const selfListenGainRef = useRef<GainNode | null>(null);
  const micVolumeGainRef = useRef<GainNode | null>(null);
  const autoGainControlRef = useRef(autoGainControl);
  const micVolumeRef = useRef(micVolume);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  autoGainControlRef.current = autoGainControl;
  micVolumeRef.current = micVolume;
  const setListenToSelfStateRef = useRef<(v: boolean) => void>(() => {});
  const listenToSelfRef = useRef(false);
  const listenToSelfRestoreRef = useRef(false);
  const [listenToSelf, setListenToSelfState] = useState(false);
  listenToSelfRef.current = listenToSelf;
  setListenToSelfStateRef.current = setListenToSelfState;
  const [soundboardVolumeFromRoom, setSoundboardVolumeFromRoom] = useState<number>(1);
  const mediaStreamsRef = useRef<{ micStream: MediaStream | null; localStream: MediaStream | null }>({ micStream: null, localStream: null });
  /** Bumped to tear down and re-join the mediasoup room when WS/transport died while backgrounded. */
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const requestReconnectRef = useRef<() => void>(() => {});
  requestReconnectRef.current = () => {
    setError(null);
    setReconnectNonce((n) => n + 1);
  };

  useEffect(() => {
    if (!webrtcUrl || !roomId) return;
    setReady(false);

    const url = webrtcUrl;
    const rid = roomId;
    let closed = false;
    let webrtcWs: WebSocket | null = null;
    let heartbeatIntervalId: ReturnType<typeof setInterval> | undefined;
    let device: mediasoupClient.types.Device | null = null;
    let sendTransport: mediasoupClient.types.Transport | null = null;
    let recvTransport: mediasoupClient.types.Transport | null = null;
    let localStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;
    type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void };
    const pendingResolvers = new Map<string, Pending[]>();

    function waitFor(type: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const queue = pendingResolvers.get(type);
          if (queue) {
            const idx = queue.findIndex((p) => p.reject === entry.reject);
            if (idx !== -1) queue.splice(idx, 1);
          }
          reject(new Error(`Timeout waiting for ${type}`));
        }, 15000);
        const entry: Pending = {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
        };
        const queue = pendingResolvers.get(type) ?? [];
        queue.push(entry);
        pendingResolvers.set(type, queue);
      });
    }

    function rejectPending(type: string, err: Error): void {
      const queue = pendingResolvers.get(type);
      if (!queue?.length) return;
      const entry = queue.shift();
      entry?.reject(err);
    }

    function safeSend(ws: WebSocket | null, msg: object): boolean {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        return true;
      }
      return false;
    }

    function transportIsUsable(
      transport: mediasoupClient.types.Transport | null,
    ): boolean {
      if (!transport || transport.closed) return false;
      const state = transport.connectionState;
      return state !== 'closed' && state !== 'failed';
    }

    async function run(wsUrl: string, roomIdParam: string) {
      try {
        // Defer WebSocket creation past the first microtask so React Strict Mode's
        // double-mount cleanup can run first. Otherwise we create a WebSocket,
        // cleanup closes it while CONNECTING, and the browser logs a spurious error.
        await new Promise<void>((r) => queueMicrotask(r));
        if (closed) return;

        const baseUrl = wsUrl.startsWith('ws') ? wsUrl : wsUrl.replace(/^http/, 'ws');
        webrtcWs = new WebSocket(`${baseUrl}?roomId=${encodeURIComponent(roomIdParam)}`);
        webrtcWsRef.current = webrtcWs;
        await new Promise<void>((resolve, reject) => {
          webrtcWs!.onopen = () => resolve();
          webrtcWs!.onerror = () => reject(new Error('WebSocket failed'));
        });
        if (closed) return;

        // Host sends setHostToken as first message so host-only actions (soundboard) work
        if (hostToken && webrtcWs?.readyState === WebSocket.OPEN) {
          safeSend(webrtcWs, { type: 'setHostToken', hostToken });
        }

        // Keep connection alive; many proxies (e.g. nginx, Caddy) close WebSockets after ~10 min idle
        heartbeatIntervalId = setInterval(() => {
          safeSend(webrtcWs, { type: 'ping' });
        }, 60 * 1000);

        webrtcWs.onclose = () => {
          if (heartbeatIntervalId) {
            clearInterval(heartbeatIntervalId);
            heartbeatIntervalId = undefined;
          }
          // While backgrounded, mobile often drops the WS; recover on foreground instead of a sticky error.
          if (!closed && document.visibilityState === 'visible') {
            setError('Audio connection lost - WebRTC service may have stopped. Please refresh or try again.');
          }
        };
        webrtcWs.onerror = () => {
          if (!closed && document.visibilityState === 'visible') {
            setError('Audio connection failed - WebRTC service may be unavailable.');
          }
        };

        let handleNewProducer: (producerId: string) => void = () => {};
        const handleSoundboardStopped = () => { onSoundboardStoppedRef.current?.(); };
        webrtcWs.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as { type: string; [k: string]: unknown };
            if (msg.type === 'error') {
              rejectPending(
                'produced',
                new Error(typeof msg.error === 'string' ? msg.error : 'WebRTC error'),
              );
              return;
            }
            if (msg.type === 'newProducer' && typeof msg.producerId === 'string') {
              handleNewProducer(msg.producerId);
              return;
            }
            if (msg.type === 'producerParticipant' && typeof msg.producerId === 'string' && typeof msg.participantId === 'string') {
              const producerId = msg.producerId as string;
              const participantId = msg.participantId as string;
              const participantName = typeof msg.participantName === 'string' ? msg.participantName : undefined;
              setRemoteTracks((prev) => {
                const next = new Map(prev);
                for (const [cid, info] of next) {
                  if (info.producerId === producerId) {
                    next.set(cid, { ...info, participantId, ...(participantName ? { participantName } : {}) });
                    break;
                  }
                }
                return next;
              });
              return;
            }
            if (msg.type === 'soundboardStopped') {
              handleSoundboardStopped();
              return;
            }
            if (msg.type === 'soundboardError' && typeof msg.error === 'string') {
              onSoundboardErrorRef.current?.(msg.error);
              return;
            }
            if (msg.type === 'soundboardVolume' && typeof msg.volume === 'number') {
              const v = Math.max(0, Math.min(1, msg.volume));
              setSoundboardVolumeFromRoom(v);
              return;
            }
            const queue = pendingResolvers.get(msg.type);
            if (queue?.length) {
              const entry = queue.shift();
              entry?.resolve(msg);
            }
          } catch {
            // ignore
          }
        };

        safeSend(webrtcWs, { type: 'getRouterRtpCapabilities' });
        const capsMsg = (await waitFor('routerRtpCapabilities')) as { rtpCapabilities: mediasoupClient.types.RtpCapabilities };
        if (closed) return;
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: capsMsg.rtpCapabilities });
        if (closed) return;

        // Read refs immediately before getUserMedia so we use current AGC/volume after any re-renders during async setup.
        const agc = autoGainControlRef.current;
        const micVol = micVolumeRef.current;
        const audioConstraints: MediaTrackConstraints = {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          sampleRate: { ideal: 48000 },
          autoGainControl: agc,
          noiseSuppression: false,
          // When AGC off, also disable echo cancellation to reduce pumping/volume swings.
          // Use headphones to avoid feedback when echo cancellation is off.
          ...(!agc ? { echoCancellation: false } : {}),
        };
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        const micTrack = micStream.getAudioTracks()[0];
        if (!micTrack) throw new Error('No audio track');
        micTrackRef.current = micTrack;
        mediaStreamsRef.current = { micStream, localStream: null };

        const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        ctxRef.current = ctx;

        const micSource = ctx.createMediaStreamSource(micStream);
        const analyser = ctx.createAnalyser();
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;

        const selfListenGain = ctx.createGain();
        selfListenGain.gain.value = 0;
        selfListenGain.connect(ctx.destination);
        selfListenGainRef.current = selfListenGain;

        const micVolumeGain = ctx.createGain();
        micVolumeGain.gain.value = agc ? 1 : Math.max(0, Math.min(8, micVol));
        micSource.connect(micVolumeGain);
        micVolumeGainRef.current = micVolumeGain;
        micVolumeGain.connect(selfListenGain);
        // Meter after gain so the level bar reflects what we send (AGC on = normalized; AGC off = scaled by manual volume).
        micVolumeGain.connect(analyser);
        analyser.connect(silentGain);
        silentGain.connect(ctx.destination);

        const sendDest = ctx.createMediaStreamDestination();
        micVolumeGain.connect(sendDest);
        const sendTrack = sendDest.stream.getAudioTracks()[0];
        if (!sendTrack) throw new Error('No send track');

        const computeLevel = createAudioLevelProcessor(analyser);
        let tickId: number | undefined;
        let lastLevel = 0;
        const LEVEL_THRESHOLD = 0.02;
        function tick() {
          if (closed) return;
          const level = computeLevel();
          if (Math.abs(level - lastLevel) >= LEVEL_THRESHOLD) {
            lastLevel = level;
            setMicLevel(level);
          }
          tickId = requestAnimationFrame(tick);
        }
        tickId = requestAnimationFrame(tick);

        setSoundboardVolumeRef.current = (volume: number) => {
          soundboardVolumeRef.current = Math.max(0, Math.min(1, volume));
        };

        localStream = new MediaStream([sendTrack]);
        mediaStreamsRef.current = { micStream, localStream };
        const track = sendTrack;

        cleanupRef.current = () => {
          if (tickId != null) cancelAnimationFrame(tickId);
          const ws = webrtcWsRef.current;
          safeSend(ws, { type: 'stopSoundboard' });
          selfListenGainRef.current = null;
          micVolumeGainRef.current = null;
          micTrackRef.current = null;
          setListenToSelfStateRef.current(false);
          ctxRef.current = null;
          ctx.close();
        };

        safeSend(webrtcWs, { type: 'createWebRtcTransport' });
        const sendTransportMsg = (await waitFor('webRtcTransportCreated')) as {
          id: string;
          iceParameters: mediasoupClient.types.IceParameters;
          iceCandidates: mediasoupClient.types.IceCandidate[];
          dtlsParameters: mediasoupClient.types.DtlsParameters;
        };
        if (closed) return;
        sendTransport = device.createSendTransport({
          id: sendTransportMsg.id,
          iceParameters: sendTransportMsg.iceParameters,
          iceCandidates: sendTransportMsg.iceCandidates,
          dtlsParameters: sendTransportMsg.dtlsParameters,
        });
        sendTransport.on('connect', async ({ dtlsParameters }, callback) => {
          safeSend(webrtcWs, {
            type: 'connectWebRtcTransport',
            transportId: sendTransportMsg.id,
            dtlsParameters,
          });
          await waitFor('webRtcTransportConnected');
          callback();
        });
        let nextProduceSource: string | undefined;
        sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
          try {
            const payload: { type: string; transportId: string; kind: string; rtpParameters: unknown; source?: string } = {
              type: 'produce',
              transportId: sendTransportMsg.id,
              kind,
              rtpParameters,
            };
            if (nextProduceSource) {
              payload.source = nextProduceSource;
              nextProduceSource = undefined;
            }
            if (!safeSend(webrtcWs, payload)) {
              throw new Error('WebSocket not open');
            }
            const producedMsg = (await waitFor('produced')) as { id: string };
            if (closed) return;
            if (participantId && participantName) {
              safeSend(webrtcWs, {
                type: 'associateProducer',
                producerId: producedMsg.id,
                participantId,
                participantName,
              });
            }
            callback({ id: producedMsg.id });
          } catch (e) {
            errback(e as Error);
          }
        });
        const producer = await sendTransport.produce({ track, stopTracks: false });
        if (closed) return;
        producerRef.current = producer;
        myProducerIdRef.current = producer.id;
        setReady(true);

        /**
         * Build a live track for produce().
         * alwaysNewSend: never reuse a track that was already produced.
         * forceRefresh: try remic after background; if getUserMedia fails, keep existing mic.
         */
        async function ensureLiveSendTrack(
          forceRefresh = false,
          alwaysNewSend = false,
        ): Promise<MediaStreamTrack | null> {
          if (closed) return null;
          const ctx = ctxRef.current;
          const micVolumeGain = micVolumeGainRef.current;
          if (!ctx || !micVolumeGain) return null;
          if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => {});
          }

          let micTrack = micTrackRef.current;
          const existingSend = mediaStreamsRef.current.localStream?.getAudioTracks()[0] ?? null;
          const micDead = !micTrack || micTrack.readyState === 'ended';
          const sendDead = !existingSend || existingSend.readyState === 'ended';

          if (forceRefresh || micDead) {
            try {
              const agcNow = autoGainControlRef.current;
              const constraints: MediaTrackConstraints = {
                ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
                sampleRate: { ideal: 48000 },
                autoGainControl: agcNow,
                noiseSuppression: false,
                ...(!agcNow ? { echoCancellation: false } : {}),
              };
              const newMicStream = await navigator.mediaDevices.getUserMedia({
                audio: constraints,
                video: false,
              });
              const newMicTrack = newMicStream.getAudioTracks()[0];
              if (!newMicTrack || closed) {
                newMicStream.getTracks().forEach((t) => t.stop());
                if (micDead) return null;
              } else {
                mediaStreamsRef.current.micStream?.getTracks().forEach((t) => t.stop());
                micTrackRef.current = newMicTrack;
                mediaStreamsRef.current.micStream = newMicStream;
                micTrack = newMicTrack;
                const micSource = ctx.createMediaStreamSource(newMicStream);
                micSource.connect(micVolumeGain);
              }
            } catch {
              if (micDead) return null;
              // Keep existing mic (common when visibilitychange is not a user gesture on iOS).
            }
          }

          micTrack = micTrackRef.current;
          if (!micTrack || micTrack.readyState === 'ended') return null;
          if (!micTrack.enabled) micTrack.enabled = true;

          // Browser may mute capture while backgrounded; wait briefly for unmute.
          if (micTrack.muted) {
            await new Promise<void>((resolve) => {
              const done = () => {
                micTrack!.removeEventListener('unmute', done);
                clearTimeout(timer);
                resolve();
              };
              const timer = setTimeout(done, 2000);
              micTrack!.addEventListener('unmute', done);
            });
          }

          if (alwaysNewSend || forceRefresh || sendDead || micDead) {
            const sendDest = ctx.createMediaStreamDestination();
            micVolumeGain.connect(sendDest);
            const newSendTrack = sendDest.stream.getAudioTracks()[0];
            if (!newSendTrack) return null;
            mediaStreamsRef.current.localStream?.getTracks().forEach((t) => {
              try {
                t.stop();
              } catch {
                /* ignore */
              }
            });
            mediaStreamsRef.current.localStream = new MediaStream([newSendTrack]);
            return newSendTrack;
          }

          return existingSend;
        }

        /** New producer after background/unmute so recording gets a fresh segment startMs (RTP has no silence gap on resume). */
        async function recreateMicProducer(opts?: { forceRefresh?: boolean }): Promise<boolean> {
          if (closed || userMutedRef.current) return false;
          if (
            webrtcWs?.readyState !== WebSocket.OPEN ||
            !transportIsUsable(sendTransport)
          ) {
            return false;
          }
          const oldProducer = producerRef.current;
          if (oldProducer) {
            try {
              oldProducer.close();
            } catch {
              /* ignore */
            }
            producerRef.current = null;
            myProducerIdRef.current = null;
          }
          // Always use a fresh send track for the new producer (never reuse a previously produced track).
          const sendTrack = await ensureLiveSendTrack(opts?.forceRefresh === true, true);
          if (!sendTrack || closed || sendTrack.readyState === 'ended') {
            setReady(false);
            return false;
          }
          try {
            const newProducer = await sendTransport!.produce({ track: sendTrack, stopTracks: false });
            if (closed) {
              newProducer.close();
              return false;
            }
            producerRef.current = newProducer;
            myProducerIdRef.current = newProducer.id;
            if (userMutedRef.current) {
              newProducer.pause();
            }
            setReady(true);
            if (participantId && participantName) {
              safeSend(webrtcWs, {
                type: 'associateProducer',
                producerId: newProducer.id,
                participantId,
                participantName,
              });
            }
            return true;
          } catch (err) {
            setReady(false);
            return false;
          }
        }
        recreateMicProducerRef.current = async () => {
          const ok = await recreateMicProducer();
          if (!ok && !closed && !userMutedRef.current) {
            requestReconnectRef.current();
          }
        };

        const handleVisibilityChange = () => {
          if (document.visibilityState === 'hidden') {
            if (!userMutedRef.current) {
              const p = producerRef.current;
              if (p) {
                try {
                  p.close();
                } catch {
                  /* ignore */
                }
                producerRef.current = null;
                myProducerIdRef.current = null;
                setReady(false);
              }
            }
            return;
          }
          // Swiped back: always a new producer. If WS/transport died while backgrounded, remount the room.
          void (async () => {
            if (closed || userMutedRef.current) return;
            const ok = await recreateMicProducer({ forceRefresh: true });
            if (!ok && !closed) {
              requestReconnectRef.current();
            }
          })();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        const prevCleanup = cleanupRef.current;
        cleanupRef.current = () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          prevCleanup?.();
        };

        if (listenToSelfRestoreRef.current) {
          listenToSelfRestoreRef.current = false;
          ctx.resume().then(() => {
            if (closed) return;
            const gain = selfListenGainRef.current;
            if (gain) {
              gain.gain.value = 1;
              setListenToSelfStateRef.current(true);
            }
          }).catch(() => {});
        }
        // Soundboard producer is created when panel opens (setSoundboardPanelOpen(true)),
        // and torn down when panel closes (setSoundboardPanelOpen(false)).

        safeSend(webrtcWs, { type: 'createWebRtcTransport' });
        const recvTransportMsg = (await waitFor('webRtcTransportCreated')) as {
          id: string;
          iceParameters: mediasoupClient.types.IceParameters;
          iceCandidates: mediasoupClient.types.IceCandidate[];
          dtlsParameters: mediasoupClient.types.DtlsParameters;
        };
        if (closed) return;
        recvTransport = device.createRecvTransport({
          id: recvTransportMsg.id,
          iceParameters: recvTransportMsg.iceParameters,
          iceCandidates: recvTransportMsg.iceCandidates,
          dtlsParameters: recvTransportMsg.dtlsParameters,
        });
        recvTransport.on('connect', async ({ dtlsParameters }, callback) => {
          safeSend(webrtcWs, {
            type: 'connectWebRtcTransport',
            transportId: recvTransportMsg.id,
            dtlsParameters,
          });
          await waitFor('webRtcTransportConnected');
          callback();
        });

        async function consumeProducer(pid: string) {
          safeSend(webrtcWs, {
            type: 'consume',
            transportId: recvTransportMsg.id,
            producerId: pid,
            rtpCapabilities: device!.rtpCapabilities,
          });
          const consumedMsg = (await waitFor('consumed')) as {
            id: string;
            producerId: string;
            kind: string;
            rtpParameters: mediasoupClient.types.RtpParameters;
            source?: string;
            participantId?: string;
            participantName?: string;
          };
          const consumer = await recvTransport!.consume({
            id: consumedMsg.id,
            producerId: consumedMsg.producerId,
            kind: consumedMsg.kind as mediasoupClient.types.MediaKind,
            rtpParameters: consumedMsg.rtpParameters,
          });
          return { consumer, source: consumedMsg.source, participantId: consumedMsg.participantId, participantName: consumedMsg.participantName };
        }

        safeSend(webrtcWs, { type: 'getProducers' });
        const producersMsg = (await waitFor('producers')) as { producerIds: string[]; soundboardVolume?: number };
        if (closed) return;
        if (typeof producersMsg.soundboardVolume === 'number') {
          const v = Math.max(0, Math.min(1, producersMsg.soundboardVolume));
          setSoundboardVolumeFromRoom(v);
        }
        const consumedProducerIds = new Set<string>();
        for (const producerId of producersMsg.producerIds || []) {
          if (producerId === myProducerIdRef.current) continue;
          try {
            const { consumer, source, participantId, participantName } = await consumeProducer(producerId);
            if (closed) return;
            consumedProducerIds.add(producerId);
            setRemoteTracks((prev) => new Map(prev).set(consumer.id, {
              track: consumer.track,
              producerId,
              ...(source ? { source } : {}),
              ...(participantId ? { participantId } : {}),
              ...(participantName ? { participantName } : {}),
            }));
          } catch {
            // skip
          }
        }

        handleNewProducer = async (producerId: string) => {
          if (producerId === myProducerIdRef.current || consumedProducerIds.has(producerId) || closed) return;
          try {
            const { consumer, source, participantId: remoteParticipantId, participantName } = await consumeProducer(producerId);
            if (closed) return;
            consumedProducerIds.add(producerId);
            setRemoteTracks((prev) => {
              const next = new Map(prev);
              if (remoteParticipantId) {
                for (const [cid, info] of next) {
                  if (info.participantId === remoteParticipantId && info.producerId !== producerId) {
                    next.delete(cid);
                  }
                }
              }
              next.set(consumer.id, {
                track: consumer.track,
                producerId,
                ...(source ? { source } : {}),
                ...(remoteParticipantId ? { participantId: remoteParticipantId } : {}),
                ...(participantName ? { participantName } : {}),
              });
              return next;
            });
          } catch {
            // skip
          }
        };

      } catch (err) {
        if (!closed) setError(err instanceof Error ? err.message : 'Media failed');
      }
    }

    const stopMediaTracks = () => {
      const { micStream: ms, localStream: ls } = mediaStreamsRef.current;
      ms?.getTracks().forEach((t) => t.stop());
      ls?.getTracks().forEach((t) => t.stop());
      mediaStreamsRef.current = { micStream: null, localStream: null };
    };

    const handlePageUnload = () => {
      stopMediaTracks();
    };
    // Do not stop mic tracks on pagehide — mobile tab/app switches fire it and would
    // kill the mediasoup send path while the separate CallJoin meter mic keeps working.
    window.addEventListener('beforeunload', handlePageUnload);

    run(url, rid);
    return () => {
      window.removeEventListener('beforeunload', handlePageUnload);
      closed = true;
      recreateMicProducerRef.current = null;
      myProducerIdRef.current = null;
      if (heartbeatIntervalId) {
        clearInterval(heartbeatIntervalId);
        heartbeatIntervalId = undefined;
      }
      stopMediaTracks();
      webrtcWsRef.current = null;
      setRemoteMicLevels(new Map());
      listenToSelfRestoreRef.current = listenToSelfRef.current;
      selfListenGainRef.current = null;
      micVolumeGainRef.current = null;
      micTrackRef.current = null;
      setListenToSelfStateRef.current(false);
      cleanupRef.current?.();
      pendingResolvers.forEach((queue) => {
        queue.forEach((p) => p.reject(new Error('WebRTC room closed')));
        queue.length = 0;
      });
      webrtcWs?.close();
      localStream?.getTracks().forEach((t) => t.stop());
      micStream?.getTracks().forEach((t) => t.stop());
      sendTransport?.close();
      recvTransport?.close();
    };
  }, [webrtcUrl, roomId, deviceId, participantId, participantName, hostToken, autoGainControl, reconnectNonce]);

  useEffect(() => {
    const gain = micVolumeGainRef.current;
    if (gain) {
      gain.gain.value = autoGainControl ? 1 : Math.max(0, Math.min(8, micVolume));
    }
    const track = micTrackRef.current;
    if (track) {
      track.applyConstraints({
        autoGainControl,
        ...(!autoGainControl ? { echoCancellation: false } : {}),
      }).catch(() => {});
    }
  }, [autoGainControl, micVolume]);

  useEffect(() => {
    const entries = Array.from(remoteTracks.entries()).filter(
      ([, info]) => info.source !== 'soundboard'
    );
    if (entries.length === 0) return;

    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const processors: { producerId: string; computeLevel: () => number }[] = [];

    for (const [, info] of entries) {
      try {
        const src = ctx.createMediaStreamSource(new MediaStream([info.track]));
        const analyser = ctx.createAnalyser();
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        src.connect(analyser);
        analyser.connect(silentGain);
        silentGain.connect(ctx.destination);
        processors.push({ producerId: info.producerId, computeLevel: createAudioLevelProcessor(analyser) });
      } catch {
        // skip failed setup
      }
    }

    const producerIdToParticipantId = new Map<string, string>();
    for (const [, info] of remoteTracks) {
      if (info.participantId) producerIdToParticipantId.set(info.producerId, info.participantId);
    }

    let rafId: number | undefined;
    let lastLevels = new Map<string, number>();
    const LEVEL_THRESHOLD = 0.02;
    function tick() {
      if (processors.length === 0) return;
      const next = new Map<string, number>();
      let changed = false;
      for (const { producerId, computeLevel } of processors) {
        const participantId = producerIdToParticipantId.get(producerId);
        if (participantId) {
          const level = computeLevel();
          next.set(participantId, level);
          const prev = lastLevels.get(participantId) ?? -1;
          if (Math.abs(level - prev) >= LEVEL_THRESHOLD) changed = true;
        }
      }
      if (changed) {
        lastLevels = next;
        setRemoteMicLevels(next);
      }
      rafId = requestAnimationFrame(tick);
    }
    ctx.resume().then(() => { rafId = requestAnimationFrame(tick); }).catch(() => {});

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      ctx.close();
    };
  }, [remoteTracks]);

  const setMuted = useCallback((muted: boolean) => {
    setMutedRef.current(muted);
  }, []);

  const sendIfOpen = useCallback((msg: object) => {
    const ws = webrtcWsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const setSoundboardVolume = useCallback((volume: number) => {
    const v = Math.max(0, Math.min(1, volume));
    setSoundboardVolumeRef.current(v);
    sendIfOpen({ type: 'soundboardVolume', volume: v });
  }, [sendIfOpen]);

  const resumeSoundboardContext = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== 'running') {
      ctx.resume().catch(() => {});
    }
  }, []);

  const toggleListenToSelf = useCallback(async () => {
    const gain = selfListenGainRef.current;
    const ctx = ctxRef.current;
    if (!gain || !ctx) return;
    await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return;
    setListenToSelfState((prev) => {
      gain.gain.value = prev ? 0 : 1;
      return !prev;
    });
  }, []);

  const stopListenToSelf = useCallback(() => {
    const gain = selfListenGainRef.current;
    if (gain) gain.gain.value = 0;
    setListenToSelfState(false);
  }, []);

  const setSoundboardPanelOpen = useCallback((open: boolean) => {
    if (!open) sendIfOpen({ type: 'stopSoundboard' });
  }, [sendIfOpen]);

  const playSoundboard = useCallback((assetId: string, startTimeSec?: number) => {
    sendIfOpen({ type: 'playSoundboard', assetId, ...(typeof startTimeSec === 'number' && startTimeSec > 0 ? { startTimeSec } : {}) });
  }, [sendIfOpen]);

  const stopSoundboard = useCallback(() => {
    sendIfOpen({ type: 'stopSoundboard' });
  }, [sendIfOpen]);

  const setProducerVolume = useCallback((volume: number) => {
    const pid = producerRef.current?.id;
    if (pid != null) {
      const v = Math.max(0, Math.min(8, volume));
      sendIfOpen({ type: 'producerVolume', producerId: pid, volume: v });
    }
  }, [sendIfOpen]);

  const leaveRoom = useCallback(() => {
    const { micStream, localStream } = mediaStreamsRef.current;
    micStream?.getTracks().forEach((t) => t.stop());
    localStream?.getTracks().forEach((t) => t.stop());
    mediaStreamsRef.current = { micStream: null, localStream: null };
  }, []);

  return {
    remoteTracks,
    remoteMicLevels,
    error,
    ready,
    micLevel,
    setMuted,
    playSoundboard,
    stopSoundboard,
    setSoundboardVolume,
    soundboardVolumeFromRoom,
    resumeSoundboardContext,
    setSoundboardPanelOpen,
    onSoundboardStoppedRef,
    onSoundboardErrorRef,
    listenToSelf,
    toggleListenToSelf,
    stopListenToSelf,
    setProducerVolume,
    leaveRoom,
  };
}

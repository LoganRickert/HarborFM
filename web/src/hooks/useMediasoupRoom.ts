import { useCallback, useEffect, useRef, useState } from 'react';
import * as mediasoupClient from 'mediasoup-client';
import { createAudioLevelProcessor } from '../utils/audioLevel.js';

export type RemoteTrackInfo = { track: MediaStreamTrack; source?: string; participantId?: string; producerId: string };

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
  const setMutedRef = useRef<(muted: boolean) => void>((muted) => {
    const p = producerRef.current;
    if (p) {
      if (muted) p.pause();
      else p.resume();
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
  const setListenToSelfStateRef = useRef<(v: boolean) => void>(() => {});
  const [listenToSelf, setListenToSelfState] = useState(false);
  setListenToSelfStateRef.current = setListenToSelfState;

  useEffect(() => {
    if (!webrtcUrl || !roomId) return;
    setReady(false);

    const url = webrtcUrl;
    const rid = roomId;
    let closed = false;
    let webrtcWs: WebSocket | null = null;
    let device: mediasoupClient.types.Device | null = null;
    let sendTransport: mediasoupClient.types.Transport | null = null;
    let recvTransport: mediasoupClient.types.Transport | null = null;
    let localStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;
    const pendingResolvers = new Map<string, Array<(value: unknown) => void>>();

    function waitFor(type: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), 15000);
        const queue = pendingResolvers.get(type) ?? [];
        queue.push((value) => {
          clearTimeout(timeout);
          const i = queue.indexOf(queue[queue.length - 1]);
          if (i !== -1) queue.splice(i, 1);
          resolve(value);
        });
        pendingResolvers.set(type, queue);
      });
    }

    function safeSend(ws: WebSocket | null, msg: object): void {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
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

        webrtcWs.onclose = () => {
          if (!closed) {
            setError('Audio connection lost - WebRTC service may have stopped. Please refresh or try again.');
          }
        };
        webrtcWs.onerror = () => {
          if (!closed) {
            setError('Audio connection failed - WebRTC service may be unavailable.');
          }
        };

        let handleNewProducer: (producerId: string) => void = () => {};
        const handleSoundboardStopped = () => { onSoundboardStoppedRef.current?.(); };
        webrtcWs.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as { type: string; [k: string]: unknown };
            if (msg.type === 'newProducer' && typeof msg.producerId === 'string') {
              handleNewProducer(msg.producerId);
              return;
            }
            if (msg.type === 'producerParticipant' && typeof msg.producerId === 'string' && typeof msg.participantId === 'string') {
              const producerId = msg.producerId as string;
              const participantId = msg.participantId as string;
              setRemoteTracks((prev) => {
                const next = new Map(prev);
                for (const [cid, info] of next) {
                  if (info.producerId === producerId) {
                    next.set(cid, { ...info, participantId });
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
            const queue = pendingResolvers.get(msg.type);
            if (queue?.length) {
              const fn = queue.shift();
              if (fn) fn(msg);
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

        const audioConstraints: MediaTrackConstraints = {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          sampleRate: { ideal: 48000 },
          autoGainControl,
          noiseSuppression: false,
          // When AGC off, also disable echo cancellation to reduce pumping/volume swings.
          // Use headphones to avoid feedback when echo cancellation is off.
          ...(!autoGainControl ? { echoCancellation: false } : {}),
        };
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        const micTrack = micStream.getAudioTracks()[0];
        if (!micTrack) throw new Error('No audio track');

        const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        ctxRef.current = ctx;

        const micSource = ctx.createMediaStreamSource(micStream);
        const analyser = ctx.createAnalyser();
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        micSource.connect(analyser);
        analyser.connect(silentGain);
        silentGain.connect(ctx.destination);

        const selfListenGain = ctx.createGain();
        selfListenGain.gain.value = 0;
        selfListenGain.connect(ctx.destination);
        selfListenGainRef.current = selfListenGain;

        const micVolumeGain = ctx.createGain();
        micVolumeGain.gain.value = autoGainControl ? 1 : Math.max(0, Math.min(8, micVolume));
        micSource.connect(micVolumeGain);
        micVolumeGainRef.current = micVolumeGain;
        micVolumeGain.connect(selfListenGain);

        const sendDest = ctx.createMediaStreamDestination();
        micVolumeGain.connect(sendDest);
        const sendTrack = sendDest.stream.getAudioTracks()[0];
        if (!sendTrack) throw new Error('No send track');

        const computeLevel = createAudioLevelProcessor(analyser);
        let tickId: number | undefined;
        function tick() {
          if (closed) return;
          setMicLevel(computeLevel());
          tickId = requestAnimationFrame(tick);
        }
        tickId = requestAnimationFrame(tick);

        setSoundboardVolumeRef.current = (volume: number) => {
          soundboardVolumeRef.current = Math.max(0, Math.min(1, volume));
        };

        localStream = new MediaStream([sendTrack]);
        const track = sendTrack;

        cleanupRef.current = () => {
          if (tickId != null) cancelAnimationFrame(tickId);
          const ws = webrtcWsRef.current;
          safeSend(ws, { type: 'stopSoundboard' });
          selfListenGainRef.current = null;
          micVolumeGainRef.current = null;
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
            safeSend(webrtcWs, payload);
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
        const producer = await sendTransport.produce({ track });
        if (closed) return;
        producerRef.current = producer;
        setReady(true);
        const myProducerId = producer.id;

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
          };
          const consumer = await recvTransport!.consume({
            id: consumedMsg.id,
            producerId: consumedMsg.producerId,
            kind: consumedMsg.kind as mediasoupClient.types.MediaKind,
            rtpParameters: consumedMsg.rtpParameters,
          });
          return { consumer, source: consumedMsg.source, participantId: consumedMsg.participantId };
        }

        safeSend(webrtcWs, { type: 'getProducers' });
        const producersMsg = (await waitFor('producers')) as { producerIds: string[] };
        if (closed) return;
        const consumedProducerIds = new Set<string>();
        for (const producerId of producersMsg.producerIds || []) {
          if (producerId === myProducerId) continue;
          try {
            const { consumer, source, participantId } = await consumeProducer(producerId);
            if (closed) return;
            consumedProducerIds.add(producerId);
            setRemoteTracks((prev) => new Map(prev).set(consumer.id, {
              track: consumer.track,
              producerId,
              ...(source ? { source } : {}),
              ...(participantId ? { participantId } : {}),
            }));
          } catch {
            // skip
          }
        }

        handleNewProducer = async (producerId: string) => {
          if (producerId === myProducerId || consumedProducerIds.has(producerId) || closed) return;
          try {
            const { consumer, source, participantId } = await consumeProducer(producerId);
            if (closed) return;
            consumedProducerIds.add(producerId);
            setRemoteTracks((prev) => new Map(prev).set(consumer.id, {
              track: consumer.track,
              producerId,
              ...(source ? { source } : {}),
              ...(participantId ? { participantId } : {}),
            }));
          } catch {
            // skip
          }
        };

      } catch (err) {
        if (!closed) setError(err instanceof Error ? err.message : 'Media failed');
      }
    }

    run(url, rid);
    return () => {
      closed = true;
      webrtcWsRef.current = null;
      setRemoteMicLevels(new Map());
      selfListenGainRef.current = null;
      micVolumeGainRef.current = null;
      setListenToSelfStateRef.current(false);
      cleanupRef.current?.();
      pendingResolvers.forEach((queue) => queue.forEach((r) => r(null)));
      webrtcWs?.close();
      localStream?.getTracks().forEach((t) => t.stop());
      micStream?.getTracks().forEach((t) => t.stop());
      sendTransport?.close();
      recvTransport?.close();
    };
  }, [webrtcUrl, roomId, deviceId, participantId, participantName, hostToken, autoGainControl, micVolume]);

  useEffect(() => {
    const gain = micVolumeGainRef.current;
    if (!gain) return;
    gain.gain.value = autoGainControl ? 1 : Math.max(0, Math.min(8, micVolume));
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
    function tick() {
      if (processors.length === 0) return;
      const next = new Map<string, number>();
      for (const { producerId, computeLevel } of processors) {
        const participantId = producerIdToParticipantId.get(producerId);
        if (participantId) next.set(participantId, computeLevel());
      }
      setRemoteMicLevels(next);
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
    resumeSoundboardContext,
    setSoundboardPanelOpen,
    onSoundboardStoppedRef,
    onSoundboardErrorRef,
    listenToSelf,
    toggleListenToSelf,
    stopListenToSelf,
    setProducerVolume,
  };
}

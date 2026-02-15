import { useCallback, useEffect, useRef, useState } from 'react';
import * as mediasoupClient from 'mediasoup-client';

function soundboardNoopConnect(el: HTMLAudioElement | null) {
  console.log('[useMediasoupRoom] connectSoundboard NOOP - soundboard not ready', { hasEl: !!el });
}

export function useMediasoupRoom(
  webrtcUrl: string | undefined,
  roomId: string | undefined,
  deviceId?: string,
) {
  const [remoteTracks, setRemoteTracks] = useState<Map<string, MediaStreamTrack>>(new Map());
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
  const connectSoundboardRef = useRef<(el: HTMLAudioElement | null) => void | Promise<void>>(soundboardNoopConnect);
  const ctxRef = useRef<AudioContext | null>(null);
  const soundboardProducerRef = useRef<mediasoupClient.types.Producer | null>(null);
  const soundboardPanelOpenRef = useRef(false);
  const setupSoundboardRef = useRef<() => void | Promise<void>>(() => {});
  const teardownSoundboardRef = useRef<() => void>(() => {});
  const soundboardGainNodeRef = useRef<GainNode | null>(null);
  const soundboardMutedRef = useRef<boolean>(false);
  const soundboardVolumeRef = useRef<number>(1);
  const setSoundboardMutedRef = useRef<(muted: boolean) => void>(() => {});
  const setSoundboardVolumeRef = useRef<(volume: number) => void>(() => {});

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

    async function run(wsUrl: string, roomIdParam: string) {
      try {
        const baseUrl = wsUrl.startsWith('ws') ? wsUrl : wsUrl.replace(/^http/, 'ws');
        webrtcWs = new WebSocket(`${baseUrl}?roomId=${encodeURIComponent(roomIdParam)}`);
        await new Promise<void>((resolve, reject) => {
          webrtcWs!.onopen = () => resolve();
          webrtcWs!.onerror = () => reject(new Error('WebSocket failed'));
        });
        if (closed) return;

        let handleNewProducer: (producerId: string) => void = () => {};
        webrtcWs.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as { type: string; [k: string]: unknown };
            if (msg.type === 'newProducer' && typeof msg.producerId === 'string') {
              handleNewProducer(msg.producerId);
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

        webrtcWs.send(JSON.stringify({ type: 'getRouterRtpCapabilities' }));
        const capsMsg = (await waitFor('routerRtpCapabilities')) as { rtpCapabilities: mediasoupClient.types.RtpCapabilities };
        if (closed) return;
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: capsMsg.rtpCapabilities });
        if (closed) return;

        const audioConstraints: boolean | MediaTrackConstraints = deviceId
          ? { deviceId: { exact: deviceId } }
          : true;
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        const micTrack = micStream.getAudioTracks()[0];
        if (!micTrack) throw new Error('No audio track');

        const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        ctxRef.current = ctx;
        const mixNode = ctx.createGain();
        mixNode.gain.value = 1;

        const micSource = ctx.createMediaStreamSource(micStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        analyser.minDecibels = -60;
        analyser.maxDecibels = -10;
        micSource.connect(analyser);
        analyser.connect(mixNode);

        const dest = ctx.createMediaStreamDestination();
        mixNode.connect(dest);

        const data = new Uint8Array(analyser.frequencyBinCount);
        let tickId: number | undefined;
        function tick() {
          if (closed) return;
          analyser.getByteFrequencyData(data);
          let max = 0;
          for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
          setMicLevel(Math.min(100, Math.round((max / 255) * 100)));
          tickId = requestAnimationFrame(tick);
        }
        tickId = requestAnimationFrame(tick);

        let soundboardProducer: mediasoupClient.types.Producer | null = null;
        let soundboardSource: MediaElementAudioSourceNode | null = null;
        let soundboardGainNode: GainNode | null = null;
        let soundboardDest: MediaStreamAudioDestinationNode | null = null;

        setSoundboardMutedRef.current = (muted: boolean) => {
          soundboardMutedRef.current = muted;
          const p = soundboardProducerRef.current;
          if (p) {
            if (muted) p.pause();
            else p.resume();
          }
        };

        setSoundboardVolumeRef.current = (volume: number) => {
          const v = Math.max(0, Math.min(1, volume));
          soundboardVolumeRef.current = v;
          const gain = soundboardGainNodeRef.current;
          if (gain) gain.gain.setValueAtTime(v, ctx.currentTime);
        };

        async function connectSoundboard(el: HTMLAudioElement | null) {
          console.log('[useMediasoupRoom] connectSoundboard', { hasEl: !!el, src: el?.src, closed, hasSoundboardDest: !!soundboardDest });
          if (soundboardSource) {
            try {
              soundboardSource.disconnect();
            } catch {
              /* ignore */
            }
            soundboardSource = null;
          }
          if (soundboardGainNode) {
            try {
              soundboardGainNode.disconnect();
            } catch {
              /* ignore */
            }
          }
          soundboardGainNode = null;
          soundboardGainNodeRef.current = null;
          if (el && el.src && !closed && soundboardDest) {
            try {
              await Promise.race([
                ctx.resume(),
                new Promise((resolve) => setTimeout(resolve, 2000)),
              ]);
            } catch {
              /* ignore */
            }
            if (!el || !el.src || closed || !soundboardDest) {
              console.log('[useMediasoupRoom] connectSoundboard early return');
              return;
            }
            console.log('[useMediasoupRoom] connectSoundboard connecting audio to graph');
            soundboardSource = ctx.createMediaElementSource(el);
            soundboardGainNode = ctx.createGain();
            soundboardGainNode.gain.value = soundboardVolumeRef.current;
            soundboardGainNodeRef.current = soundboardGainNode;
            soundboardSource.connect(soundboardGainNode);
            soundboardGainNode.connect(soundboardDest);
            soundboardGainNode.connect(ctx.destination);
          }
        }

        async function setupSoundboard() {
          console.log('[useMediasoupRoom] setupSoundboard', { hasSendTransport: !!sendTransport, hasSoundboardDest: !!soundboardDest, closed });
          if (!sendTransport || soundboardDest || closed) return;
          try {
            await Promise.race([
              ctx.resume(),
              new Promise((resolve) => setTimeout(resolve, 2000)),
            ]);
          } catch {
            /* ignore */
          }
          if (closed || !sendTransport) return;
          console.log('[useMediasoupRoom] setupSoundboard creating dest and producer');
          soundboardDest = ctx.createMediaStreamDestination();
          const sbTrack = soundboardDest.stream.getAudioTracks()[0];
          if (!sbTrack) {
            console.warn('[useMediasoupRoom] setupSoundboard no track from dest');
          }
          if (sbTrack) {
            try {
              const p = await sendTransport.produce({ track: sbTrack });
              if (!closed && soundboardDest) {
                soundboardProducer = p;
                soundboardProducerRef.current = p;
                if (soundboardMutedRef.current) p.pause();
                connectSoundboardRef.current = connectSoundboard;
                console.log('[useMediasoupRoom] setupSoundboard completed');
              } else {
                try { p.close(); } catch { /* ignore */ }
              }
            } catch (err) {
              console.error('[useMediasoupRoom] setupSoundboard produce failed', err);
            }
          }
        }

        function teardownSoundboard() {
          console.log('[useMediasoupRoom] teardownSoundboard');
          if (soundboardSource) {
            try { soundboardSource.disconnect(); } catch { /* ignore */ }
            soundboardSource = null;
          }
          soundboardGainNode = null;
          soundboardGainNodeRef.current = null;
          if (soundboardProducer) {
            try { soundboardProducer.close(); } catch { /* ignore */ }
            soundboardProducer = null;
            soundboardProducerRef.current = null;
          }
          soundboardDest = null;
          connectSoundboardRef.current = soundboardNoopConnect;
        }

        setupSoundboardRef.current = setupSoundboard;
        teardownSoundboardRef.current = teardownSoundboard;

        localStream = dest.stream;
        const track = localStream.getAudioTracks()[0];
        if (!track) throw new Error('No audio track');

        cleanupRef.current = () => {
          if (tickId != null) cancelAnimationFrame(tickId);
          teardownSoundboardRef.current();
          ctxRef.current = null;
          ctx.close();
        };

        webrtcWs.send(JSON.stringify({ type: 'createWebRtcTransport' }));
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
          webrtcWs?.send(JSON.stringify({
            type: 'connectWebRtcTransport',
            transportId: sendTransportMsg.id,
            dtlsParameters,
          }));
          await waitFor('webRtcTransportConnected');
          callback();
        });
        sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
          try {
            webrtcWs?.send(JSON.stringify({
              type: 'produce',
              transportId: sendTransportMsg.id,
              kind,
              rtpParameters,
            }));
            const producedMsg = (await waitFor('produced')) as { id: string };
            if (closed) return;
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

        if (soundboardPanelOpenRef.current) {
          console.log('[useMediasoupRoom] Panel was open, running setupSoundboard');
          setupSoundboard();
        }

        webrtcWs.send(JSON.stringify({ type: 'createWebRtcTransport' }));
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
          webrtcWs?.send(JSON.stringify({
            type: 'connectWebRtcTransport',
            transportId: recvTransportMsg.id,
            dtlsParameters,
          }));
          await waitFor('webRtcTransportConnected');
          callback();
        });

        async function consumeProducer(pid: string) {
          webrtcWs?.send(JSON.stringify({
            type: 'consume',
            transportId: recvTransportMsg.id,
            producerId: pid,
            rtpCapabilities: device!.rtpCapabilities,
          }));
          const consumedMsg = (await waitFor('consumed')) as {
            id: string;
            producerId: string;
            kind: string;
            rtpParameters: mediasoupClient.types.RtpParameters;
          };
          const consumer = await recvTransport!.consume({
            id: consumedMsg.id,
            producerId: consumedMsg.producerId,
            kind: consumedMsg.kind as mediasoupClient.types.MediaKind,
            rtpParameters: consumedMsg.rtpParameters,
          });
          return consumer;
        }

        webrtcWs.send(JSON.stringify({ type: 'getProducers' }));
        const producersMsg = (await waitFor('producers')) as { producerIds: string[] };
        if (closed) return;
        const consumedProducerIds = new Set<string>();
        for (const producerId of producersMsg.producerIds || []) {
          if (producerId === myProducerId) continue;
          try {
            const consumer = await consumeProducer(producerId);
            if (closed) return;
            consumedProducerIds.add(producerId);
            setRemoteTracks((prev) => new Map(prev).set(consumer.id, consumer.track));
          } catch {
            // skip
          }
        }

        handleNewProducer = async (producerId: string) => {
          if (producerId === myProducerId || consumedProducerIds.has(producerId) || closed) return;
          try {
            const consumer = await consumeProducer(producerId);
            if (closed) return;
            consumedProducerIds.add(producerId);
            setRemoteTracks((prev) => new Map(prev).set(consumer.id, consumer.track));
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
      cleanupRef.current?.();
      pendingResolvers.forEach((queue) => queue.forEach((r) => r(null)));
      webrtcWs?.close();
      localStream?.getTracks().forEach((t) => t.stop());
      micStream?.getTracks().forEach((t) => t.stop());
      sendTransport?.close();
      recvTransport?.close();
    };
  }, [webrtcUrl, roomId, deviceId]);

  const setMuted = useCallback((muted: boolean) => {
    setMutedRef.current(muted);
  }, []);

  const setSoundboardMuted = useCallback((muted: boolean) => {
    soundboardMutedRef.current = muted;
    setSoundboardMutedRef.current(muted);
  }, []);

  const setSoundboardVolume = useCallback((volume: number) => {
    setSoundboardVolumeRef.current(volume);
  }, []);

  const resumeSoundboardContext = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== 'running') {
      ctx.resume().catch(() => {});
    }
  }, []);

  const setSoundboardPanelOpen = useCallback((open: boolean) => {
    console.log('[useMediasoupRoom] setSoundboardPanelOpen', open);
    soundboardPanelOpenRef.current = open;
    if (open) {
      setupSoundboardRef.current();
    } else {
      teardownSoundboardRef.current();
    }
  }, []);

  const connectSoundboard = useCallback((el: HTMLAudioElement | null) => {
    console.log('[useMediasoupRoom] connectSoundboard INVOKED (calling ref)', { hasEl: !!el, elSrc: el?.src?.slice?.(0, 80) });
    return connectSoundboardRef.current(el);
  }, []);

  return {
    remoteTracks,
    error,
    ready,
    micLevel,
    setMuted,
    connectSoundboard,
    setSoundboardMuted,
    setSoundboardVolume,
    resumeSoundboardContext,
    setSoundboardPanelOpen,
  };
}
